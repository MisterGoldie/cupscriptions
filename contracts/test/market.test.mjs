import assert from "node:assert/strict";
import fs from "node:fs";
import { afterEach, test } from "node:test";
import ganache from "ganache";
import {
  createPublicClient, createWalletClient, custom, hashTypedData,
  parseEther, parseEventLogs, zeroAddress, zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { compileContracts } from "../scripts/build.mjs";
import { buildCollection, collectionLeaf, hashPair } from "../scripts/collection.mjs";
import { purchaseTypedData } from "../scripts/purchase-authorization.mjs";

const tree = buildCollection();
const id = tree.entries.find((entry) => entry.number === 6).id;
const proof = tree.proofFor(id);
const treasury = "0xcbBcf40247425932d728585dA2678567e7F8E42f";
const fee = parseEther("0.000001");
const price = parseEther("0.01");
const { output } = compileContracts({
  "TestSeller.sol": { content: fs.readFileSync(new URL("./TestSeller.sol", import.meta.url), "utf8") },
});
const marketArtifact = output.contracts["CupscriptionsMarket.sol"].CupscriptionsMarket;
const sellerArtifact = output.contracts["TestSeller.sol"].TestSeller;
const abi = marketArtifact.abi;
const providers = new Set();
afterEach(async () => {
  for (const provider of providers) await provider.disconnect();
  providers.clear();
});

async function fixture() {
  const provider = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: foundry.id, hardfork: "shanghai" },
    wallet: { deterministic: true, totalAccounts: 6, unlockedAccounts: [treasury] },
  });
  providers.add(provider);
  const accounts = Object.values(provider.getInitialAccounts()).map(({ secretKey }) => privateKeyToAccount(secretKey));
  const clients = accounts.map((account) => createWalletClient({ account, chain: foundry, transport: custom(provider) }));
  const rpc = createPublicClient({ chain: foundry, transport: custom(provider), cacheTime: 0, pollingInterval: 10 });
  const [deployer, seller, buyer, attacker, verifier] = clients;
  const deploy = async (args = [tree.root, verifier.account.address]) => {
    const hash = await deployer.deployContract({ abi, bytecode: `0x${marketArtifact.evm.bytecode.object}`, args });
    return (await rpc.waitForTransactionReceipt({ hash })).contractAddress;
  };
  const market = await deploy();
  const read = (functionName, args = []) => rpc.readContract({ address: market, abi, functionName, args });
  const write = async (wallet, functionName, args = [], value = 0n) => {
    const request = { address: market, abi, functionName, args, value };
    // JSON-RPC unlocked test accounts otherwise inherit Ganache's 90,000 gas
    // default, which is too small for a Merkle-proof listing transaction.
    const gas = await rpc.estimateContractGas({ ...request, account: wallet.account });
    const hash = await wallet.writeContract({ ...request, gas: gas * 12n / 10n });
    const receipt = await rpc.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    return receipt;
  };
  const mine = async (count = 5) => {
    for (let i = 0; i < count; i++) await provider.request({ method: "evm_mine", params: [] });
  };
  const deposit = async (wallet = seller, cup = id) => {
    const hash = await wallet.sendTransaction({ to: market, data: cup });
    return rpc.waitForTransactionReceipt({ hash });
  };
  const prepare = async () => {
    await deposit();
    await write(seller, "list", [id, price, proof]);
    await mine();
  };
  const authorize = async (overrides = {}, signer = verifier, domainOverrides = {}) => {
    const listing = await read("listings", [seller.account.address, id]);
    const now = (await rpc.getBlock()).timestamp;
    const authorization = {
      ethscriptionId: id,
      seller: seller.account.address,
      buyer: buyer.account.address,
      price: listing[0],
      listingNonce: listing[1],
      depositBlock: await read("potentialDeposits", [seller.account.address, id]),
      issuedAt: now,
      deadline: now + 60n,
      ...overrides,
    };
    const typedData = purchaseTypedData(foundry.id, market, authorization);
    typedData.domain = { ...typedData.domain, ...domainOverrides };
    return [authorization, await signer.signTypedData(typedData)];
  };
  return { provider, rpc, deployer, seller, buyer, attacker, verifier, market, deploy, read, write, mine, deposit, prepare, authorize };
}

function transferFrom(receipt) {
  return parseEventLogs({ abi, logs: receipt.logs, eventName: "ethscriptions_protocol_TransferEthscriptionForPreviousOwner" })[0].args;
}

test("all 5,000 metadata entries have valid membership proofs", () => {
  assert.equal(tree.count, 5000);
  for (const entry of tree.entries) {
    let computed = collectionLeaf(entry.id);
    for (const sibling of tree.proofFor(entry.id)) computed = hashPair(computed, sibling);
    assert.equal(computed, tree.root);
  }
});

test("deployment fixes the exact fee, recipient, collection and verifier", async () => {
  const f = await fixture();
  assert.equal(await f.read("MARKETPLACE_FEE"), fee);
  assert.equal((await f.read("feeRecipient")).toLowerCase(), treasury.toLowerCase());
  assert.equal(await f.read("collectionRoot"), tree.root);
  assert.equal(await f.read("ownershipVerifier"), f.verifier.account.address);
  await assert.rejects(f.deploy([zeroHash, f.verifier.account.address]));
  await assert.rejects(f.deploy([tree.root, zeroAddress]));
});

test("deposits require raw 32-byte calldata and zero ETH", async () => {
  const f = await fixture();
  for (const data of ["0x", "0x1234", zeroHash, `${id}01`]) {
    await assert.rejects(f.seller.sendTransaction({ to: f.market, data }));
  }
  await assert.rejects(f.seller.sendTransaction({ to: f.market, data: id, value: 1n }));
  const receipt = await f.deposit();
  assert.equal(await f.read("potentialDeposits", [f.seller.account.address, id]), receipt.blockNumber);
  await assert.rejects(f.deposit());
});

test("listings require a deposit, collection proof, and price above the fixed fee", async () => {
  const f = await fixture();
  await assert.rejects(f.write(f.seller, "list", [id, price, proof]));
  await f.deposit();
  await assert.rejects(f.write(f.seller, "list", [id, price, []]));
  for (const p of [0n, fee - 1n, fee]) await assert.rejects(f.write(f.seller, "list", [id, p, proof]));
  const otherId = tree.entries.find((entry) => entry.number === 10).id;
  assert.equal(await f.read("isCollectionMember", [otherId, proof]), false);
  await f.write(f.seller, "list", [id, fee + 1n, proof]);
  assert.equal((await f.read("listings", [f.seller.account.address, id]))[0], fee + 1n);
});

test("purchase and cup withdrawal enforce the five-block cooldown", async () => {
  const f = await fixture();
  await f.deposit();
  await f.write(f.seller, "list", [id, price, proof]);
  await assert.rejects(f.write(f.buyer, "buy", await f.authorize(), price));
  await assert.rejects(f.write(f.seller, "withdrawEthscription", [id]));
  await f.mine();
  await f.write(f.seller, "withdrawEthscription", [id]);
});

test("sale emits the exact ESIP-2 transfer and credits seller and treasury separately", async () => {
  const f = await fixture();
  await f.prepare();
  const authorization = await f.authorize();
  assert.equal(await f.read("purchaseDigest", [authorization[0]]), hashTypedData(purchaseTypedData(foundry.id, f.market, authorization[0])));
  const receipt = await f.write(f.buyer, "buy", authorization, price);
  assert.deepEqual(transferFrom(receipt), {
    previousOwner: f.seller.account.address, recipient: f.buyer.account.address, ethscriptionId: id,
  });
  assert.equal(await f.read("proceeds", [f.seller.account.address]), price - fee);
  assert.equal(await f.read("proceeds", [treasury]), fee);
  assert.equal(await f.rpc.getBalance({ address: f.market }), price);
  assert.equal((await f.read("listings", [f.seller.account.address, id]))[0], 0n);
  assert.equal(await f.read("potentialDeposits", [f.seller.account.address, id]), 0n);
  await assert.rejects(f.write(f.buyer, "buy", authorization, price));
  const before = await f.rpc.getBalance({ address: f.attacker.account.address });
  await f.write(f.seller, "withdrawProceeds", [f.attacker.account.address]);
  assert.equal(await f.rpc.getBalance({ address: f.attacker.account.address }), before + price - fee);
  assert.equal(await f.read("proceeds", [f.seller.account.address]), 0n);
  await assert.rejects(f.write(f.seller, "withdrawProceeds", [f.seller.account.address]));
  // Treasury is unlocked only on this in-memory test chain; no real key is used.
  await f.deployer.sendTransaction({ to: treasury, value: parseEther("1") });
  const treasuryClient = createWalletClient({ account: treasury, chain: foundry, transport: custom(f.provider) });
  await f.write(treasuryClient, "withdrawProceeds", [treasury]);
  assert.equal(await f.read("proceeds", [treasury]), 0n);
  assert.equal(await f.rpc.getBalance({ address: f.market }), 0n);
});

test("underpayment, overpayment, another buyer and seller self-purchases fail", async () => {
  const f = await fixture();
  await f.prepare();
  const authorization = await f.authorize();
  for (const value of [price - 1n, price + 1n]) await assert.rejects(f.write(f.buyer, "buy", authorization, value));
  await assert.rejects(f.write(f.attacker, "buy", authorization, price));
  await assert.rejects(f.write(f.seller, "buy", await f.authorize({ buyer: f.seller.account.address }), price));
  assert.equal(await f.rpc.getBalance({ address: f.market }), 0n);
});

test("invalid verifier, chain, market, stale nonce and stale deposit reject authorization", async () => {
  const f = await fixture();
  await f.prepare();
  const cases = [
    await f.authorize({}, f.attacker),
    await f.authorize({}, f.verifier, { chainId: 1 }),
    await f.authorize({}, f.verifier, { verifyingContract: f.attacker.account.address }),
    await f.authorize({ listingNonce: 999n }),
    await f.authorize({ depositBlock: 1n }),
    await f.authorize({ price: price + 1n }),
  ];
  for (const authorization of cases) await assert.rejects(f.write(f.buyer, "buy", authorization, price));
  assert.equal(await f.rpc.getBalance({ address: f.market }), 0n);
});

test("authorization expires and cannot be issued for more than five minutes ahead", async () => {
  const f = await fixture();
  await f.prepare();
  const now = (await f.rpc.getBlock()).timestamp;
  await assert.rejects(f.write(f.buyer, "buy", await f.authorize({ deadline: now - 1n }), price));
  await assert.rejects(f.write(f.buyer, "buy", await f.authorize({ deadline: now + 3600n }), price));
  await assert.rejects(f.write(f.buyer, "buy", await f.authorize({ issuedAt: now + 60n, deadline: now + 120n }), price));
  const shortLived = await f.authorize();
  await f.provider.request({ method: "evm_increaseTime", params: [61] });
  await f.mine(1);
  await assert.rejects(f.write(f.buyer, "buy", shortLived, price));
});

test("repricing and cancellation invalidate old signatures even at the same price", async () => {
  const f = await fixture();
  await f.prepare();
  const first = await f.authorize();
  await f.write(f.seller, "list", [id, price, proof]);
  await assert.rejects(f.write(f.buyer, "buy", first, price));
  const second = await f.authorize();
  await assert.rejects(f.write(f.attacker, "cancelListing", [id]));
  await f.write(f.seller, "cancelListing", [id]);
  assert.ok(await f.read("potentialDeposits", [f.seller.account.address, id]));
  await f.write(f.seller, "list", [id, price, proof]);
  await assert.rejects(f.write(f.buyer, "buy", second, price));
  await f.write(f.buyer, "buy", await f.authorize(), price);
});

test("withdrawal and redeposit cannot reuse a previous epoch's authorization", async () => {
  const f = await fixture();
  await f.prepare();
  const old = await f.authorize();
  await f.write(f.seller, "withdrawEthscription", [id]);
  await f.deposit();
  await f.write(f.seller, "list", [id, price, proof]);
  await f.mine();
  await assert.rejects(f.write(f.buyer, "buy", old, price));
  await f.write(f.buyer, "buy", await f.authorize(), price);
});

test("false deposits stay isolated and ESIP-2 rejects a false claimant's withdrawal", async () => {
  const f = await fixture();
  await f.prepare();
  const originalDeposit = await f.read("potentialDeposits", [f.seller.account.address, id]);
  await f.deposit(f.attacker);
  await f.write(f.attacker, "list", [id, price, proof]);
  await f.mine();
  assert.equal(await f.read("potentialDeposits", [f.seller.account.address, id]), originalDeposit);
  const forged = await f.authorize({
    seller: f.attacker.account.address,
    listingNonce: (await f.read("listings", [f.attacker.account.address, id]))[1],
    depositBlock: await f.read("potentialDeposits", [f.attacker.account.address, id]),
  }, f.attacker);
  await assert.rejects(f.write(f.buyer, "buy", forged, price));
  // Model the protocol's enforcement using the real events: the false
  // claimant's withdrawal is ignored, the genuine depositor's is accepted.
  let owner = f.market;
  const previousOwner = f.seller.account.address;
  const apply = (receipt) => {
    const event = transferFrom(receipt);
    if (owner === f.market && event.previousOwner === previousOwner) owner = event.recipient;
  };
  apply(await f.write(f.attacker, "withdrawEthscription", [id]));
  assert.equal(owner, f.market);
  apply(await f.write(f.seller, "withdrawEthscription", [id]));
  assert.equal(owner, f.seller.account.address);
});

test("withdrawal needs neither a verifier signature nor collection membership", async () => {
  const f = await fixture();
  const unknown = `0x${"ab".repeat(32)}`;
  await f.deposit(f.seller, unknown);
  await f.mine();
  const receipt = await f.write(f.seller, "withdrawEthscription", [unknown]);
  assert.equal(transferFrom(receipt).recipient, f.seller.account.address);
  assert.equal(await f.read("potentialDeposits", [f.seller.account.address, unknown]), 0n);
});

test("minimum sale preserves one wei for seller and the entire fixed fee", async () => {
  const f = await fixture();
  await f.deposit();
  await f.write(f.seller, "list", [id, fee + 1n, proof]);
  await f.mine();
  await f.write(f.buyer, "buy", await f.authorize(), fee + 1n);
  assert.equal(await f.read("proceeds", [f.seller.account.address]), 1n);
  assert.equal(await f.read("proceeds", [treasury]), fee);
});

test("a rejecting seller cannot block sales, and failed ETH withdrawals preserve credit", async () => {
  const f = await fixture();
  const hash = await f.deployer.deployContract({ abi: sellerArtifact.abi, bytecode: `0x${sellerArtifact.evm.bytecode.object}`, args: [f.market] });
  const actor = (await f.rpc.waitForTransactionReceipt({ hash })).contractAddress;
  const actorWrite = async (functionName, args) => {
    const hash = await f.deployer.writeContract({ address: actor, abi: sellerArtifact.abi, functionName, args });
    return f.rpc.waitForTransactionReceipt({ hash });
  };
  await actorWrite("depositAndList", [id, price, proof]);
  await actorWrite("configure", [true, false]);
  await f.mine();
  const listing = await f.read("listings", [actor, id]);
  const authorization = await f.authorize({
    seller: actor, price: listing[0], listingNonce: listing[1],
    depositBlock: await f.read("potentialDeposits", [actor, id]),
  });
  await f.write(f.buyer, "buy", authorization, price);
  await assert.rejects(actorWrite("withdrawTo", [actor]));
  assert.equal(await f.read("proceeds", [actor]), price - fee);
  await actorWrite("configure", [false, true]);
  await actorWrite("withdrawTo", [actor]);
  assert.equal(await f.rpc.readContract({ address: actor, abi: sellerArtifact.abi, functionName: "reentrySucceeded" }), false);
  assert.equal(await f.rpc.getBalance({ address: actor }), price - fee);
  assert.equal(await f.read("proceeds", [actor]), 0n);
});

test("proceeds cannot be claimed by another account or redirected to invalid recipients", async () => {
  const f = await fixture();
  await f.prepare();
  await f.write(f.buyer, "buy", await f.authorize(), price);
  await assert.rejects(f.write(f.attacker, "withdrawProceeds", [f.attacker.account.address]));
  await assert.rejects(f.write(f.seller, "withdrawProceeds", [zeroAddress]));
  await assert.rejects(f.write(f.seller, "withdrawProceeds", [f.market]));
  assert.equal(await f.read("proceeds", [f.seller.account.address]), price - fee);
});

test("fee recipient selling a cup is credited once for the entire listed price", async () => {
  const f = await fixture();
  await f.deployer.sendTransaction({ to: treasury, value: parseEther("1") });
  const treasuryClient = createWalletClient({ account: treasury, chain: foundry, transport: custom(f.provider) });
  await f.deposit(treasuryClient);
  await f.write(treasuryClient, "list", [id, price, proof]);
  await f.mine();
  const listing = await f.read("listings", [treasury, id]);
  const authorization = await f.authorize({
    seller: treasury, price: listing[0], listingNonce: listing[1],
    depositBlock: await f.read("potentialDeposits", [treasury, id]),
  });
  await f.write(f.buyer, "buy", authorization, price);
  assert.equal(await f.read("proceeds", [treasury]), price);
  assert.equal(await f.rpc.getBalance({ address: f.market }), price);
});

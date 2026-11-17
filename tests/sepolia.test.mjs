import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createPublicClient, createWalletClient, custom, parseEther, stringToHex, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { compileContracts } from "../contracts/scripts/build.mjs";
import { createSepoliaEngine } from "../scripts/sepolia/engine.mjs";
import { verifyCreation } from "../scripts/sepolia/setup.mjs";
import { typescriptLoader } from "./load-typescript.mjs";

const localRequire = createRequire(new URL("../contracts/package.json", import.meta.url));
const ganache = localRequire("ganache");
const load = typescriptLoader();
const { buildCollectionProfile, marketCollection } = load("src/lib/market/collection.ts");
const { createMarketService } = load("src/lib/market/service.ts");
const { createMarketIndexer } = load("src/lib/market/indexer.ts");
const { decodePurchase, SALE_FEE } = load("src/lib/market/types.ts");
const artifact = compileContracts().output.contracts["CupscriptionsMarket.sol"].CupscriptionsMarket;

async function fixture(t) {
  // All secrets in this fixture are deterministic Ganache accounts. The public
  // Ethereum Sepolia RPC and real wallet are never used by these tests.
  const provider = ganache.provider({ logging: { quiet: true }, chain: { chainId: 11155111, hardfork: "shanghai" }, wallet: { deterministic: true, totalAccounts: 5 } });
  t.after(() => provider.disconnect());
  const wallets = Object.values(provider.getInitialAccounts()).map(({ secretKey }) => createWalletClient({ chain: sepolia,
    account: privateKeyToAccount(secretKey), transport: custom(provider) }));
  const [deployer, seller, buyer, attacker, verifier] = wallets;
  const client = createPublicClient({ chain: sepolia, transport: custom(provider), cacheTime: 0, pollingInterval: 10 });
  const mine = async (count = 1) => { for (let i = 0; i < count; i++) await provider.request({ method: "evm_mine", params: [] }); };
  const manifest = { version: 1, chainId: 11155111, name: "Cupscriptions Sepolia Test", initialOwner: seller.account.address, items: [] };
  const plan = { owner: seller.account.address, items: [] };
  for (let number = 1; number <= 3; number++) {
    const contentUri = `data:image/svg+xml;rule=esip6;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><text>Sepolia Test Cup ${number}</text></svg>`).toString("base64")}`;
    plan.items.push({ number, contentUri });
    const hash = await seller.sendTransaction({ to: seller.account.address, value: 0n, data: stringToHex(contentUri) });
    await client.waitForTransactionReceipt({ hash });
    await mine();
    manifest.items.push(await verifyCreation(client, plan, number, hash));
  }
  const engine = createSepoliaEngine({ client, loadManifest: async () => manifest });
  const profile = buildCollectionProfile(11155111, manifest);
  const market = (await client.waitForTransactionReceipt({ hash: await deployer.deployContract({
    abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [profile.root, verifier.account.address],
  }) })).contractAddress;
  const write = async (wallet, functionName, args, value = 0n) => client.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: market, abi: artifact.abi, functionName, args, value }),
  });
  const fetcher = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/status") return Response.json(await engine.status());
    const records = await engine.records();
    if (url.pathname.startsWith("/ethscriptions/")) {
      const record = records.find((item) => item.transaction_hash === url.pathname.split("/").at(-1));
      return Response.json(record ? { result: record } : { error: "Not in this test collection" }, { status: record ? 200 : 404 });
    }
    const rows = records.filter((row) => ["current_owner", "previous_owner"].every((key) => !url.searchParams.has(key) ||
      row[key].toLowerCase() === url.searchParams.get(key).toLowerCase()));
    return Response.json({ result: rows, pagination: { has_more: false, page_key: null } });
  };
  const indexer = createMarketIndexer("http://127.0.0.1:3031", fetcher, 11155111);
  const config = { address: market, chain: sepolia, rpcUrl: "http://127.0.0.1:8545", indexerUrl: "http://127.0.0.1:3031" };
  const service = createMarketService(config, client, indexer, verifier.account, Date.now, profile);
  return { provider, client, seller, buyer, attacker, verifier, manifest, plan, engine, profile, market, write, mine, service, indexer };
}

test("three real local creations use a separate root, and the mainnet root is preserved", async (t) => {
  const f = await fixture(t);
  assert.equal(marketCollection().root, "0xf41a0c0b48998aa4264d72b1d2e35fb1992a29b0d50e21e3432a13ad37d98e90");
  assert.notEqual(f.profile.root, marketCollection().root);
  assert.throws(() => buildCollectionProfile(11155111, { ...f.manifest, items: [] }), /three separate confirmed/);
  assert.throws(() => marketCollection(84532), /Unsupported/);
  assert.throws(() => buildCollectionProfile(84532, f.manifest), /Unsupported/);
  const mainnetHash = marketCollection().byId.get(6).ethscriptionId;
  assert.throws(() => buildCollectionProfile(11155111, { ...f.manifest, items: [{ ...f.manifest.items[0], ethscriptionId: mainnetHash }, ...f.manifest.items.slice(1)] }));
  assert.throws(() => buildCollectionProfile(11155111, { ...f.manifest, items: f.manifest.items.slice(0, 2) }));
  assert.throws(() => buildCollectionProfile(11155111, { ...f.manifest, items: [f.manifest.items[0], f.manifest.items[0], f.manifest.items[2]] }));
  await f.engine.sync();
  assert.equal((await f.engine.status()).ready, true);
  assert.equal((await f.engine.status()).tracked_count, 3);
  for (const record of await f.engine.records()) {
    assert.equal(record.current_owner, f.seller.account.address.toLowerCase());
    assert.equal(record.ethscription_number, null); // Never invent a global ordinal.
  }
});

test("real indexer events drive deposit, signed buy, ownership and recovery", async (t) => {
  const f = await fixture(t);
  const id = f.manifest.items[0].ethscriptionId;
  const price = parseEther("0.001");
  await f.client.waitForTransactionReceipt({ hash: await f.seller.sendTransaction({ to: f.market, data: id }) });
  await f.write(f.seller, "list", [id, price, f.profile.proofFor(id)]);
  await f.mine(5);
  await f.engine.sync();
  const offer = await f.service.cup(1, f.seller.account.address);
  assert.equal(offer.cups[0].verified, true);
  assert.equal(offer.cups[0].testnet, true);
  assert.equal(offer.cups[0].seller.toLowerCase(), f.seller.account.address.toLowerCase());
  assert.equal((await f.service.list()).cups.length, 1);
  // While the contract really owns the cup, a false claimant's ESIP-2 event
  // must still fail the previous-owner condition.
  await f.client.waitForTransactionReceipt({ hash: await f.attacker.sendTransaction({ to: f.market, data: id }) });
  await f.mine(5);
  await f.write(f.attacker, "withdrawEthscription", [id]);
  await f.engine.sync();
  const stillEscrowed = (await f.engine.records()).find((row) => row.transaction_hash === id);
  assert.equal(stillEscrowed.current_owner, f.market.toLowerCase());
  assert.equal(stillEscrowed.previous_owner, f.seller.account.address.toLowerCase());
  const signed = await f.service.authorize(1, f.buyer.account.address, { seller: f.seller.account.address, priceWei: price.toString(), nonce: "1" });
  await f.write(f.buyer, "buy", [decodePurchase(signed.authorization), signed.signature], price);
  await f.engine.sync();
  let record = (await f.engine.records()).find((row) => row.transaction_hash === id);
  assert.equal(record.current_owner, f.buyer.account.address.toLowerCase());
  assert.equal(record.previous_owner, f.market.toLowerCase());
  assert.equal(record.ethscription_transfers.at(-1).enforced_previous_owner.toLowerCase(), f.seller.account.address.toLowerCase());
  assert.equal(record.ethscription_transfers.at(-1).event_log_index, 0);
  assert.equal((await f.service.list()).cups.length, 0);
  assert.equal((await f.service.list(f.seller.account.address)).proceedsWei, (price - SALE_FEE).toString());
  await f.write(f.seller, "withdrawProceeds", [f.seller.account.address]);
  await f.engine.sync();
  assert.equal((await f.service.list(f.seller.account.address)).proceedsWei, "0");

  // A false claimant can register an L1 potential deposit and emit an ESIP-2
  // return, but that log cannot move an inscription owned by the buyer.
  await f.client.waitForTransactionReceipt({ hash: await f.attacker.sendTransaction({ to: f.market, data: id }) });
  await f.mine(5);
  await f.write(f.attacker, "withdrawEthscription", [id]);
  await f.engine.sync();
  record = (await f.engine.records()).find((row) => row.transaction_hash === id);
  assert.equal(record.current_owner, f.buyer.account.address.toLowerCase());

  await f.client.waitForTransactionReceipt({ hash: await f.buyer.sendTransaction({ to: f.market, data: id }) });
  await f.mine(5);
  await f.write(f.buyer, "withdrawEthscription", [id]);
  await f.engine.sync();
  record = (await f.engine.records()).find((row) => row.transaction_hash === id);
  assert.equal(record.current_owner, f.buyer.account.address.toLowerCase());
  assert.equal(record.ethscription_transfers.length, 5); // Creation, deposit, buy, deposit, return.
});

test("bulk transfers follow the current owner and failed raw transfers are ignored", async (t) => {
  const f = await fixture(t);
  const ids = f.manifest.items.slice(1).map((item) => item.ethscriptionId);
  const bulk = `0x${ids.map((id) => id.slice(2)).join("")}`;
  await f.client.waitForTransactionReceipt({ hash: await f.seller.sendTransaction({ to: f.buyer.account.address, data: bulk }) });
  await f.client.waitForTransactionReceipt({ hash: await f.attacker.sendTransaction({ to: f.attacker.account.address, data: bulk }) });
  await f.engine.sync();
  const rows = await f.engine.records();
  for (const id of ids) assert.equal(rows.find((row) => row.transaction_hash === id).current_owner, f.buyer.account.address.toLowerCase());
  // Market fallback rejects a nonzero-value deposit. The transaction really
  // reverts on the local EVM, and therefore transfers no protocol ownership.
  const failed = await f.client.waitForTransactionReceipt({ hash: await f.buyer.sendTransaction({ to: f.market, data: ids[0], value: 1n, gas: 100000n }) });
  assert.equal(failed.status, "reverted");
  await f.engine.sync();
  assert.equal((await f.engine.records()).find((row) => row.transaction_hash === ids[0]).current_owner, f.buyer.account.address.toLowerCase());
});

test("creation validation rejects wrong networks, calldata, value and canonical hashes", async (t) => {
  const f = await fixture(t);
  const item = f.manifest.items[0];
  const check = (client, plan = f.plan) => verifyCreation(client, plan, 1, item.ethscriptionId);
  await assert.rejects(check({ ...f.client, getChainId: async () => 84532 }));
  await assert.rejects(check(f.client, { ...f.plan, owner: f.attacker.account.address }));
  await assert.rejects(check(f.client, { ...f.plan, items: [{ number: 1, contentUri: "data:text/plain,bogus" }] }));
  await assert.rejects(check({ ...f.client, getTransaction: async (args) => ({ ...await f.client.getTransaction(args), value: 1n }) }));
  await assert.rejects(check({ ...f.client, getTransaction: async (args) => ({ ...await f.client.getTransaction(args), hash: zeroHash }) }));
  await assert.rejects(check({ ...f.client, getBlock: async (args) => ({ ...await f.client.getBlock(args), hash: zeroHash }) }));
  const bad = createSepoliaEngine({ client: f.client, loadManifest: async () => ({ ...f.manifest, items: [{ ...item, creationBlockHash: zeroHash }, ...f.manifest.items.slice(1)] }) });
  await assert.rejects(bad.sync());
  await assert.rejects(bad.records());
  const wrong = createSepoliaEngine({ client: { ...f.client, getChainId: async () => 84532 }, loadManifest: async () => f.manifest });
  await assert.rejects(wrong.sync());
});

test("an empty manifest and a wrong-network indexer cannot authorize test trading", async (t) => {
  const f = await fixture(t);
  const empty = createSepoliaEngine({ client: f.client, loadManifest: async () => ({ ...f.manifest, items: [] }) });
  await empty.sync();
  const status = await empty.status();
  assert.equal(status.waiting_for_creations, true);
  assert.equal(status.ready, false);
  await assert.rejects(empty.records());
  for (const status of [
    { chain_id: 1, ready: true, current_block_number: "100", last_imported_block: "100" },
    { chain_id: 84532, ready: true, current_block_number: "100", last_imported_block: "100" },
    { ready: true, current_block_number: "100", last_imported_block: "100" },
    { chain_id: 11155111, ready: false, current_block_number: "100", last_imported_block: "100" },
  ]) await assert.rejects(createMarketIndexer("http://localhost", async () => Response.json(status), 11155111).assertFresh(100n));
});

test("a transfer removed by a real local reorg is discarded before reads resume", async (t) => {
  const f = await fixture(t);
  await f.engine.sync();
  const checkpoint = await f.provider.request({ method: "evm_snapshot", params: [] });
  const id = f.manifest.items[0].ethscriptionId;
  await f.client.waitForTransactionReceipt({ hash: await f.seller.sendTransaction({ to: f.buyer.account.address, data: id }) });
  await f.engine.sync();
  assert.equal((await f.engine.records()).find((row) => row.transaction_hash === id).current_owner, f.buyer.account.address.toLowerCase());
  await f.provider.request({ method: "evm_revert", params: [checkpoint] });
  await assert.rejects(f.engine.records());
  await f.engine.sync();
  assert.equal((await f.engine.records()).find((row) => row.transaction_hash === id).current_owner, f.seller.account.address.toLowerCase());
});

test("setup filesystem endpoints are disabled in production and reject cross-origin requests", async () => {
  const { GET, POST } = load("src/app/api/sepolia/setup/route.ts");
  const before = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.equal((await GET(new Request("http://localhost:3000/api/sepolia/setup"))).status, 404);
    assert.equal((await POST(new Request("http://localhost:3000/api/sepolia/setup", { method: "POST" }))).status, 404);
    process.env.NODE_ENV = "development";
    assert.equal((await GET(new Request("https://cupscriptions.test/api/sepolia/setup"))).status, 404);
    const request = (origin, body = {}) => new Request("http://localhost:3000/api/sepolia/setup", { method: "POST", headers: {
      "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}),
    }, body: JSON.stringify(body) });
    assert.equal((await POST(request("https://unrelated.example"))).status, 404);
    assert.equal((await POST(request(null))).status, 403);
    assert.equal((await POST(request("http://localhost:3000", { number: 1, transactionHash: zeroHash, chainId: 1 }))).status, 400);
    assert.equal((await POST(request("http://localhost:3000", { junk: "x".repeat(600) }))).status, 413);
  } finally { if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before; }
});

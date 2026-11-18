import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createPublicClient, createWalletClient, custom, parseEther, recoverTypedDataAddress, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { typescriptLoader } from "./load-typescript.mjs";
import { compileContracts } from "../contracts/scripts/build.mjs";
import { buildCollection } from "../contracts/scripts/collection.mjs";

const contractsRequire = createRequire(new URL("../contracts/package.json", import.meta.url));
const ganache = contractsRequire("ganache");
let activeMarket = null;
const load = typescriptLoader({ "@/lib/market/server": { getMarketService: () => activeMarket } });
const { marketAbi } = load("src/lib/market/abi.generated.ts");
const { createMarketService } = load("src/lib/market/service.ts");
const { createMarketIndexer } = load("src/lib/market/indexer.ts");
const { readMarketConfig } = load("src/lib/market/config.ts");
const { readPurchaseRequest } = load("src/lib/market/http.ts");
const { purchaseTypedData, decodePurchase, SALE_FEE } = load("src/lib/market/types.ts");
const { marketCollection } = load("src/lib/market/collection.ts");
const tree = buildCollection();
const artifact = compileContracts().output.contracts["CupscriptionsMarket.sol"].CupscriptionsMarket;
const id = tree.entries.find((entry) => entry.number === 6).id;
const price = parseEther("0.01");

function clone(value) { return JSON.parse(JSON.stringify(value)); }

async function fixture() {
  const provider = ganache.provider({ logging: { quiet: true }, chain: { chainId: foundry.id, hardfork: "shanghai" }, wallet: { deterministic: true, totalAccounts: 5 } });
  const accounts = Object.values(provider.getInitialAccounts()).map(({ secretKey }) => privateKeyToAccount(secretKey));
  const clients = accounts.map((account) => createWalletClient({ chain: foundry, account, transport: custom(provider) }));
  const [deployer, seller, buyer, attacker, verifier] = clients;
  const rpc = createPublicClient({ chain: foundry, transport: custom(provider), cacheTime: 0, pollingInterval: 10 });
  const deployed = await deployer.deployContract({ abi: marketAbi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [tree.root, verifier.account.address] });
  const market = (await rpc.waitForTransactionReceipt({ hash: deployed })).contractAddress;
  const config = { address: market, chain: foundry, rpcUrl: "http://127.0.0.1:8545", indexerUrl: "http://127.0.0.1:9000" };
  const receipt = await rpc.waitForTransactionReceipt({ hash: await seller.sendTransaction({ to: market, data: id }) });
  const transaction = await rpc.getTransaction({ hash: receipt.transactionHash });
  const record = {
    transaction_hash: id, current_owner: market, previous_owner: seller.account.address,
    ethscription_transfers: [{
      ethscription_transaction_hash: id, transaction_hash: receipt.transactionHash,
      from_address: seller.account.address, to_address: market,
      block_number: receipt.blockNumber.toString(), block_blockhash: receipt.blockHash,
      transaction_index: transaction.transactionIndex.toString(), transfer_index: "0", event_log_index: null,
    }],
  };
  const state = { record, stale: false, malformed: false, down: false, cursor: null, queries: [] };
  const indexer = createMarketIndexer(config.indexerUrl, async (url, options) => {
    state.queries.push({ url, cache: options.cache });
    if (state.down) throw new Error("upstream-provider-secret-marker");
    if (state.malformed) return Response.json({ unexpected: true });
    const path = new URL(url).pathname;
    const head = await rpc.getBlockNumber({ cacheTime: 0 });
    if (path === "/status") return Response.json({ last_imported_block: Number(state.stale ? head - 1n : head), current_block_number: Number(head), blocks_behind: state.stale ? 1 : 0 });
    if (path.startsWith("/ethscriptions/")) return Response.json({ result: state.record });
    if (path === "/ethscriptions") {
      const query = new URL(url).searchParams;
      const matches = state.record.current_owner.toLowerCase() === market.toLowerCase() &&
        (!query.get("previous_owner") || query.get("previous_owner").toLowerCase() === state.record.previous_owner.toLowerCase());
      return Response.json({ result: matches ? [state.record] : [], pagination: { has_more: state.cursor !== null, page_key: state.cursor } });
    }
    throw new Error("Unexpected indexer request");
  });
  const service = (signer = verifier.account, client = rpc) => createMarketService(config, client, indexer, signer);
  const write = async (wallet, functionName, args, value = 0n) => {
    const hash = await wallet.writeContract({ address: market, abi: marketAbi, functionName, args, value });
    return rpc.waitForTransactionReceipt({ hash });
  };
  await write(seller, "list", [id, price, tree.proofFor(id)]);
  for (let i = 0; i < 5; i++) await provider.request({ method: "evm_mine", params: [] });
  const expected = { seller: seller.account.address, priceWei: price.toString(), nonce: "1" };
  return { provider, rpc, seller, buyer, attacker, verifier, market, receipt, record, state, config, indexer, service, write, expected };
}

test("website Merkle root and every proof agree with the contract package", () => {
  const web = marketCollection();
  assert.equal(web.root, tree.root);
  for (const entry of tree.entries) assert.deepEqual(Array.from(web.proofs.get(entry.id)), tree.proofFor(entry.id));
});

test("configuration keeps mainnet, testnet and local indexers separate", () => {
  assert.equal(readMarketConfig({}), null);
  const base = { MARKET_ADDRESS: "0x1111111111111111111111111111111111111111", MARKET_CHAIN_ID: "1", MARKET_RPC_URL: "https://ethereum-rpc.publicnode.com" };
  assert.equal(readMarketConfig(base).chain.id, 1);
  assert.throws(() => readMarketConfig({ ...base, MARKET_CHAIN_ID: "11155111" }));
  assert.throws(() => readMarketConfig({ ...base, MARKET_CHAIN_ID: "31337", NODE_ENV: "production", MARKET_INDEXER_URL: "https://indexer.invalid" }));
  assert.throws(() => readMarketConfig({ ...base, MARKET_RPC_URL: "http://public.example.com" }));
  assert.throws(() => readMarketConfig({ ...base, MARKET_RPC_URL: "not-a-url" }));
});

test("verifier and API complete a local deposit, list, buy and proceeds lifecycle", async (t) => {
  const f = await fixture();
  t.after(() => f.provider.disconnect());
  const service = f.service();
  const listing = await service.list();
  assert.equal(listing.market.canTrade, true);
  assert.equal(listing.cups[0].id, 6);
  const wallet = await service.list(f.seller.account.address);
  assert.equal(wallet.cups[0].inEscrow, true);
  assert.equal(wallet.proceedsWei, "0");
  assert.ok(f.state.queries.every((entry) => entry.cache === "no-store"));
  const signed = await service.authorize(6, f.buyer.account.address, f.expected);
  const auth = decodePurchase(signed.authorization);
  assert.equal((await recoverTypedDataAddress({ ...purchaseTypedData(foundry.id, f.market, auth), signature: signed.signature })).toLowerCase(), f.verifier.account.address.toLowerCase());
  assert.equal(auth.price, price);
  assert.equal(auth.deadline - auth.issuedAt, 60n);
  const sale = await f.write(f.buyer, "buy", [auth, signed.signature], price);
  assert.equal(sale.status, "success");
  f.state.record = { ...f.record, current_owner: f.buyer.account.address, previous_owner: f.market };
  assert.equal((await service.list()).cups.length, 0);
  const afterSale = await service.list(f.seller.account.address);
  assert.equal(BigInt(afterSale.proceedsWei), price - SALE_FEE);
  await f.write(f.seller, "withdrawProceeds", [f.seller.account.address]);
  assert.equal((await service.list(f.seller.account.address)).proceedsWei, "0");
  await assert.rejects(service.authorize(6, f.buyer.account.address, f.expected));
});

test("verifier fails closed for fake or stale ownership and mismatched receipts", async (t) => {
  const f = await fixture(); t.after(() => f.provider.disconnect());
  const check = () => f.service().authorize(6, f.buyer.account.address, f.expected);
  const original = clone(f.record);
  const invalidRecords = [
    { ...original, current_owner: f.seller.account.address },
    { ...original, previous_owner: f.attacker.account.address },
    { ...original, transaction_hash: zeroHash },
    { ...original, ethscription_transfers: [] },
    { ...original, ethscription_transfers: [{ ...original.ethscription_transfers[0], block_blockhash: zeroHash }] },
    { ...original, ethscription_transfers: [{ ...original.ethscription_transfers[0], event_log_index: 0 }] },
    { ...original, ethscription_transfers: [{ ...original.ethscription_transfers[0], transaction_index: "999" }] },
  ];
  for (const record of invalidRecords) { f.state.record = record; await assert.rejects(check()); }
  f.state.record = original;
  f.state.stale = true; await assert.rejects(check());
  f.state.stale = false; f.state.malformed = true; await assert.rejects(check());
  f.state.malformed = false; f.state.down = true; await assert.rejects(check());
  f.state.down = false;
  await assert.rejects(f.service(f.attacker.account).authorize(6, f.buyer.account.address, f.expected));
  await assert.rejects(f.service(null).authorize(6, f.buyer.account.address, f.expected));
  for (const expected of [{ ...f.expected, priceWei: "1" }, { ...f.expected, nonce: "2" }, { ...f.expected, seller: f.attacker.account.address }]) {
    await assert.rejects(f.service().authorize(6, f.buyer.account.address, expected));
  }
  await assert.rejects(f.service().authorize(6, f.seller.account.address, f.expected));
  await assert.rejects(f.service().authorize(5001, f.buyer.account.address, f.expected));
  // An attacker can really register and list a potential deposit on L1. The
  // canonical indexer still identifies the genuine seller; the website must not
  // advertise or authorize the attacker's offer.
  await f.rpc.waitForTransactionReceipt({ hash: await f.attacker.sendTransaction({ to: f.market, data: id }) });
  await f.write(f.attacker, "list", [id, price, tree.proofFor(id)]);
  assert.equal((await f.service().list()).cups[0].seller.toLowerCase(), f.seller.account.address.toLowerCase());
  await assert.rejects(f.service().authorize(6, f.buyer.account.address, { ...f.expected, seller: f.attacker.account.address }));
  for (const mismatch of [
    { ...f.rpc, getTransaction: async (args) => ({ ...await f.rpc.getTransaction(args), hash: zeroHash }) },
    { ...f.rpc, getTransactionReceipt: async (args) => ({ ...await f.rpc.getTransactionReceipt(args), transactionHash: zeroHash }) },
    { ...f.rpc, getTransactionReceipt: async (args) => ({ ...await f.rpc.getTransactionReceipt(args), transactionIndex: 999 }) },
    { ...f.rpc, getTransaction: async (args) => ({ ...await f.rpc.getTransaction(args), input: zeroHash }) },
    { ...f.rpc, getTransaction: async (args) => ({ ...await f.rpc.getTransaction(args), value: 1n }) },
    { ...f.rpc, getTransactionReceipt: async (args) => ({ ...await f.rpc.getTransactionReceipt(args), status: "reverted" }) },
  ]) await assert.rejects(f.service(f.verifier.account, mismatch).authorize(6, f.buyer.account.address, f.expected));
});

test("wrong runtime, wrong chain, stale RPC head and reorgs are rejected", async (t) => {
  const f = await fixture(); t.after(() => f.provider.disconnect());
  const wrongCode = { ...f.rpc, getCode: async () => "0x60006000" };
  await assert.rejects(f.service(f.verifier.account, wrongCode).list());
  const wrongChain = { ...f.rpc, getChainId: async () => 1 };
  await assert.rejects(f.service(f.verifier.account, wrongChain).list());
  const oldHead = { ...f.rpc, getBlock: async (args) => {
    const block = await f.rpc.getBlock(args); return { ...block, timestamp: block.timestamp - 1000n };
  } };
  await assert.rejects(f.service(f.verifier.account, oldHead).list());
  let snapshotNumber;
  const reorg = { ...f.rpc, getBlock: async (args) => {
    const block = await f.rpc.getBlock(args);
    if (!args?.blockNumber) snapshotNumber = block.number;
    return args?.blockNumber === snapshotNumber ? { ...block, hash: zeroHash } : block;
  } };
  await assert.rejects(f.service(f.verifier.account, reorg).authorize(6, f.buyer.account.address, f.expected));
});

test("verifier and indexer downtime preserve cup and ETH recovery", async (t) => {
  const f = await fixture(); t.after(() => f.provider.disconnect());
  const unsigned = f.service(null);
  assert.equal((await unsigned.cup(6, f.seller.account.address)).market.canTrade, false);
  f.state.down = true;
  const recovery = await unsigned.cup(6, f.seller.account.address);
  assert.equal(recovery.claim.remainingBlocks, 0);
  assert.ok(recovery.error);
  await f.write(f.seller, "withdrawEthscription", [id]);
  assert.equal((await unsigned.cup(6, f.seller.account.address)).claim, null);
  const wallet = await unsigned.list(f.seller.account.address);
  assert.equal(wallet.proceedsWei, "0");
  assert.ok(wallet.error);
});

test("purchase route validates input, strips provider errors, and never signs arbitrary payloads", async (t) => {
  const f = await fixture(); t.after(() => f.provider.disconnect());
  activeMarket = f.service();
  const { POST } = load("src/app/api/market/authorize/route.ts");
  const { GET } = load("src/app/api/market/route.ts");
  const input = { cup: 6, buyer: f.buyer.account.address, ...f.expected };
  const request = (body, extra = {}) => new Request("https://cupscriptions.test/api/market/authorize", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://cupscriptions.test", ...extra }, body: JSON.stringify(body),
  });
  const valid = await POST(request(input));
  assert.equal(valid.status, 200);
  assert.equal(valid.headers.get("cache-control"), "no-store");
  const json = await valid.json();
  assert.equal(json.authorization.buyer.toLowerCase(), f.buyer.account.address.toLowerCase());
  assert.equal(Object.hasOwn(json, "privateKey"), false);
  assert.equal((await POST(request({ ...input, chainId: 1 }))).status, 400);
  assert.equal((await POST(request({ ...input, cup: "6" }))).status, 400);
  assert.equal((await POST(request({ ...input, buyer: "invalid" }))).status, 400);
  assert.equal((await POST(request(input, { Origin: "https://unrelated.example" }))).status, 403);
  assert.equal((await POST(request(input, { "Content-Type": "text/plain" }))).status, 415);
  assert.equal((await POST(request({ ...input, nonce: "2" }))).status, 409);
  assert.equal((await GET(new Request("https://cupscriptions.test/api/market?wallet=invalid"))).status, 400);
  assert.equal((await GET(new Request("https://cupscriptions.test/api/market?cursor=%22"))).status, 400);
  activeMarket = { authorize: async () => { throw new Error("private-key-or-provider-secret-marker"); } };
  const failed = await POST(request(input));
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes("secret-marker"));
  activeMarket = null;
  assert.equal((await POST(request(input))).status, 503);
  assert.equal((await (await GET(new Request("https://cupscriptions.test/api/market"))).json()).market, null);
});

test("large purchase bodies are rejected before signature work", async () => {
  const request = new Request("https://cupscriptions.test/api/market/authorize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ junk: "x".repeat(3000) }) });
  await assert.rejects(readPurchaseRequest(request), /too large/);
});

test("same-origin checks work behind Next's internal hostname and HTTPS proxy", async () => {
  const body = { cup: 6, buyer: "0x1111111111111111111111111111111111111111", seller: "0x2222222222222222222222222222222222222222", priceWei: price.toString(), nonce: "1" };
  const request = new Request("http://localhost:3010/api/market/authorize", {
    method: "POST", headers: { "Content-Type": "application/json", Host: "cupscriptions.test", "x-forwarded-proto": "https", Origin: "https://cupscriptions.test" },
    body: JSON.stringify(body),
  });
  assert.equal((await readPurchaseRequest(request)).cup, 6);
  const other = new Request("http://localhost:3010/api/market/authorize", {
    method: "POST", headers: { "Content-Type": "application/json", Host: "cupscriptions.test", "x-forwarded-proto": "https", Origin: "https://unrelated.example" }, body: JSON.stringify(body),
  });
  await assert.rejects(readPurchaseRequest(other), /origin/);
});

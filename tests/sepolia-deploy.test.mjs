import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createPublicClient, createWalletClient, custom, encodeDeployData, keccak256, stringToHex, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { compileContracts } from "../contracts/scripts/build.mjs";
import { typescriptLoader } from "./load-typescript.mjs";

const ganache = createRequire(new URL("../contracts/package.json", import.meta.url))("ganache");
const artifact = compileContracts().output.contracts["CupscriptionsMarket.sol"].CupscriptionsMarket;
const load = typescriptLoader();
const { verifyDeployment, DeploymentPending, InvalidDeployment } = load("src/lib/sepolia/deployment-check.ts");
const { confirmDeployment } = load("src/lib/sepolia/deploy-client.ts");
const root = keccak256(stringToHex("Local deployment fixture collection"));

async function fixture(t) {
  const provider = ganache.provider({ logging: { quiet: true }, chain: { chainId: 11155111, hardfork: "shanghai" }, wallet: { deterministic: true, totalAccounts: 3 } });
  t.after(() => provider.disconnect());
  const accounts = Object.values(provider.getInitialAccounts()).map(({ secretKey }) => privateKeyToAccount(secretKey));
  const wallet = createWalletClient({ chain: sepolia, account: accounts[0], transport: custom(provider) });
  const rpc = createPublicClient({ chain: sepolia, transport: custom(provider), cacheTime: 0, pollingInterval: 10 });
  const data = encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [root, accounts[1].address] });
  const hash = await wallet.sendTransaction({ data, value: 0n });
  const receipt = await rpc.waitForTransactionReceipt({ hash });
  const expected = { root, verifier: accounts[1].address, deployer: wallet.account.address, data };
  return { provider, rpc, hash, receipt, expected, accounts };
}

test("an actual Sepolia-ID local deployment needs two confirmations and verifies all immutables", async (t) => {
  const f = await fixture(t);
  await assert.rejects(verifyDeployment(f.rpc, f.expected, f.hash), DeploymentPending);
  await f.provider.request({ method: "evm_mine", params: [] });
  const verified = await verifyDeployment(f.rpc, f.expected, f.hash);
  assert.equal(verified.address.toLowerCase(), f.receipt.contractAddress.toLowerCase());
  assert.equal(verified.root, root);
  assert.equal(verified.verifier, f.accounts[1].address);
  assert.equal(verified.chainId, 11155111);
  for (const expected of [
    { ...f.expected, root: zeroHash }, { ...f.expected, verifier: f.accounts[2].address },
    { ...f.expected, deployer: f.accounts[2].address }, { ...f.expected, data: "0x1234" },
  ]) await assert.rejects(verifyDeployment(f.rpc, expected, f.hash), InvalidDeployment);
  await assert.rejects(verifyDeployment({ ...f.rpc, getChainId: async () => 84532 }, f.expected, f.hash), InvalidDeployment);
  await assert.rejects(verifyDeployment({ ...f.rpc, getCode: async () => "0x60006000" }, f.expected, f.hash), InvalidDeployment);
  await assert.rejects(verifyDeployment({ ...f.rpc, getTransactionReceipt: async (args) => ({ ...await f.rpc.getTransactionReceipt(args), status: "reverted" }) }, f.expected, f.hash), InvalidDeployment);
});

test("deployment checking retries status without broadcasting and stops for an invalid deployment", async () => {
  const hash = `0x${"1".repeat(64)}`;
  const responses = [Response.json({ state: "pending", confirmations: 1 }, { status: 202 }),
    Response.json({ state: "confirmed", deployment: { transactionHash: hash, address: "0x1111111111111111111111111111111111111111" } })];
  let calls = 0;
  const record = await confirmDeployment(hash, new AbortController().signal, () => {}, async (url, init) => {
    calls++; assert.equal(url, "/api/sepolia/deploy"); assert.equal(JSON.parse(init.body).transactionHash, hash); return responses.shift();
  }, async () => {});
  assert.equal(calls, 2);
  assert.equal(record.transactionHash, hash);
  await assert.rejects(confirmDeployment(hash, new AbortController().signal, () => {}, async () => Response.json({ error: "Wrong deployment" }, { status: 409 })), /Wrong deployment/);
});

test("deployment API is local-only and accepts only a bounded transaction hash", async () => {
  let calls = 0;
  let pending = true;
  const hash = `0x${"1".repeat(64)}`;
  const route = typescriptLoader({
    "@/lib/sepolia/deployment-check": { DeploymentPending, InvalidDeployment },
    "@/lib/sepolia/deployment-server": { getDeploymentPlan: async () => ({ root }), registerDeployment: async () => {
      calls++; if (pending) throw new DeploymentPending(1); return { transactionHash: hash };
    } },
  })("src/app/api/sepolia/deploy/route.ts");
  const previous = process.env.NODE_ENV;
  const request = (body, origin = "http://localhost:3012") => new Request("http://localhost:3012/api/sepolia/deploy", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    process.env.NODE_ENV = "production";
    assert.equal((await route.GET(new Request("http://localhost:3012/api/sepolia/deploy"))).status, 404);
    process.env.NODE_ENV = "development";
    assert.equal((await route.POST(request({ transactionHash: hash }, "https://unrelated.example"))).status, 404);
    assert.equal((await route.POST(request({ transactionHash: hash, address: "0x1111111111111111111111111111111111111111" }))).status, 400);
    assert.equal((await route.POST(request({ junk: "x".repeat(300) }))).status, 413);
    assert.equal(calls, 0);
    assert.equal((await route.POST(request({ transactionHash: hash }))).status, 202);
    pending = false;
    assert.equal((await route.POST(request({ transactionHash: hash }))).status, 200);
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});

test("a verified public record activates only the isolated local Sepolia preview", () => {
  const saved = { ...process.env };
  let record = null;
  const configs = [];
  const service = typescriptLoader({
    "node:fs": { readFileSync: () => { if (!record) throw Object.assign(new Error(), { code: "ENOENT" }); return JSON.stringify(record); } },
    "./service": { createMarketService: (config) => { configs.push(config); return { config }; } },
    "./indexer": { createMarketIndexer: () => ({}) },
  })("src/lib/market/server.ts");
  try {
    Object.assign(process.env, { NODE_ENV: "development", CUPSCRIPTIONS_SEPOLIA_PREVIEW: "1", MARKET_ADDRESS: "", MARKET_CHAIN_ID: "11155111",
      MARKET_RPC_URL: "https://ethereum-sepolia-rpc.publicnode.com", MARKET_INDEXER_URL: "http://127.0.0.1:3031" });
    assert.equal(service.getMarketService(), null);
    record = { chainId: 11155111, address: "0x1111111111111111111111111111111111111111" };
    assert.equal(service.getMarketService().config.address, record.address);
    assert.equal(service.getMarketService().config.chain.id, 11155111);
    assert.equal(configs.length, 1);
    process.env.NODE_ENV = "production";
    assert.equal(service.getMarketService(), null);
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  }
});

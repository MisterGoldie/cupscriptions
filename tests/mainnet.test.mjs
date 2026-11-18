import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createPublicClient, createWalletClient, custom, encodeDeployData, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { compileContracts } from "../contracts/scripts/build.mjs";
import { typescriptLoader } from "./load-typescript.mjs";

const ganache = createRequire(new URL("../contracts/package.json", import.meta.url))("ganache");
const artifact = compileContracts().output.contracts["CupscriptionsMarket.sol"].CupscriptionsMarket;
const load = typescriptLoader();
const { marketCollection } = load("src/lib/market/collection.ts");
const { verifyDeployment, DeploymentPending, InvalidDeployment } = load("src/lib/sepolia/deployment-check.ts");
const { confirmDeployment } = load("src/lib/sepolia/deploy-client.ts");
const root = marketCollection(1).root;

test("mainnet deployment verifies the 5000-cup root and twelve confirmations on an isolated EVM", async (t) => {
  // Chain ID 1 here belongs only to an in-memory Ganache provider. No public
  // mainnet transaction, real wallet secret or real ETH is used by this test.
  const provider = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1, hardfork: "shanghai" }, wallet: { deterministic: true, totalAccounts: 3 } });
  t.after(() => provider.disconnect());
  const accounts = Object.values(provider.getInitialAccounts()).map(({ secretKey }) => privateKeyToAccount(secretKey));
  const wallet = createWalletClient({ chain: mainnet, account: accounts[0], transport: custom(provider) });
  const rpc = createPublicClient({ chain: mainnet, transport: custom(provider), cacheTime: 0, pollingInterval: 10 });
  const data = encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [root, accounts[1].address] });
  const hash = await wallet.sendTransaction({ data, value: 0n });
  await rpc.waitForTransactionReceipt({ hash });
  const expected = { root, verifier: accounts[1].address, deployer: accounts[0].address, data };
  await assert.rejects(verifyDeployment(rpc, expected, hash, 1, 12), (error) => error instanceof DeploymentPending && error.requiredConfirmations === 12);
  for (let i = 0; i < 11; i++) await provider.request({ method: "evm_mine", params: [] });
  const result = await verifyDeployment(rpc, expected, hash, 1, 12);
  assert.equal(result.chainId, 1);
  assert.equal(result.root, "0xf41a0c0b48998aa4264d72b1d2e35fb1992a29b0d50e21e3432a13ad37d98e90");
  await assert.rejects(verifyDeployment(rpc, expected, hash, 11155111, 2), InvalidDeployment);
  await assert.rejects(verifyDeployment({ ...rpc, getTransaction: async (args) => ({ ...await rpc.getTransaction(args), chainId: 11155111 }) }, expected, hash, 1, 12), InvalidDeployment);
  await assert.rejects(verifyDeployment(rpc, { ...expected, verifier: accounts[2].address }, hash, 1, 12), InvalidDeployment);
});

test("mainnet receipt checks use the mainnet endpoint and its required confirmation count", async () => {
  const hash = `0x${"1".repeat(64)}`;
  const replies = [Response.json({ state: "pending", confirmations: 4, requiredConfirmations: 12 }, { status: 202 }),
    Response.json({ state: "confirmed", deployment: { chainId: 1, transactionHash: hash } })];
  const messages = [];
  const record = await confirmDeployment(hash, new AbortController().signal, (message) => messages.push(message), async (url) => {
    assert.equal(url, "/api/mainnet/deploy"); return replies.shift();
  }, async () => {}, "/api/mainnet/deploy", 12);
  assert.equal(record.chainId, 1);
  assert.match(messages[0], /4 \/ 12 confirmations/);
  assert.match(messages[0], /Ethereum mainnet/);
});

test("mainnet deployment API is disabled in production, Sepolia preview and conflicting previews", async () => {
  const saved = { ...process.env };
  let calls = 0;
  const route = typescriptLoader({
    "@/lib/sepolia/deployment-check": { DeploymentPending, InvalidDeployment },
    "@/lib/mainnet/deployment-server": { getMainnetDeploymentPlan: async () => { calls++; return { chainId: 1, root }; },
      registerMainnetDeployment: async () => { calls++; throw new DeploymentPending(4, 12); } },
  })("src/app/api/mainnet/deploy/route.ts");
  const get = () => new Request("http://localhost:3014/api/mainnet/deploy");
  const post = (body, origin = "http://localhost:3014") => new Request("http://localhost:3014/api/mainnet/deploy", { method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    Object.assign(process.env, { NODE_ENV: "production", CUPSCRIPTIONS_MAINNET_PREVIEW: "1", CUPSCRIPTIONS_SEPOLIA_PREVIEW: "0" });
    assert.equal((await route.GET(get())).status, 404);
    Object.assign(process.env, { NODE_ENV: "development", CUPSCRIPTIONS_MAINNET_PREVIEW: "0", CUPSCRIPTIONS_SEPOLIA_PREVIEW: "1" });
    assert.equal((await route.GET(get())).status, 404);
    process.env.CUPSCRIPTIONS_MAINNET_PREVIEW = "1";
    assert.equal((await route.GET(get())).status, 404);
    process.env.CUPSCRIPTIONS_SEPOLIA_PREVIEW = "0";
    assert.equal(calls, 0);
    assert.equal((await route.GET(get())).status, 200);
    const hash = `0x${"1".repeat(64)}`;
    assert.equal((await route.POST(post({ transactionHash: hash }, "https://unrelated.example"))).status, 404);
    assert.equal((await route.POST(post({ transactionHash: hash, address: "0x1111111111111111111111111111111111111111" }))).status, 400);
    const pending = await route.POST(post({ transactionHash: hash }));
    assert.equal(pending.status, 202);
    assert.equal((await pending.json()).requiredConfirmations, 12);
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  }
});

test("mainnet review displays real ETH, original collection and a funding shortfall", () => {
  const plan = { chainId: 1, deployer: "0xcbBcf40247425932d728585dA2678567e7F8E42f", root,
    verifier: "0x1111111111111111111111111111111111111111", feeRecipient: "0xcbBcf40247425932d728585dA2678567e7F8E42f", feeWei: "1000000000000",
    data: "0x1234", dataHash: keccak256("0x1234"), gasLimit: "1700000", estimatedFeeWei: "500000000000000", balanceWei: "100000000000000",
    fundingNeededWei: "400000000000000", requiredConfirmations: 12, indexerReady: true, deployment: null };
  const renderLoad = typescriptLoader({
    "@tanstack/react-query": { useQuery: () => ({ data: plan, isPending: false, isError: false, isFetching: false }), useQueryClient: () => ({}) },
    wagmi: { useAccount: () => ({ address: plan.deployer }), useConfig: () => ({}) }, "wagmi/actions": {},
    "next/navigation": { useRouter: () => ({ refresh() {} }) }, "./WalletButton": { WalletButton: () => null },
  });
  const { SepoliaDeployment } = renderLoad("src/components/SepoliaDeployment.tsx");
  const html = renderToStaticMarkup(React.createElement(SepoliaDeployment, { network: "mainnet" }));
  assert.match(html, /Original 5,000-cup collection root/);
  assert.match(html, /real ETH/);
  assert.match(html, /Additional mainnet ETH needed/);
  assert.match(html, /0.0004 ETH/);
  assert.match(html, /disabled=""[^>]*>Deploy marketplace on Ethereum mainnet/);
});

test("the mainnet deployment record cannot activate the Sepolia preview", () => {
  const saved = { ...process.env };
  let recordChain = 1;
  const loadedPaths = [];
  const service = typescriptLoader({
    "node:fs": { readFileSync: (filename) => { loadedPaths.push(filename); return JSON.stringify({ chainId: recordChain, address: "0x1111111111111111111111111111111111111111" }); } },
    "./service": { createMarketService: (config) => ({ config }) }, "./indexer": { createMarketIndexer: () => ({}) },
  })("src/lib/market/server.ts");
  try {
    Object.assign(process.env, { NODE_ENV: "development", CUPSCRIPTIONS_MAINNET_PREVIEW: "1", CUPSCRIPTIONS_SEPOLIA_PREVIEW: "0", MARKET_ADDRESS: "", MARKET_CHAIN_ID: "1",
      MARKET_RPC_URL: "https://ethereum-rpc.publicnode.com", MARKET_INDEXER_URL: "https://api.ethscriptions.com/v2" });
    assert.equal(service.getMarketService().config.chain.id, 1);
    assert.match(loadedPaths.at(-1), /\.mainnet/);
    Object.assign(process.env, { CUPSCRIPTIONS_MAINNET_PREVIEW: "0", CUPSCRIPTIONS_SEPOLIA_PREVIEW: "1", MARKET_CHAIN_ID: "11155111" });
    assert.throws(() => service.getMarketService(), /could not be verified/);
    recordChain = 11155111;
    assert.equal(service.getMarketService().config.chain.id, 11155111);
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  }
});

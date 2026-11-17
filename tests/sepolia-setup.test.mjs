import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { typescriptLoader } from "./load-typescript.mjs";

const load = typescriptLoader();
const { createNextCup, confirmCreation, SetupMessage } = load("src/lib/sepolia/setup.ts");
const hashes = [1, 2, 3].map((n) => `0x${String(n).repeat(64)}`);
const plan = { chainId: 11155111, batch: "regression", owner: "0xcbbcf40247425932d728585da2678567e7f8e42f",
  balanceWei: "52500000000000000", rpcAvailable: true, root: null,
  indexer: { ready: false, tracked_count: 0, waiting_for_creations: true },
  items: [1, 2, 3].map((number) => ({ number, data: "0x1234", transactionHash: number === 1 ? hashes[0] : null })),
};

test("a stale page resumes at cup 2 and never waits on or recreates confirmed cup 1", async () => {
  const stale = { ...plan, items: plan.items.map((item) => ({ ...item, transactionHash: null })) };
  let saved = [{ number: 1, hash: hashes[0] }];
  const sent = [], checked = [];
  const result = await createNextCup(stale, {
    load: async () => plan, readSaved: () => saved, save: (value) => { saved = value; },
    send: async (item) => { sent.push(item.number); return hashes[item.number - 1]; },
    confirm: async (number, hash) => { checked.push({ number, hash }); return { state: "confirmed", confirmed: number, root: null }; },
  });
  assert.deepEqual(sent, [2]);
  assert.deepEqual(checked, [{ number: 2, hash: hashes[1] }]);
  assert.equal(result.created, 2);
  assert.equal(result.plan.items[0].transactionHash, hashes[0]);
  assert.equal(result.plan.items[1].transactionHash, hashes[1]);
  assert.equal(result.plan.items[2].transactionHash, null);
});

test("a timed-out confirmation can resume without broadcasting its cup twice", async () => {
  let saved = [];
  let sent = 0;
  const dependencies = { load: async () => plan, readSaved: () => saved, save: (value) => { saved = value; },
    send: async () => { sent++; return hashes[1]; },
    confirm: async () => { throw new SetupMessage("Status check timed out"); },
  };
  await assert.rejects(createNextCup(plan, dependencies), /timed out/);
  assert.equal(saved[0].hash, hashes[1]);
  const result = await createNextCup(plan, { ...dependencies, confirm: async (number) => ({ state: "confirmed", confirmed: number, root: null }) });
  assert.equal(sent, 1);
  assert.equal(result.plan.items[1].transactionHash, hashes[1]);
});

test("server confirmation progresses through pending and RPC outage without browser block polling", async () => {
  const responses = [Response.json({ state: "pending", confirmations: 1, requiredConfirmations: 2 }, { status: 202 }),
    Response.json({ error: "RPC unavailable" }, { status: 503 }),
    Response.json({ state: "confirmed", confirmed: 2, root: null })];
  const progress = [];
  const result = await confirmCreation(2, hashes[1], { signal: new AbortController().signal,
    progress: (message) => progress.push(message), pause: async () => {},
    fetcher: async (url, init) => {
      assert.equal(url, "/api/sepolia/setup");
      assert.equal(init.method, "POST");
      assert.equal(JSON.parse(init.body).transactionHash, hashes[1]);
      return responses.shift();
    },
  });
  assert.equal(result.confirmed, 2);
  assert.match(progress[0], /1 \/ 2 confirmations/);
  assert.match(progress[1], /temporarily unavailable/);
});

test("invalid receipts and stopped checks reject instead of leaving an endless waiter", async () => {
  let calls = 0;
  await assert.rejects(confirmCreation(2, hashes[1], { signal: new AbortController().signal, progress: () => {},
    fetcher: async () => { calls++; return Response.json({ error: "Wrong transaction" }, { status: 409 }); },
  }), /Wrong transaction/);
  assert.equal(calls, 1);
  await assert.rejects(confirmCreation(2, hashes[1], { signal: AbortSignal.abort(), progress: () => {}, fetcher: async () => { throw new Error("Should not fetch"); } }), /stopped/);
  await assert.rejects(confirmCreation(2, hashes[1], { signal: new AbortController().signal, progress: () => {}, timeoutMs: 0 }), /saved/);
});

test("setup view shows cup 1 confirmed, cup 2 next and why the indexer is waiting", () => {
  const renderLoad = typescriptLoader({
    "@tanstack/react-query": { useQuery: () => ({ data: plan, isPending: false, isError: false }), useQueryClient: () => ({}) },
    wagmi: { useAccount: () => ({ address: plan.owner }), useConfig: () => ({}) },
    "wagmi/actions": {},
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "./WalletButton": { WalletButton: () => null },
  });
  const { SepoliaSetup } = renderLoad("src/components/SepoliaSetup.tsx");
  const html = renderToStaticMarkup(React.createElement(SepoliaSetup));
  assert.match(html, /Create or check test cup #2/);
  assert.match(html, new RegExp(`https://sepolia.etherscan.io/tx/${hashes[0]}`));
  assert.match(html, /starts after all 3 cups are created/);
  assert.ok(!html.includes("Waiting for two confirmations for test cup #1"));
});

test("setup API preserves progress during a balance RPC failure and distinguishes pending from unavailable", async () => {
  class CreationPendingError extends Error { constructor() { super(); this.confirmations = 1; } }
  class InvalidCreationError extends Error {}
  let mode = "pending";
  const routeLoad = typescriptLoader({ "../../../../../scripts/sepolia/setup.mjs": {
    CreationPendingError, InvalidCreationError,
    preparePlan: async () => ({ ...plan, items: plan.items.map((item) => ({ ...item, contentUri: "data:text/plain,test" })) }),
    readManifest: async () => ({ chainId: 11155111, items: [] }), manifestTree: () => null,
    testnetClient: () => ({ getChainId: async () => { throw new Error("provider-secret-marker"); } }),
    registerCreation: async () => {
      if (mode === "pending") throw new CreationPendingError();
      if (mode === "invalid") throw new InvalidCreationError();
      if (mode === "unavailable") throw new Error("provider-secret-marker");
    },
  } });
  const { GET, POST } = routeLoad("src/app/api/sepolia/setup/route.ts");
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const status = await GET(new Request("http://localhost:3012/api/sepolia/setup"));
    assert.equal(status.status, 200);
    const data = await status.json();
    assert.equal(data.balanceWei, null);
    assert.equal(data.items[0].transactionHash, hashes[0]);
    const request = () => new Request("http://localhost:3012/api/sepolia/setup", { method: "POST", headers: { Origin: "http://localhost:3012", "Content-Type": "application/json" }, body: JSON.stringify({ number: 2, transactionHash: hashes[1] }) });
    const pending = await POST(request());
    assert.equal(pending.status, 202);
    assert.equal((await pending.json()).confirmations, 1);
    mode = "unavailable";
    const unavailable = await POST(request());
    assert.equal(unavailable.status, 503);
    assert.ok(!(await unavailable.text()).includes("secret-marker"));
    mode = "invalid";
    assert.equal((await POST(request())).status, 409);
    mode = "confirmed";
    assert.equal((await (await POST(request())).json()).state, "confirmed");
  } finally { if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before; }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const collection = JSON.parse(fs.readFileSync(path.join(root, "src/data/cupscriptions.json"), "utf8"));

const address = "0xcbbcf40247425932d728585da2678567e7f8e42f";

function loadModule(filename, imports, extraGlobals = {}) {
  const source = fs.readFileSync(path.join(root, filename), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require: (name) => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
      return imports[name];
    },
    URL,
    AbortSignal,
    ...extraGlobals,
  }, { filename });
  return exports;
}

function ownershipWith(fetch) {
  const traits = loadModule("src/lib/traits.ts", {
    "@/data/cupscriptions.json": collection,
  });
  return loadModule("src/lib/ownership.ts", { "@/lib/traits": traits }, { fetch });
}

function record(id) {
  return {
    transaction_hash: collection.collection_items.find(
      (cup) => cup.name === `Cupscription #${id}`,
    ).ethscription_id,
    current_owner: address,
  };
}

function page(result, has_more = false, page_key = null) {
  return Response.json({ result, pagination: { has_more, page_key } });
}

test("matches real collection hashes across pages, excludes other art, and deduplicates", async () => {
  const calls = [];
  const { fetchOwnedCups } = ownershipWith(async (url, options) => {
    calls.push({ url: new URL(url), options });
    return calls.length === 1
      ? page([
        record(1003),
        { transaction_hash: `0x${"a".repeat(64)}`, current_owner: address },
        record(6),
      ], true, "next-page")
      : page([record(1000), record(6), record(10), record(1001)]);
  });
  const cups = await fetchOwnedCups(address.toUpperCase().replace("0X", "0x"));
  assert.deepEqual(Array.from(cups, (cup) => cup.id), [6, 10, 1000, 1001, 1003]);
  assert.equal(cups[0].name, "Cupscription #6");
  assert.equal(cups[0].ethscriptionId, record(6).transaction_hash);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.origin, "https://api.ethscriptions.com");
  assert.equal(calls[0].url.searchParams.get("current_owner"), address);
  assert.equal(calls[1].url.searchParams.get("page_key"), "next-page");
  assert.equal(calls[0].options.cache, "no-store");
});

test("returns an empty collection for a valid empty ownership result", async () => {
  const { fetchOwnedCups } = ownershipWith(async () => page([]));
  assert.equal((await fetchOwnedCups(address)).length, 0);
});

test("rejects invalid addresses before requesting ownership", async () => {
  const { fetchOwnedCups } = ownershipWith(async () => assert.fail("Unexpected request"));
  await assert.rejects(fetchOwnedCups("invalid"), /Invalid wallet address/);
});

test("reports provider failures and malformed responses instead of an empty wallet", async () => {
  for (const response of [
    new Response("unavailable", { status: 503 }),
    Response.json({ items: [] }),
  ]) {
    const { fetchOwnedCups } = ownershipWith(async () => response);
    await assert.rejects(fetchOwnedCups(address), /Ethscriptions API returned/);
  }
});

test("does not return partial ownership when pagination is missing or repeated", async () => {
  for (const cursor of [null, "repeated-page"]) {
    let calls = 0;
    const { fetchOwnedCups } = ownershipWith(async () => {
      calls += 1;
      assert.ok(calls <= 2, "Pagination must not loop indefinitely");
      return page([record(6)], true, cursor);
    });
    await assert.rejects(fetchOwnedCups(address), /invalid ownership pagination/);
  }
});

test("rejects ownership records for a different wallet", async () => {
  const { fetchOwnedCups } = ownershipWith(async () => page([
    { ...record(6), current_owner: `0x${"0".repeat(40)}` },
  ]));
  await assert.rejects(fetchOwnedCups(address), /invalid ownership record/);
});

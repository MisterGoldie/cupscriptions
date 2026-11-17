import "./env.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { isAddress } from "viem";
import { createSepoliaEngine } from "./engine.mjs";
import { atomicJson, readManifest, stateDir, testnetClient } from "./setup.mjs";

const statePath = path.join(stateDir, "indexer-state.json");
let initialState = null;
try { initialState = JSON.parse(await fs.readFile(statePath, "utf8")); } catch { /* First boot replays from the creation blocks. */ }
const engine = createSepoliaEngine({ client: testnetClient(), loadManifest: readManifest,
  initialState, saveState: (value) => atomicJson(statePath, value) });
const port = Number(process.env.SEPOLIA_INDEXER_PORT ?? "3031");
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local indexer port");
const send = (response, status, data) => { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); response.end(JSON.stringify(data)); };

const server = http.createServer(async (request, response) => {
  if (request.method !== "GET") return send(response, 405, { error: "Read-only indexer" });
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (["/status", "/health"].includes(url.pathname)) return send(response, 200, await engine.status());
    if (url.pathname === "/ethscriptions") {
      const owner = url.searchParams.get("current_owner"), previous = url.searchParams.get("previous_owner");
      if ([owner, previous].some((value) => value && !isAddress(value, { strict: false }))) return send(response, 400, { error: "Invalid address" });
      const limit = Number(url.searchParams.get("max_results") ?? "24");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) return send(response, 400, { error: "Invalid page size" });
      const rows = (await engine.records()).filter((row) => (!owner || row.current_owner.toLowerCase() === owner.toLowerCase()) && (!previous || row.previous_owner.toLowerCase() === previous.toLowerCase()));
      const cursor = url.searchParams.get("page_key");
      const index = cursor ? rows.findIndex((row) => row.transaction_hash === cursor) : -1;
      if (cursor && index === -1) return send(response, 400, { error: "Invalid page cursor" });
      const result = rows.slice(index + 1, index + 1 + limit);
      return send(response, 200, { result, pagination: { has_more: index + 1 + limit < rows.length, page_key: result.at(-1)?.transaction_hash ?? null } });
    }
    const match = /^\/ethscriptions\/(0x[0-9a-fA-F]{64})$/.exec(url.pathname);
    if (match) {
      const result = (await engine.records()).find((row) => row.transaction_hash === match[1].toLowerCase());
      return send(response, result ? 200 : 404, result ? { result } : { error: "Inscription is outside this test collection" });
    }
    send(response, 404, { error: "Not found" });
  } catch { send(response, 503, { error: "Sepolia indexer is unavailable, syncing, or waiting for confirmed test inscriptions" }); }
});

let stopping = false;
async function poll() {
  try { await engine.sync(); } catch { /* Status/data endpoints fail closed until the next successful sync. */ }
  if (!stopping) setTimeout(poll, 3000);
}
await engine.sync();
server.listen(port, "127.0.0.1", () => console.log(`Sepolia test indexer: http://127.0.0.1:${port} (read-only, collection-scoped)`));
setTimeout(poll, 3000);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; server.close(() => process.exit(0)); });

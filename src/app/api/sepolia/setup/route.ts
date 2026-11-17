import { stringToHex } from "viem";
import { CreationPendingError, InvalidCreationError, manifestTree, preparePlan, readManifest, registerCreation, testnetClient } from "../../../../../scripts/sepolia/setup.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

// This tool writes the developer's test manifest. It is never enabled on Vercel
// or another production host, even if a caller supplies a localhost Host header.
function localRequest(request: Request) {
  if (process.env.NODE_ENV !== "development") return false;
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? url.host;
    const origin = new URL(`http://${host}`);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) return false;
    const caller = request.headers.get("origin");
    if (caller && caller !== origin.origin) return false;
    if (request.headers.get("sec-fetch-site") === "cross-site") return false;
    return true;
  } catch { return false; }
}

export async function GET(request: Request) {
  if (!localRequest(request)) return json({ error: "Test creation is available only in local development." }, 404);
  try {
    const plan = await preparePlan();
    const manifest = await readManifest();
    let balance: bigint | null = null;
    try {
      const client = testnetClient(undefined, { timeout: 4000, retryCount: 0 });
      if (await client.getChainId() !== 11155111) throw new Error("Wrong network");
      balance = await client.getBalance({ address: plan.owner });
    } catch { /* Persisted progress remains visible during an RPC outage. */ }
    let indexer = null;
    try {
      const port = Number(process.env.SEPOLIA_INDEXER_PORT ?? "3031");
      if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid port");
      const response = await fetch(`http://127.0.0.1:${port}/status`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
      const data = response.ok ? await response.json() : null;
      if (data?.chain_id === 11155111) indexer = data;
    } catch { /* The setup page also works before the local indexer starts. */ }
    return json({ chainId: 11155111, owner: plan.owner, batch: plan.batch, balanceWei: balance?.toString() ?? null, rpcAvailable: balance !== null,
      root: manifestTree(manifest)?.root ?? null, indexer,
      items: plan.items.map((item: { number: number; contentUri: string; transactionHash: string | null }) => ({
        number: item.number, data: stringToHex(item.contentUri), transactionHash: item.transactionHash,
      })),
    });
  } catch { return json({ error: "Sepolia setup could not be loaded. Check the Ethereum Sepolia RPC and local setup files." }, 503); }
}

export async function POST(request: Request) {
  if (!localRequest(request)) return json({ error: "Test creation is available only in local development." }, 404);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "Expected JSON." }, 415);
  // Require a same-origin browser submission for filesystem mutations.
  if (!request.headers.get("origin")) return json({ error: "A local same-origin request is required." }, 403);
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 512) return json({ error: "Request is too large." }, 413);
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Missing request body." }, 400);
    let length = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 512) { await reader.cancel(); return json({ error: "Request is too large." }, 413); }
      chunks.push(chunk.value);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!input || Object.keys(input).sort().join(",") !== "number,transactionHash" || ![1, 2, 3].includes(input.number) ||
        typeof input.transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input.transactionHash)) {
      return json({ error: "Provide a test cup number and creation transaction hash." }, 400);
    }
    await registerCreation(testnetClient(), input.number, input.transactionHash);
    const manifest = await readManifest();
    return json({ state: "confirmed", confirmed: input.number, root: manifestTree(manifest)?.root ?? null });
  } catch (error) {
    if (error instanceof CreationPendingError) return json({ state: "pending", confirmations: error.confirmations, requiredConfirmations: 2 }, 202);
    if (error instanceof InvalidCreationError) return json({ error: "This transaction does not match the prepared test cup and successful Sepolia receipt. Check the transaction link before continuing." }, 409);
    return json({ error: "Sepolia verification is temporarily unavailable. Your submitted transaction is saved; check it again shortly." }, 503);
  }
}

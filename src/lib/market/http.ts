import { NextResponse } from "next/server";
import { getAddress, isAddress, type Address } from "viem";
import { MarketError, marketError } from "./errors";

export function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
export function failure(error: unknown) {
  const result = marketError(error);
  return json({ error: result.error }, result.status);
}
export function walletParam(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false }) || /^0x0{40}$/i.test(value)) {
    throw new MarketError("Invalid wallet address.", 400);
  }
  return getAddress(value);
}
export function cursorParam(value: string | null) {
  if (value !== null && !/^[a-zA-Z0-9:_-]{1,200}$/.test(value)) throw new MarketError("Invalid page cursor.", 400);
  return value ?? undefined;
}
export async function readPurchaseRequest(request: Request) {
  const url = new URL(request.url);
  // Next may normalize request.url to its internal hostname. Host and the
  // platform's forwarded protocol describe the browser-facing origin.
  const host = request.headers.get("host") ?? url.host;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.slice(0, -1);
  const origin = request.headers.get("origin");
  if (origin && (!/^(http|https)$/.test(protocol) || origin !== `${protocol}://${host}`)) {
    throw new MarketError("Request origin is not allowed.", 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new MarketError("A JSON request is required.", 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new MarketError("Invalid purchase request.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2048) { await reader.cancel(); throw new MarketError("Purchase request is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new MarketError("Invalid purchase request.", 400); }
  if (!body || Array.isArray(body) || Object.keys(body).sort().join(",") !== "buyer,cup,nonce,priceWei,seller" ||
      !Number.isInteger(body.cup) || body.cup < 1 || body.cup > 5000 ||
      typeof body.priceWei !== "string" || !/^[1-9]\d{0,77}$/.test(body.priceWei) ||
      typeof body.nonce !== "string" || !/^[1-9]\d{0,77}$/.test(body.nonce)) {
    throw new MarketError("Invalid purchase request.", 400);
  }
  return { cup: body.cup as number, buyer: walletParam(body.buyer), seller: walletParam(body.seller),
    priceWei: body.priceWei as string, nonce: body.nonce as string };
}

// Best-effort per-instance abuse control. Signing remains ownership checked and
// buyer bound; this limiter is not an authentication or ownership mechanism.
const windows = new Map<string, { until: number; count: number }>();
let signing = 0;
export function limitSigning(request: Request) {
  const now = Date.now();
  for (const [key, entry] of windows) if (entry.until <= now) windows.delete(key);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.slice(0,100) ?? "local";
  const entry = windows.get(ip) ?? { until: now + 60_000, count: 0 };
  if (entry.count >= 20 || signing >= 4 || (!windows.has(ip) && windows.size >= 1024)) {
    throw new MarketError("Too many purchase checks. Please try again shortly.", 429);
  }
  entry.count++;
  windows.set(ip, entry);
  signing++;
  return () => { signing--; };
}

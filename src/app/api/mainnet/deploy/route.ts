import { localJson, localRequest } from "@/lib/sepolia/local-http";
import { DeploymentPending, InvalidDeployment } from "@/lib/sepolia/deployment-check";
import { getMainnetDeploymentPlan, registerMainnetDeployment } from "@/lib/mainnet/deployment-server";
import type { Hex } from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const allowed = (request: Request) => localRequest(request) && process.env.CUPSCRIPTIONS_MAINNET_PREVIEW === "1" && process.env.CUPSCRIPTIONS_SEPOLIA_PREVIEW !== "1";

export async function GET(request: Request) {
  if (!allowed(request)) return localJson({ error: "Mainnet deployment setup is available only in the isolated local mainnet preview." }, 404);
  try { return localJson(await getMainnetDeploymentPlan()); }
  catch { return localJson({ error: "Mainnet deployment could not be prepared. Check the mainnet verifier, RPC and compiled contract artifacts." }, 503); }
}

export async function POST(request: Request) {
  if (!allowed(request)) return localJson({ error: "Mainnet deployment setup is available only in the isolated local mainnet preview." }, 404);
  if (!request.headers.get("origin")) return localJson({ error: "A local same-origin request is required." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return localJson({ error: "Expected JSON." }, 415);
  try {
    const reader = request.body?.getReader(); if (!reader) return localJson({ error: "Missing transaction hash." }, 400);
    let length = 0; const chunks: Uint8Array[] = [];
    while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength;
      if (length > 256) { await reader.cancel(); return localJson({ error: "Request is too large." }, 413); } chunks.push(chunk.value); }
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!input || Object.keys(input).join(",") !== "transactionHash" || typeof input.transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input.transactionHash)) return localJson({ error: "Provide only the deployment transaction hash." }, 400);
    return localJson({ state: "confirmed", deployment: await registerMainnetDeployment(input.transactionHash as Hex) });
  } catch (error) {
    if (error instanceof SyntaxError) return localJson({ error: "Invalid JSON." }, 400);
    if (error instanceof DeploymentPending) return localJson({ state: "pending", confirmations: error.confirmations, requiredConfirmations: error.requiredConfirmations }, 202);
    if (error instanceof InvalidDeployment) return localJson({ error: "This transaction does not match the reviewed Ethereum mainnet marketplace deployment." }, 409);
    return localJson({ error: "Mainnet verification is temporarily unavailable. Your submitted transaction is saved; check it again shortly." }, 503);
  }
}

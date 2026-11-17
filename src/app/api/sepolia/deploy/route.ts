import { localJson, localRequest } from "@/lib/sepolia/local-http";
import { DeploymentPending, InvalidDeployment } from "@/lib/sepolia/deployment-check";
import { getDeploymentPlan, registerDeployment } from "@/lib/sepolia/deployment-server";
import type { Hex } from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!localRequest(request)) return localJson({ error: "Deployment setup is available only in local development." }, 404);
  try { return localJson(await getDeploymentPlan()); }
  catch { return localJson({ error: "Deployment could not be prepared. Check the Sepolia RPC, verifier configuration and compiled contract artifacts." }, 503); }
}

export async function POST(request: Request) {
  if (!localRequest(request)) return localJson({ error: "Deployment setup is available only in local development." }, 404);
  if (!request.headers.get("origin")) return localJson({ error: "A local same-origin request is required." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return localJson({ error: "Expected JSON." }, 415);
  try {
    const reader = request.body?.getReader();
    if (!reader) return localJson({ error: "Missing deployment transaction hash." }, 400);
    let length = 0; const chunks: Uint8Array[] = [];
    while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength;
      if (length > 256) { await reader.cancel(); return localJson({ error: "Request is too large." }, 413); } chunks.push(chunk.value); }
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!input || Object.keys(input).join(",") !== "transactionHash" || typeof input.transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input.transactionHash)) {
      return localJson({ error: "Provide only the deployment transaction hash." }, 400);
    }
    return localJson({ state: "confirmed", deployment: await registerDeployment(input.transactionHash as Hex) });
  } catch (error) {
    if (error instanceof DeploymentPending) return localJson({ state: "pending", confirmations: error.confirmations, requiredConfirmations: 2 }, 202);
    if (error instanceof InvalidDeployment) return localJson({ error: "This transaction does not match the reviewed Sepolia marketplace deployment." }, 409);
    return localJson({ error: "Deployment verification is temporarily unavailable. Your transaction is saved; check its status again shortly." }, 503);
  }
}

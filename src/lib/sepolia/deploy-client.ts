import type { Address, Hex } from "viem";
import type { VerifiedDeployment } from "./deployment-check";
import { SetupMessage } from "./setup";

export type DeploymentPlan = { chainId: 11155111; deployer: Address; root: Hex; verifier: Address; feeRecipient: Address; feeWei: string;
  data: Hex; dataHash: Hex; gasLimit: string; estimatedFeeWei: string; balanceWei: string; deployment: VerifiedDeployment | null };

export async function deploymentFetch<T>(init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch("/api/sepolia/deploy", { ...init, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(30_000) }); }
  catch { throw new SetupMessage("The deployment status check timed out. Any submitted transaction is saved; check again shortly."); }
  const data = await response.json();
  if (!response.ok) throw new SetupMessage(data.error ?? "Deployment setup is temporarily unavailable.");
  return data as T;
}

export async function confirmDeployment(hash: Hex, signal: AbortSignal, progress: (text: string) => void,
  fetcher: typeof fetch = fetch, pause: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 3000))) {
  const deadline = Date.now() + 120_000;
  while (!signal.aborted && Date.now() < deadline) {
    try {
      const response = await fetcher("/api/sepolia/deploy", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionHash: hash }), signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
      const data = await response.json();
      if (response.status === 200 && data.state === "confirmed" && data.deployment?.transactionHash?.toLowerCase() === hash.toLowerCase()) return data.deployment as VerifiedDeployment;
      if (response.status === 202) progress(`Deployment: ${data.confirmations} / 2 confirmations. Checking Sepolia...`);
      else if (response.status >= 500 || response.status === 429) progress("Sepolia verification is temporarily unavailable. Your deployment transaction is saved; checking again...");
      else throw new SetupMessage(data.error ?? "Deployment could not be verified. Check the transaction link.");
    } catch (error) {
      if (error instanceof SetupMessage) throw error;
      if (signal.aborted) break;
      progress("Sepolia verification is temporarily unavailable. Your deployment transaction is saved; checking again...");
    }
    await pause();
  }
  throw new SetupMessage("Deployment checking stopped. Your transaction is saved; check its status to continue without deploying twice.");
}

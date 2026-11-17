import type { Hex } from "viem";

export type SetupPlan = {
  chainId: 11155111; owner: string; batch: string; balanceWei: string | null; rpcAvailable: boolean; root: Hex | null;
  indexer: { ready: boolean; tracked_count: number; waiting_for_creations: boolean } | null;
  items: { number: number; data: Hex; transactionHash: Hex | null }[];
};
export type PendingCreation = { number: number; hash: Hex };
export class SetupMessage extends Error {}

export async function setupFetch<T>(init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/sepolia/setup", { ...init, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(20_000) });
  } catch { throw new SetupMessage("The Sepolia status check timed out. Your submitted transactions are saved; check again shortly."); }
  const data = await response.json();
  if (!response.ok) throw new SetupMessage(data.error ?? "Sepolia setup is temporarily unavailable.");
  return data as T;
}

type Confirmed = { state: "confirmed"; confirmed: number; root: Hex | null };
type Confirmation = Confirmed | { state: "pending"; confirmations: number; requiredConfirmations: number };

// The server validates the exact transaction and canonical receipt. Browser
// block watchers are not a second source of truth for already-registered cups.
export async function confirmCreation(number: number, hash: Hex, options: {
  signal: AbortSignal; progress: (message: string) => void;
  fetcher?: typeof fetch; pause?: (ms: number) => Promise<void>; timeoutMs?: number;
}): Promise<Confirmed> {
  const fetcher = options.fetcher ?? fetch;
  const pause = options.pause ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (options.timeoutMs ?? 90_000);
  while (!options.signal.aborted && Date.now() < deadline) {
    let response: Response;
    let data: Confirmation & { error?: string };
    try {
      response = await fetcher("/api/sepolia/setup", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number, transactionHash: hash }), signal: AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]),
      });
      data = await response.json();
    } catch {
      if (options.signal.aborted) break;
      options.progress(`Sepolia status is temporarily unavailable. Cup #${number}'s transaction is saved; checking again...`);
      await pause(3000); continue;
    }
    if (response.status === 200 && data.state === "confirmed" && data.confirmed === number) return data;
    if (response.status === 202 && data.state === "pending") {
      options.progress(`Test cup #${number}: ${data.confirmations} / ${data.requiredConfirmations} confirmations. Checking Sepolia...`);
    } else if (response.status >= 500 || response.status === 429) {
      options.progress(`Sepolia status is temporarily unavailable. Cup #${number}'s transaction is saved; checking again...`);
    } else {
      throw new SetupMessage(data.error ?? "The transaction could not be verified. Check its link before continuing.");
    }
    await pause(3000);
  }
  throw new SetupMessage(options.signal.aborted
    ? "Status checking stopped. Your transaction is saved; continue to check it without sending it again."
    : "Sepolia has not finished this status check. Your transaction is saved; continue to check it without sending it again.");
}

export async function createNextCup(original: SetupPlan, dependencies: {
  load: () => Promise<SetupPlan>;
  readSaved: () => PendingCreation[];
  save: (records: PendingCreation[]) => void;
  send: (item: SetupPlan["items"][number]) => Promise<Hex>;
  confirm: (number: number, hash: Hex) => Promise<Confirmed>;
}) {
  const latest = await dependencies.load();
  if (latest.chainId !== 11155111 || latest.batch !== original.batch || latest.owner.toLowerCase() !== original.owner.toLowerCase()) {
    throw new SetupMessage("The test plan changed. Refresh this page before continuing.");
  }
  const item = latest.items.find((entry) => !entry.transactionHash);
  if (!item || latest.root) return { plan: latest, created: null };
  const saved = dependencies.readSaved();
  if (!Array.isArray(saved) || new Set(saved.map((entry) => entry?.number)).size !== saved.length ||
      saved.some((entry) => !entry || ![1, 2, 3].includes(entry.number) || !/^0x[0-9a-fA-F]{64}$/.test(entry.hash))) {
    throw new SetupMessage("Saved creation state is invalid. Check your transaction history before continuing.");
  }
  dependencies.save(saved); // Check storage before any wallet request.
  let hash = saved.find((entry) => entry.number === item.number)?.hash;
  if (!hash) {
    hash = await dependencies.send(item);
    dependencies.save([...saved, { number: item.number, hash }]);
  }
  const result = await dependencies.confirm(item.number, hash);
  return { created: item.number, plan: { ...latest, root: result.root,
    items: latest.items.map((entry) => entry.number === item.number ? { ...entry, transactionHash: hash! } : entry),
  } };
}

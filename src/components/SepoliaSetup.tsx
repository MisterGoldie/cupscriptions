"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useConfig } from "wagmi";
import { getAccount, getWalletClient, switchChain } from "wagmi/actions";
import { formatEther } from "viem";
import { useRouter } from "next/navigation";
import { confirmCreation, createNextCup, setupFetch, SetupMessage, type PendingCreation, type SetupPlan } from "@/lib/sepolia/setup";
import { WalletButton } from "./WalletButton";

const button = "border border-ash px-4 py-3 text-sm text-bone hover:border-volt hover:text-volt disabled:cursor-not-allowed disabled:opacity-40";

export function SepoliaSetup() {
  const config = useConfig();
  const { address } = useAccount();
  const router = useRouter();
  const queries = useQueryClient();
  const locked = useRef(false);
  const checking = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "preparing" | "wallet" | "checking">("idle");
  const [message, setMessage] = useState("");
  const [active, setActive] = useState<PendingCreation | null>(null);
  const query = useQuery({ queryKey: ["sepolia-setup"], queryFn: () => setupFetch<SetupPlan>(), refetchInterval: 8000, retry: 1 });
  const plan = query.data;
  const rightWallet = address?.toLowerCase() === plan?.owner.toLowerCase();
  const next = plan?.items.find((item) => !item.transactionHash);
  useEffect(() => () => { checking.current?.abort(); }, []);

  async function create() {
    if (!plan || !rightWallet || locked.current || plan.root) return;
    locked.current = true; setBusy(true); setPhase("preparing"); setMessage("Checking saved progress...");
    const controller = new AbortController();
    checking.current = controller;
    try {
      const key = `cupscriptions:sepolia-creations:${plan.batch}:${plan.owner.toLowerCase()}`;
      const result = await createNextCup(plan, {
        load: () => setupFetch<SetupPlan>(),
        readSaved: () => JSON.parse(localStorage.getItem(key) ?? "[]"),
        save: (records) => localStorage.setItem(key, JSON.stringify(records)),
        send: async (item) => {
          if (controller.signal.aborted) throw new SetupMessage("Creation stopped before requesting a wallet signature.");
          setPhase("wallet"); setActive(null); setMessage(`Switch to Ethereum Sepolia to create test cup #${item.number}...`);
          if (getAccount(config).chainId !== 11155111) await switchChain(config, { chainId: 11155111 });
          const wallet = await getWalletClient(config, { chainId: 11155111 });
          if (getAccount(config).address?.toLowerCase() !== plan.owner.toLowerCase() ||
              wallet.account.address.toLowerCase() !== plan.owner.toLowerCase() || await wallet.getChainId() !== 11155111) {
            throw new SetupMessage("Connect the setup wallet on Ethereum Sepolia before continuing.");
          }
          if (controller.signal.aborted) throw new SetupMessage("Creation stopped before requesting a wallet signature.");
          setMessage(`Approve test cup #${item.number} in your wallet. Value: 0 ETH, plus gas.`);
          // Wallet gas estimation and fee confirmation use its own provider.
          // Receipt verification uses our server instead of a browser watcher.
          const hash = await wallet.sendTransaction({ to: wallet.account.address, data: item.data, value: 0n });
          setActive({ number: item.number, hash });
          return hash;
        },
        confirm: async (number, hash) => {
          setActive({ number, hash }); setPhase("checking"); setMessage(`Checking test cup #${number}'s confirmation on Sepolia...`);
          return confirmCreation(number, hash, { signal: controller.signal, progress: setMessage });
        },
      });
      queries.setQueryData(["sepolia-setup"], result.plan);
      setActive(null);
      const remaining = result.plan.items.find((item) => !item.transactionHash);
      setMessage(remaining ? `${result.created ? `Test cup #${result.created} is confirmed. ` : ""}Ready to create test cup #${remaining.number}.`
        : "All three test cups are confirmed. The test collection root is ready.");
      void query.refetch();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof SetupMessage ? error.message : /rejected|denied/i.test(error instanceof Error ? error.message : "")
        ? "Wallet request cancelled. Your confirmed cups are saved; continue when ready."
        : "Creation stopped. Your submitted transaction is saved; use its link and continue to check its status.");
    } finally { locked.current = false; checking.current = null; setBusy(false); setPhase("idle"); }
  }

  const registeredActive = active && plan?.items.some((item) => item.number === active.number && item.transactionHash?.toLowerCase() === active.hash.toLowerCase());
  const statusMessage = registeredActive
    ? `Test cup #${active.number} is confirmed. ${next ? `Next: test cup #${next.number}.` : "All three test cups are confirmed."}`
    : message;

  return <section className="my-8 border border-ash bg-ink-soft p-5 md:p-7" aria-label="Create Sepolia test cups">
    <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-bone">Create the test collection</h2>
    <p className="mt-3 text-sm text-mute">Create one test cup at a time on Ethereum Sepolia (chain 11155111). Each is a 0 ETH transaction to your own wallet, plus gas.</p>
    {query.isPending && <p className="mt-4 text-sm text-mute">Checking saved progress...</p>}
    {query.isError && <p className="mt-4 text-sm text-mute">{query.error instanceof Error ? query.error.message : "Setup status is temporarily unavailable."} <button className="text-volt underline" onClick={() => query.refetch()}>Check again</button></p>}
    {plan && <div className="mt-5 space-y-4 text-sm">
      <p className="break-all text-mute">Setup wallet: {plan.owner}</p>
      <p className="text-bone">Ethereum Sepolia balance: {plan.balanceWei !== null ? `${formatEther(BigInt(plan.balanceWei))} ETH` : "temporarily unavailable"}</p>
      <p className="text-bone">Confirmed creations: {plan.items.filter((item) => item.transactionHash).length} / 3</p>
      <ul className="space-y-2">{plan.items.map((item) => <li key={item.number} className="flex flex-wrap justify-between gap-2 border-b border-ash py-2">
        <span className="text-mute">Test cup #{item.number}</span>
        {item.transactionHash ? <a className="text-volt underline" href={`https://sepolia.etherscan.io/tx/${item.transactionHash}`} target="_blank" rel="noreferrer">Confirmed</a>
          : <span className="text-mute">{active?.number === item.number ? "Transaction submitted" : "Awaiting creation"}</span>}
      </li>)}</ul>
      <p className="text-mute">Local indexer: {plan.indexer ? plan.indexer.ready ? `${plan.indexer.tracked_count} test cups indexed`
        : plan.indexer.waiting_for_creations ? `connected; starts after all 3 cups are created (${plan.items.filter((item) => item.transactionHash).length}/3 confirmed)`
          : "syncing test cup history" : "start npm run sepolia:indexer"}</p>
      {plan.root ? <>
        <p className="break-all text-mute">Test collection root: <code className="text-volt">{plan.root}</code></p>
        <p className="text-mute">The test cups are ready. Continue with the marketplace deployment section below.</p>
      </> : <>
        {!address && <WalletButton />}
        {address && !rightWallet && <p className="text-mute">Connect the setup wallet shown above to create these test cups.</p>}
        {plan.balanceWei === "0" && <p className="text-mute">Fund this address with Ethereum Sepolia ETH. Base Sepolia balances pay gas on a different network.</p>}
        <div className="flex flex-wrap gap-3">
          <button className={button} disabled={!rightWallet || busy} onClick={create}>{busy
            ? phase === "wallet" ? "Check your wallet..." : phase === "checking" ? "Checking submitted transaction..." : "Checking saved progress..."
            : `Create or check test cup #${next?.number ?? 3}`}</button>
          {busy && phase === "checking" && <button className={button} onClick={() => checking.current?.abort()}>Stop checking</button>}
          <button className={button} disabled={query.isFetching} onClick={() => query.refetch()}>Refresh status</button>
        </div>
      </>}
    </div>}
    {statusMessage && <p role="status" className="mt-4 text-sm text-bone">{statusMessage}</p>}
    {active && <a href={`https://sepolia.etherscan.io/tx/${active.hash}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-volt underline">View test cup #{active.number} transaction</a>}
  </section>;
}

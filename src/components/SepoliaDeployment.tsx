"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useConfig } from "wagmi";
import { getAccount, getWalletClient, switchChain } from "wagmi/actions";
import { formatEther, keccak256, type Hex } from "viem";
import { useRouter } from "next/navigation";
import { confirmDeployment, deploymentFetch, type DeploymentPlan } from "@/lib/sepolia/deploy-client";
import { SetupMessage } from "@/lib/sepolia/setup";
import { WalletButton } from "./WalletButton";

const button = "border border-ash px-4 py-3 text-sm text-bone hover:border-volt hover:text-volt disabled:cursor-not-allowed disabled:opacity-40";

export function SepoliaDeployment({ network = "sepolia" }: { network?: "sepolia" | "mainnet" }) {
  const isMainnet = network === "mainnet";
  const chainId = isMainnet ? 1 : 11155111;
  const chainName = isMainnet ? "Ethereum mainnet" : "Ethereum Sepolia";
  const endpoint = `/api/${network}/deploy`;
  const explorer = isMainnet ? "https://etherscan.io" : "https://sepolia.etherscan.io";
  const queryKey = `${network}-deployment`;
  const config = useConfig();
  const { address } = useAccount();
  const queries = useQueryClient();
  const router = useRouter();
  const locked = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Hex | null>(null);
  const query = useQuery({ queryKey: [queryKey], queryFn: () => deploymentFetch<DeploymentPlan>(undefined, endpoint), retry: 1, staleTime: 15_000, refetchInterval: isMainnet ? 15_000 : false });
  const plan = query.data;
  const key = plan ? `cupscriptions:${network}-deployment:${plan.root}:${plan.verifier.toLowerCase()}:${plan.deployer.toLowerCase()}` : null;
  const rightWallet = address?.toLowerCase() === plan?.deployer.toLowerCase();
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled || !key) return;
      try { const hash = localStorage.getItem(key); if (hash && /^0x[0-9a-fA-F]{64}$/.test(hash)) setPending(hash as Hex); }
      catch { /* The action checks storage before requesting a signature. */ }
    });
    return () => { cancelled = true; };
  }, [key]);
  useEffect(() => () => { controller.current?.abort(); }, []);

  async function deploy() {
    if (!plan || !key || locked.current || plan.deployment) return;
    locked.current = true; setBusy(true); setMessage("Checking the deployment configuration...");
    const signalController = new AbortController(); controller.current = signalController;
    try {
      const latest = await deploymentFetch<DeploymentPlan>(undefined, endpoint);
      if (latest.deployment) { queries.setQueryData([queryKey], latest); setMessage("Marketplace is already deployed and connected."); return; }
      if (latest.chainId !== chainId || latest.dataHash !== plan.dataHash || keccak256(latest.data) !== plan.dataHash || latest.deployer !== plan.deployer) {
        throw new SetupMessage("The deployment configuration changed. Refresh and review it before signing.");
      }
      let hash = (localStorage.getItem(key) as Hex | null) ?? pending;
      if (hash && !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new SetupMessage("Saved deployment state is invalid. Check your wallet history before continuing.");
      if (!hash) {
        if (!rightWallet) throw new SetupMessage("Connect your funded setup wallet to deploy.");
        localStorage.setItem(`${key}:storage-check`, `0x${"0".repeat(64)}`); localStorage.removeItem(`${key}:storage-check`);
        if (BigInt(latest.balanceWei) < BigInt(latest.estimatedFeeWei)) throw new SetupMessage(`The setup wallet needs more ${chainName} ETH for deployment gas.`);
        if (isMainnet && !latest.indexerReady) throw new SetupMessage("The mainnet ownership indexer is not ready. Refresh the deployment check shortly.");
        if (getAccount(config).chainId !== chainId) { setMessage(`Switch your wallet to ${chainName}...`); await switchChain(config, { chainId }); }
        const wallet = await getWalletClient(config, { chainId });
        if (wallet.account.address.toLowerCase() !== latest.deployer.toLowerCase() || getAccount(config).address?.toLowerCase() !== latest.deployer.toLowerCase() || await wallet.getChainId() !== chainId || signalController.signal.aborted) {
          throw new SetupMessage("Your wallet account or network changed. Refresh before deploying.");
        }
        setMessage(`Approve contract deployment in your wallet. ${chainName}, 0 ETH sent, plus ${isMainnet ? "real ETH" : "network"} gas.`);
        hash = await wallet.sendTransaction({ data: latest.data, value: 0n, gas: BigInt(latest.gasLimit) });
        setPending(hash); localStorage.setItem(key, hash);
      } else setPending(hash);
      setMessage(`Checking the deployment receipt on ${chainName}...`);
      const deployment = await confirmDeployment(hash, signalController.signal, setMessage, undefined, undefined, endpoint, latest.requiredConfirmations ?? 2);
      queries.setQueryData([queryKey], { ...latest, deployment });
      setMessage(isMainnet ? "Mainnet marketplace deployed and verified. Local trading is connected for a controlled first trade."
        : "Marketplace deployed, verified and connected. Open a test cup to deposit and list it.");
      await queries.invalidateQueries({ queryKey: ["market"] });
      router.refresh();
    } catch (error) {
      setMessage(error instanceof SetupMessage ? error.message : /rejected|denied/i.test(error instanceof Error ? error.message : "")
        ? "Wallet request cancelled. No new deployment was requested."
        : "Deployment checking stopped. Check the transaction link and continue to check its status before deploying again.");
    } finally { locked.current = false; controller.current = null; setBusy(false); }
  }

  const needsFunding = plan && BigInt(plan.balanceWei) < BigInt(plan.estimatedFeeWei);
  return <section className="my-8 border border-volt/40 bg-ink-soft p-5 md:p-7" aria-label={`Deploy ${chainName} marketplace`}>
    <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-bone">{isMainnet ? "Deploy the mainnet marketplace" : "Deploy the test marketplace"}</h2>
    {query.isPending && <p className="mt-4 text-sm text-mute">Preparing the contract and estimating deployment gas...</p>}
    {query.isError && <p className="mt-4 text-sm text-mute">{query.error instanceof Error ? query.error.message : "Deployment setup is unavailable."} <button onClick={() => query.refetch()} className="text-volt underline">Retry</button></p>}
    {plan && <div className="mt-4 space-y-3 text-sm">
      <p className="text-volt">{chainName} · chain {chainId} · {isMainnet ? "real ETH" : "test ETH"}</p>
      <p className="break-all text-mute">Deploy from your funded wallet: {plan.deployer}</p>
      <p className="break-all text-mute">Verifier: {plan.verifier}</p>
      <p className="break-all text-mute">{isMainnet ? "Original 5,000-cup collection root" : "Test collection root"}: {plan.root}</p>
      <p className="text-mute">Sale fee: {formatEther(BigInt(plan.feeWei))} ETH. Recipient: <span className="break-all">{plan.feeRecipient}</span></p>
      {plan.deployment ? <>
        <p className="text-bone">Marketplace deployed and connected.</p>
        <a className="block break-all text-volt underline" href={`${explorer}/address/${plan.deployment.address}`} target="_blank" rel="noreferrer">{plan.deployment.address}</a>
        <p className="text-mute">{isMainnet ? "Open a cup you own from the collection and complete a controlled first trade before connecting the public site."
          : "Open a test cup below, deposit it, then list it for sale. Use a second test wallet to buy it."}</p>
        {isMainnet && <a href="/my-cups" className="inline-block text-volt underline">Open your mainnet cups</a>}
      </> : <>
        <p className="text-bone">Estimated deployment gas budget: {formatEther(BigInt(plan.estimatedFeeWei))} ETH</p>
        {isMainnet && <>
          <p className="text-mute">Mainnet wallet balance: {formatEther(BigInt(plan.balanceWei))} ETH</p>
          {needsFunding && <p className="text-bone">Additional mainnet ETH needed at this estimate: {formatEther(BigInt(plan.fundingNeededWei ?? "0"))} ETH. The estimate refreshes automatically.</p>}
          <p className="text-mute">Ownership indexer: {plan.indexerReady ? "available" : "catching up or unavailable"}</p>
        </>}
        <p className="text-mute">0 ETH is sent with deployment. Your wallet shows the final network fee. After {plan.requiredConfirmations ?? 2} confirmations, the site verifies the contract and connects {isMainnet ? "local " : ""}trading.</p>
        {!address && <WalletButton />}
        {address && !rightWallet && !pending && <p className="text-mute">Connect the funded wallet shown above to deploy.</p>}
        <div className="flex flex-wrap gap-3">
          <button className={button} disabled={busy || (!rightWallet && !pending) || (isMainnet && !pending && (!!needsFunding || !plan.indexerReady))} onClick={deploy}>{busy ? "Check wallet / deployment status..." : pending ? "Check submitted deployment" : `Deploy marketplace on ${isMainnet ? "Ethereum mainnet" : "Sepolia"}`}</button>
          {busy && pending && <button className={button} onClick={() => controller.current?.abort()}>Stop checking</button>}
          {isMainnet && <button className={button} disabled={query.isFetching} onClick={() => query.refetch()}>Refresh gas estimate</button>}
        </div>
      </>}
    </div>}
    {message && <p role="status" className="mt-4 text-sm text-bone">{message}</p>}
    {pending && <a href={`${explorer}/tx/${pending}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-volt underline">View deployment transaction</a>}
  </section>;
}

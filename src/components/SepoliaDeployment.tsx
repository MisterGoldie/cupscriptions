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

export function SepoliaDeployment() {
  const config = useConfig();
  const { address } = useAccount();
  const queries = useQueryClient();
  const router = useRouter();
  const locked = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Hex | null>(null);
  const query = useQuery({ queryKey: ["sepolia-deployment"], queryFn: () => deploymentFetch<DeploymentPlan>(), retry: 1, staleTime: 15_000 });
  const plan = query.data;
  const key = plan ? `cupscriptions:sepolia-deployment:${plan.root}:${plan.verifier.toLowerCase()}:${plan.deployer.toLowerCase()}` : null;
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
      const latest = await deploymentFetch<DeploymentPlan>();
      if (latest.deployment) { queries.setQueryData(["sepolia-deployment"], latest); setMessage("Marketplace is already deployed and connected."); return; }
      if (latest.chainId !== 11155111 || latest.dataHash !== plan.dataHash || keccak256(latest.data) !== plan.dataHash || latest.deployer !== plan.deployer) {
        throw new SetupMessage("The deployment configuration changed. Refresh and review it before signing.");
      }
      let hash = (localStorage.getItem(key) as Hex | null) ?? pending;
      if (hash && !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new SetupMessage("Saved deployment state is invalid. Check your wallet history before continuing.");
      if (!hash) {
        if (!rightWallet) throw new SetupMessage("Connect your funded setup wallet to deploy.");
        localStorage.setItem(`${key}:storage-check`, `0x${"0".repeat(64)}`); localStorage.removeItem(`${key}:storage-check`);
        if (BigInt(latest.balanceWei) < BigInt(latest.estimatedFeeWei)) throw new SetupMessage("The setup wallet needs more Ethereum Sepolia ETH for deployment gas.");
        if (getAccount(config).chainId !== 11155111) { setMessage("Switch your wallet to Ethereum Sepolia..."); await switchChain(config, { chainId: 11155111 }); }
        const wallet = await getWalletClient(config, { chainId: 11155111 });
        if (wallet.account.address.toLowerCase() !== latest.deployer.toLowerCase() || getAccount(config).address?.toLowerCase() !== latest.deployer.toLowerCase() || await wallet.getChainId() !== 11155111 || signalController.signal.aborted) {
          throw new SetupMessage("Your wallet account or network changed. Refresh before deploying.");
        }
        setMessage("Approve contract deployment in your wallet. Ethereum Sepolia, 0 ETH sent, plus network gas.");
        hash = await wallet.sendTransaction({ data: latest.data, value: 0n, gas: BigInt(latest.gasLimit) });
        setPending(hash); localStorage.setItem(key, hash);
      } else setPending(hash);
      setMessage("Checking the deployment receipt on Ethereum Sepolia...");
      const deployment = await confirmDeployment(hash, signalController.signal, setMessage);
      queries.setQueryData(["sepolia-deployment"], { ...latest, deployment });
      setMessage("Marketplace deployed, verified and connected. Open a test cup to deposit and list it.");
      await queries.invalidateQueries({ queryKey: ["market"] });
      router.refresh();
    } catch (error) {
      setMessage(error instanceof SetupMessage ? error.message : /rejected|denied/i.test(error instanceof Error ? error.message : "")
        ? "Wallet request cancelled. No new deployment was requested."
        : "Deployment checking stopped. Check the transaction link and continue to check its status before deploying again.");
    } finally { locked.current = false; controller.current = null; setBusy(false); }
  }

  return <section className="my-8 border border-volt/40 bg-ink-soft p-5 md:p-7" aria-label="Deploy Sepolia marketplace">
    <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-bone">Deploy the test marketplace</h2>
    {query.isPending && <p className="mt-4 text-sm text-mute">Preparing the contract and estimating deployment gas...</p>}
    {query.isError && <p className="mt-4 text-sm text-mute">{query.error instanceof Error ? query.error.message : "Deployment setup is unavailable."} <button onClick={() => query.refetch()} className="text-volt underline">Retry</button></p>}
    {plan && <div className="mt-4 space-y-3 text-sm">
      <p className="text-volt">Ethereum Sepolia · chain 11155111 · test ETH</p>
      <p className="break-all text-mute">Deploy from your funded wallet: {plan.deployer}</p>
      <p className="break-all text-mute">Verifier: {plan.verifier}</p>
      <p className="break-all text-mute">Test collection root: {plan.root}</p>
      <p className="text-mute">Sale fee: {formatEther(BigInt(plan.feeWei))} ETH. Recipient: <span className="break-all">{plan.feeRecipient}</span></p>
      {plan.deployment ? <>
        <p className="text-bone">Marketplace deployed and connected.</p>
        <a className="block break-all text-volt underline" href={`https://sepolia.etherscan.io/address/${plan.deployment.address}`} target="_blank" rel="noreferrer">{plan.deployment.address}</a>
        <p className="text-mute">Open a test cup below, deposit it, then list it for sale. Use a second test wallet to buy it.</p>
      </> : <>
        <p className="text-bone">Estimated deployment gas budget: {formatEther(BigInt(plan.estimatedFeeWei))} ETH</p>
        <p className="text-mute">0 ETH is sent with deployment. Your wallet shows the final network fee. After two confirmations, the site verifies the contract and connects trading.</p>
        {!address && <WalletButton />}
        {address && !rightWallet && !pending && <p className="text-mute">Connect the funded wallet shown above to deploy.</p>}
        <div className="flex flex-wrap gap-3">
          <button className={button} disabled={busy || (!rightWallet && !pending)} onClick={deploy}>{busy ? "Check wallet / deployment status..." : pending ? "Check submitted deployment" : "Deploy marketplace on Sepolia"}</button>
          {busy && pending && <button className={button} onClick={() => controller.current?.abort()}>Stop checking</button>}
        </div>
      </>}
    </div>}
    {message && <p role="status" className="mt-4 text-sm text-bone">{message}</p>}
    {pending && <a href={`https://sepolia.etherscan.io/tx/${pending}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-volt underline">View deployment transaction</a>}
  </section>;
}

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { formatEther, parseEther, type Hex } from "viem";
import { marketAbi } from "@/lib/market/abi.generated";
import { marketFetch, TradingMessage, useMarketTransaction } from "@/lib/market/client";
import { decodePurchase, SALE_FEE, type MarketResponse, type SignedPurchase } from "@/lib/market/types";
import { WalletButton } from "./WalletButton";
import { TradingStatus } from "./TradingStatus";

const button = "border border-ash px-4 py-2 text-sm text-bone transition hover:border-volt hover:text-volt disabled:cursor-not-allowed disabled:opacity-40";

export function CupTrading({ id, ethscriptionId }: { id: number; ethscriptionId: string }) {
  const { address, isConnected } = useAccount();
  const [price, setPrice] = useState("");
  const query = useQuery({
    queryKey: ["market", "cup", id, address],
    queryFn: () => marketFetch<MarketResponse>(`/api/market/cup/${id}${address ? `?wallet=${address}` : ""}`),
    refetchInterval: 8_000, retry: 1,
  });
  const market = query.data?.market ?? null;
  const cup = query.data?.cups[0];
  const claim = query.data?.claim;
  const tx = useMarketTransaction(market);
  const owner = !!address && cup?.owner.toLowerCase() === address.toLowerCase();
  const seller = !!address && cup?.seller?.toLowerCase() === address.toLowerCase();
  let priceWei: bigint | null = null;
  if (/^\d+(\.\d{1,18})?$/.test(price.trim())) {
    try { const value = parseEther(price.trim()); if (value > SALE_FEE && value < 2n ** 256n) priceWei = value; } catch { /* Invalid input stays disabled. */ }
  }

  async function write(action: "list" | "cancelListing" | "withdrawEthscription") {
    if (!market) return;
    const identity = ethscriptionId as Hex;
    await tx.run(action === "list" ? "Listing" : action === "cancelListing" ? "Cancellation" : "Return to wallet", async (wallet, client, assertWallet) => {
      if (action === "list") {
        if (!cup?.verified || !priceWei || !market.canTrade) throw new TradingMessage("Refresh the cup before listing.");
        const { request } = await client.simulateContract({ address: market.address, abi: marketAbi, functionName: "list", account: wallet.account,
          args: [identity, priceWei, cup.proof] });
        await assertWallet(); return wallet.writeContract(request);
      }
      const { request } = await client.simulateContract({ address: market.address, abi: marketAbi, functionName: action,
        account: wallet.account, args: [identity] });
      await assertWallet(); return wallet.writeContract(request);
    });
  }

  async function deposit() {
    if (!market || !cup || !owner || cup.inEscrow || !market.canTrade) return;
    await tx.run("Deposit", async (wallet, client, assertWallet) => {
      const gas = await client.estimateGas({ account: wallet.account, to: market.address, data: cup.ethscriptionId, value: 0n });
      await assertWallet();
      return wallet.sendTransaction({ to: market.address, data: cup.ethscriptionId, value: 0n, gas });
    });
  }

  async function buy() {
    if (!market || !cup?.seller || !market.canTrade) return;
    await tx.run("Purchase", async (wallet, client, assertWallet) => {
      const signed = await marketFetch<SignedPurchase>("/api/market/authorize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cup: id, buyer: wallet.account.address, seller: cup.seller, priceWei: cup.priceWei, nonce: cup.nonce }),
      });
      const authorization = decodePurchase(signed.authorization);
      if (authorization.ethscriptionId.toLowerCase() !== cup.ethscriptionId.toLowerCase() ||
          authorization.buyer.toLowerCase() !== wallet.account.address.toLowerCase() ||
          authorization.seller.toLowerCase() !== cup.seller!.toLowerCase() || authorization.price !== BigInt(cup.priceWei) ||
          authorization.listingNonce !== BigInt(cup.nonce)) throw new TradingMessage("Listing details changed. Refresh before buying.");
      const { request } = await client.simulateContract({ address: market.address, abi: marketAbi, functionName: "buy", account: wallet.account,
        args: [authorization, signed.signature], value: authorization.price });
      await assertWallet(); return wallet.writeContract(request);
    });
  }

  return <section className="border-t border-ash pt-6" aria-label={`Trade Cupscription ${id}`}>
    <div className="flex items-center justify-between gap-4"><h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-bone">Trade this cup</h2><button onClick={() => query.refetch()} disabled={query.isFetching} className="text-xs text-volt underline disabled:opacity-40">Refresh</button></div>
    {query.isPending && <p className="mt-3 text-sm text-mute">Checking market status…</p>}
    {query.isError && <p className="mt-3 text-sm text-mute">Trading is temporarily unavailable. <button onClick={() => query.refetch()} className="text-volt underline">Retry</button></p>}
    {!query.isPending && !query.isError && !market && <p className="mt-3 text-sm text-mute">Trading is being prepared. Your cups remain in your wallet.</p>}
    {market && <div className="mt-4 space-y-4">
      <p className="text-sm text-mute">{market.chainName} · {formatEther(BigInt(market.feeWei))} ETH fee per sale, deducted from seller proceeds.</p>
      <p className="break-all text-xs text-mute">Escrow contract: {market.explorerUrl ? <a className="text-volt underline" href={`${market.explorerUrl}/address/${market.address}`} target="_blank" rel="noreferrer">{market.address}</a> : market.address}</p>
      {!market.canTrade && <p className="text-sm text-mute">New trades are temporarily unavailable. Existing deposits and proceeds can still be withdrawn.</p>}
      {query.data?.error && <p className="text-sm text-mute">{query.data.error}</p>}
      {cup && <p className="break-all text-xs text-mute">{cup.inEscrow ? "Deposited by" : "Owner"}: {cup.seller ?? cup.owner}</p>}
      {!isConnected && <WalletButton />}
      {cup?.inEscrow && !cup.verified && <p className="text-sm text-mute">Deposit ownership is not confirmed. Buying and listing are unavailable.</p>}
      {!!cup?.remainingBlocks && <p className="text-sm text-mute">Escrow cooldown: {cup.remainingBlocks} more Ethereum block{cup.remainingBlocks === 1 ? "" : "s"} before buying or returning this cup.</p>}
      {cup && BigInt(cup.priceWei) > 0n && <p className="text-xl font-semibold text-bone">Listed for {formatEther(BigInt(cup.priceWei))} ETH</p>}
      {isConnected && cup && !cup.inEscrow && owner && !claim && <div>
        <p className="mb-3 text-sm text-mute">Deposit this cup into marketplace escrow to list it. You can return it to your wallet after five blocks.</p>
        <button className={button} disabled={tx.busy || !market.canTrade} onClick={deposit}>Deposit to sell</button>
      </div>}
      {isConnected && seller && cup?.verified && <div>
        <label className="block text-sm text-mute" htmlFor={`price-${id}`}>Sale price in ETH</label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input id={`price-${id}`} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0.01" maxLength={80} disabled={tx.busy}
            className="w-40 border border-ash bg-ink-soft px-3 py-2 text-bone outline-none focus:border-volt" />
          <button className={button} disabled={tx.busy || !market.canTrade || !priceWei} onClick={() => write("list")}>{BigInt(cup.priceWei) > 0n ? "Update price" : "List for sale"}</button>
        </div>
        <p className="mt-2 text-xs text-mute">{priceWei ? `You receive ${formatEther(priceWei - SALE_FEE)} ETH after the sale fee.` : "Enter a price greater than 0.000001 ETH."}</p>
      </div>}
      {isConnected && cup?.inEscrow && cup.verified && !seller && BigInt(cup.priceWei) > SALE_FEE && <div>
        <p className="mb-3 text-sm text-mute">Your wallet will show the listed price plus its estimated network fee.</p>
        <button className={button} disabled={tx.busy || !market.canTrade || cup.remainingBlocks > 0} onClick={buy}>Buy for {formatEther(BigInt(cup.priceWei))} ETH</button>
      </div>}
      {claim && isConnected && <div className="flex flex-wrap gap-2">
        {BigInt(claim.priceWei) > 0n && <button className={button} disabled={tx.busy} onClick={() => write("cancelListing")}>Cancel listing</button>}
        <button className={button} disabled={tx.busy || claim.remainingBlocks > 0} onClick={() => write("withdrawEthscription")}>Return cup to wallet{claim.remainingBlocks ? ` (${claim.remainingBlocks} blocks)` : ""}</button>
      </div>}
      {cup && !owner && !cup.inEscrow && <p className="text-sm text-mute">This cup is not listed for sale.</p>}
    </div>}
    <TradingStatus message={tx.message} hash={tx.hash} market={market} onCheck={tx.pending ? tx.recheck : undefined} />
  </section>;
}

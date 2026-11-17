"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useConfig } from "wagmi";
import { getAccount, getPublicClient, getWalletClient, switchChain } from "wagmi/actions";
import { type Address, type Hex, type PublicClient } from "viem";
import type { MarketInfo } from "./types";

export class TradingMessage extends Error {}

export async function marketFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...init, cache: "no-store" }); }
  catch { throw new TradingMessage("Trading data is temporarily unavailable. Please try again."); }
  let data;
  try { data = await response.json(); }
  catch { throw new TradingMessage("Trading data is temporarily unavailable. Please try again."); }
  if (!response.ok) throw new TradingMessage(data.error ?? "This action is temporarily unavailable.");
  return data as T;
}

type Pending = { hash: Hex; label: string };

export function useMarketTransaction(market: MarketInfo | null) {
  const config = useConfig();
  const { address } = useAccount();
  const queries = useQueryClient();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [lastHash, setLastHash] = useState<Hex | null>(null);
  const storageKey = market && address ? `cupscriptions:pending:${market.chainId}:${market.address.toLowerCase()}:${address.toLowerCase()}` : null;
  const marketChainId = market?.chainId;

  const invalidate = () => Promise.all([
    queries.invalidateQueries({ queryKey: ["market"] }),
    queries.invalidateQueries({ queryKey: ["owned-cups"] }),
  ]);
  function remember(key: string | null, value: Pending | null) {
    if (!key) return;
    try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); }
    catch { /* Wallet confirmation still works when browser storage is disabled. */ }
  }

  useEffect(() => {
    let cancelled = false;
    if (!storageKey || !marketChainId) return;
    const key = storageKey;
    const client = getPublicClient(config, { chainId: marketChainId });
    void (async () => {
      await Promise.resolve();
      let saved: Pending | null = null;
      try { saved = JSON.parse(sessionStorage.getItem(key) ?? "null"); } catch { /* Optional browser state. */ }
      if (cancelled) return;
      if (!saved || !/^0x[0-9a-fA-F]{64}$/.test(saved.hash) || typeof saved.label !== "string") {
        setPending(null); setBusy(false); setLastHash(null); setMessage(""); locked.current = false;
        return;
      }
      setPending(saved); setLastHash(saved.hash); setBusy(true); locked.current = true;
      setMessage("Checking your submitted transaction…");
      try {
        const receipt = await client!.waitForTransactionReceipt({ hash: saved.hash, timeout: 90_000 });
        if (cancelled) return;
        remember(key, null); setPending(null); locked.current = false;
        setMessage(receipt.status === "success" ? "Confirmed on Ethereum. Refreshing your cups…" : "The transaction reverted. No purchase completed.");
        await Promise.all([queries.invalidateQueries({ queryKey: ["market"] }), queries.invalidateQueries({ queryKey: ["owned-cups"] })]);
      } catch { if (!cancelled) setMessage("Your transaction is still being checked. Use the transaction link before trying again."); }
      finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; };
  }, [storageKey, config, marketChainId, queries]);

  type Wallet = Awaited<ReturnType<typeof getWalletClient>>;
  async function recheck() {
    if (!market || !pending || busy) return;
    setBusy(true);
    try {
      const client = getPublicClient(config, { chainId: market.chainId })!;
      const receipt = await client.waitForTransactionReceipt({ hash: pending.hash, timeout: 12_000 });
      remember(storageKey, null); setPending(null); locked.current = false;
      setMessage(receipt.status === "success" ? "Confirmed on Ethereum. Refreshing your cups…" : "The transaction reverted. No purchase completed.");
      await invalidate();
    } catch { setMessage("Ethereum confirmation is still pending. Check the transaction link and try checking again shortly."); }
    finally { setBusy(false); }
  }
  async function run(label: string, action: (wallet: Wallet, client: PublicClient, assertWallet: () => Promise<void>) => Promise<Hex>) {
    if (!market || !address || locked.current || pending) return;
    locked.current = true; setBusy(true); setMessage("Preparing your transaction…"); setLastHash(null);
    const intended = address;
    let submitted = false;
    try {
      if (getAccount(config).chainId !== market.chainId) {
        setMessage(`Switch your wallet to ${market.chainName}…`);
        await switchChain(config, { chainId: market.chainId });
      }
      const wallet = await getWalletClient(config, { chainId: market.chainId });
      const client = getPublicClient(config, { chainId: market.chainId })! as PublicClient;
      const assertWallet = async () => {
        const active = getAccount(config).address;
        if (active?.toLowerCase() !== intended.toLowerCase() || wallet.account.address.toLowerCase() !== intended.toLowerCase() ||
            await wallet.getChainId() !== market.chainId) {
          throw new TradingMessage("Your wallet account or network changed. Refresh before continuing.");
        }
      };
      await assertWallet();
      setMessage("Check the details in your wallet…");
      const hash = await action(wallet, client, assertWallet);
      submitted = true;
      const record = { hash, label };
      remember(storageKey, record); setPending(record); setLastHash(hash);
      setMessage("Submitted. Waiting for Ethereum confirmation…");
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
      remember(storageKey, null); setPending(null); submitted = false;
      if (receipt.status !== "success") throw new TradingMessage("The transaction reverted. No purchase completed.");
      setMessage(`${label} confirmed on Ethereum. Ownership may take a moment to update.`);
      await invalidate();
    } catch (error) {
      setMessage(submitted ? "Transaction submitted. Check its status before trying again." : error instanceof TradingMessage ? error.message
        : /rejected|denied/i.test(error instanceof Error ? error.message : "") ? "Wallet request cancelled."
          : "The transaction could not be completed. Refresh the cup and try again.");
    } finally { locked.current = submitted; setBusy(false); }
  }

  return { run, recheck, pending: !!pending, busy: busy || !!pending, message, hash: lastHash, address: address as Address | undefined };
}

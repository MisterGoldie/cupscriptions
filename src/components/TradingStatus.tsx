"use client";

import type { Hex } from "viem";
import type { MarketInfo } from "@/lib/market/types";

export function TradingStatus({ message, hash, market, onCheck }: { message: string; hash: Hex | null; market: MarketInfo | null; onCheck?: () => void }) {
  if (!message && !hash) return null;
  return <div className="mt-4 border-l-2 border-volt pl-3 text-sm text-mute" role="status" aria-live="polite">
    {message && <p>{message}</p>}
    {hash && market?.explorerUrl && <a href={`${market.explorerUrl}/tx/${hash}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-volt underline">View transaction</a>}
    {hash && !market?.explorerUrl && <p className="mt-2 break-all text-xs">Transaction: {hash}</p>}
    {onCheck && <button className="mt-2 block text-volt underline" onClick={onCheck}>Check transaction status</button>}
  </div>;
}

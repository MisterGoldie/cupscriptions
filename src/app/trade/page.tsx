import type { Metadata } from "next";
import { TradeClient } from "@/components/TradeClient";

export const metadata: Metadata = {
  title: "Trade",
  description: "Browse Cupscriptions listings and manage your marketplace cups.",
};

export default function TradePage() {
  return <div className="px-5 pb-24 pt-28 md:px-8"><div className="mx-auto max-w-6xl"><TradeClient /></div></div>;
}

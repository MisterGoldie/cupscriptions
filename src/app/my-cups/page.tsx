import type { Metadata } from "next";
import { MyCupsClient } from "@/components/MyCupsClient";

export const metadata: Metadata = {
  title: "My Cups",
  description: "Connect your wallet to see Cupscriptions you own.",
};

export default function MyCupsPage() {
  return (
    <div className="px-5 pb-20 pt-24 md:px-8">
      <MyCupsClient />
    </div>
  );
}

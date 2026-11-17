import { getMarketService } from "@/lib/market/server";
import { failure, json, walletParam } from "@/lib/market/http";
import { MarketError } from "@/lib/market/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^\d+$/.test(id) || Number(id) < 1 || Number(id) > 5000) throw new MarketError("Invalid cup number.", 400);
    const query = new URL(request.url).searchParams;
    const wallet = query.has("wallet") ? walletParam(query.get("wallet")) : undefined;
    const market = getMarketService();
    return json(market ? await market.cup(Number(id), wallet) : { market: null, cups: [], claim: null });
  } catch (error) { return failure(error); }
}

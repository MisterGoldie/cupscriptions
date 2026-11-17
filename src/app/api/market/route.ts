import { getMarketService } from "@/lib/market/server";
import { cursorParam, failure, json, walletParam } from "@/lib/market/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const wallet = query.has("wallet") ? walletParam(query.get("wallet")) : undefined;
    const cursor = cursorParam(query.get("cursor"));
    const market = getMarketService();
    return json(market ? await market.list(wallet, cursor) : { market: null, cups: [], nextCursor: null });
  } catch (error) { return failure(error); }
}

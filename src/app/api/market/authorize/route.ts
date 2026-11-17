import { getMarketService } from "@/lib/market/server";
import { failure, json, limitSigning, readPurchaseRequest } from "@/lib/market/http";
import { MarketError } from "@/lib/market/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let release: (() => void) | undefined;
  try {
    const body = await readPurchaseRequest(request);
    release = limitSigning(request);
    const market = getMarketService();
    if (!market) throw new MarketError("Buying is not available yet.");
    return json(await market.authorize(body.cup, body.buyer, body));
  } catch (error) { return failure(error); }
  finally { release?.(); }
}

import { NextResponse } from "next/server";
import { fetchOwnedCups } from "@/lib/ownership";

type RouteContext = {
  params: Promise<{ address: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { address } = await context.params;

  try {
    const cups = await fetchOwnedCups(address);
    return NextResponse.json({ address, count: cups.length, cups });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load owned cups";
    const status = message.startsWith("Invalid") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextResponse } from "next/server";
import { isPairId } from "@/config/pairs";
import { getMarketTick } from "@/lib/market/tick";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const pair = url.searchParams.get("pair") ?? "HSK/USDT";
  const tradeUsd = Math.min(Math.max(Number(url.searchParams.get("tradeUsd") ?? 50) || 50, 1), 500);
  if (!isPairId(pair)) return NextResponse.json({ error: "unsupported pair" }, { status: 400 });
  try {
    return NextResponse.json(await getMarketTick(pair, tradeUsd));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

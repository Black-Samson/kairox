import { NextResponse } from "next/server";
import { isPairId, PAIRS } from "@/config/pairs";
import { getReferenceHistory } from "@/lib/market/reference";
import { isTimeframe } from "@/lib/market/timeframes";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const pair = params.get("pair") ?? "HSK/USDT";
  const tf = params.get("tf") ?? "1m";
  if (!isPairId(pair)) return NextResponse.json({ error: "unsupported pair" }, { status: 400 });
  if (!isTimeframe(tf)) return NextResponse.json({ error: "unsupported timeframe" }, { status: 400 });
  return NextResponse.json(await getReferenceHistory(PAIRS[pair], tf));
}

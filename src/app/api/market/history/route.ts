import { NextResponse } from "next/server";
import { isPairId, PAIRS } from "@/config/pairs";
import { getReferenceHistory } from "@/lib/market/reference";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pair = new URL(req.url).searchParams.get("pair") ?? "HSK/USDT";
  if (!isPairId(pair)) return NextResponse.json({ error: "unsupported pair" }, { status: 400 });
  return NextResponse.json(await getReferenceHistory(PAIRS[pair]));
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getAddress, isAddress } from "viem";
import { activeChain } from "@/config/chains";
import { contracts, vaultReady } from "@/config/contracts";
import { PAIRS, isPairId, pairLiveCapable } from "@/config/pairs";
import { hashDecision } from "@/lib/agent/journal";
import type { DecisionRecord } from "@/lib/agent/types";
import { agentConfigured, executeVaultTrade } from "@/lib/chain/executor";
import { getPublicClient } from "@/lib/chain/client";
import { kairoxVaultAbi } from "@/lib/chain/kairoxVaultAbi";
import { verifySession } from "@/lib/chain/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  session: z.object({
    owner: z.string().refine(isAddress),
    expiresAt: z.number(),
    signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  }),
  side: z.enum(["BUY", "SELL"]),
  amount: z.string().regex(/^(all|\d+(\.\d+)?)$/),
  maxSlippagePct: z.number().positive().max(5),
  record: z.object({
    pair: z.string(),
    side: z.enum(["BUY", "SELL"]),
    time: z.number(),
    dexPrice: z.number(),
    refPrice: z.number(),
    spreadPct: z.number(),
    momentumPct: z.number(),
    score: z.number().min(0).max(1),
    reason: z.string().max(500),
    config: z.object({
      maxTradeUsd: z.number(),
      stopLossPct: z.number(),
      takeProfitPct: z.number(),
      maxSlippagePct: z.number(),
    }),
  }),
});

export async function POST(req: Request) {
  if (!vaultReady || !agentConfigured() || !contracts.vault) {
    return NextResponse.json({ error: "Live execution not configured — running in sandbox" }, { status: 409 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  const body = parsed.data;
  if (!isPairId(body.record.pair) || !pairLiveCapable(body.record.pair)) {
    return NextResponse.json({ error: "pair not tradable live with this vault" }, { status: 400 });
  }
  if (body.record.side !== body.side) return NextResponse.json({ error: "side mismatch" }, { status: 400 });

  try {
    const onchainOwner = await getPublicClient().readContract({
      address: contracts.vault,
      abi: kairoxVaultAbi,
      functionName: "owner",
    });
    const check = await verifySession(
      { owner: getAddress(body.session.owner), expiresAt: body.session.expiresAt, signature: body.session.signature as `0x${string}` },
      { vault: contracts.vault, chainId: activeChain.id, onchainOwner },
    );
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 401 });

    const record = body.record as DecisionRecord;
    const reasonHash = hashDecision(record);
    const result = await executeVaultTrade({
      pair: PAIRS[record.pair],
      side: body.side,
      amount: body.amount,
      maxSlippagePct: body.maxSlippagePct,
      reasonHash,
      signalScoreBps: record.score * 10_000,
    });
    return NextResponse.json({ ...result, reasonHash });
  } catch (err) {
    const msg = (err as Error).message ?? "execution failed";
    // Surface the vault's custom error name (e.g. TradeTooLarge) when the on-chain guardrail rejects.
    const guardrail = msg.match(/reverted with the following reason:\s*([^\n]+)|Error: (\w+)\(/);
    return NextResponse.json({ error: guardrail?.[1] ?? guardrail?.[2] ?? msg.split("\n")[0] }, { status: 422 });
  }
}

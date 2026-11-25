import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_CONFIG } from "@/lib/agent/riskEngine";
import { runCopilot, type AgentSnapshot } from "@/lib/agent/copilot";
import type { RiskConfig } from "@/lib/agent/types";
import { contracts } from "@/config/contracts";
import { readVaultStatus } from "@/lib/chain/executor";

export const dynamic = "force-dynamic";

const Body = z.object({
  message: z.string().min(1).max(1000),
  config: z.record(z.unknown()).optional(),
  snapshot: z.record(z.unknown()).optional(),
  live: z.boolean().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const { message, live } = parsed.data;
  const config = { ...DEFAULT_CONFIG, ...(parsed.data.config as Partial<RiskConfig>) };
  const snapshot = (parsed.data.snapshot ?? {}) as unknown as AgentSnapshot;

  // In live mode the vault's on-chain limits are the ceiling for anything the copilot proposes.
  let ceilings = {};
  if (live && contracts.vault) {
    try {
      const v = await readVaultStatus();
      if (v) {
        ceilings = {
          maxTradeUsd: v.limits.maxTradeQuote,
          maxSlippagePct: v.limits.maxSlippagePct,
          dailyLossLimitUsd: v.limits.dailyLossLimitQuote,
        };
      }
    } catch {
      /* fall back to hard limits only */
    }
  }

  const result = await runCopilot(message, config, snapshot, ceilings);
  return NextResponse.json(result);
}

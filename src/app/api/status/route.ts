import { NextResponse } from "next/server";
import { activeChain, activeNetwork } from "@/config/chains";
import { contractIssues, contracts, hskswapVersion, onchainMarketReady, vaultReady } from "@/config/contracts";
import { agentAddress, agentConfigured, readVaultStatus } from "@/lib/chain/executor";

export const dynamic = "force-dynamic";

export async function GET() {
  let vault = null;
  let vaultError: string | undefined;
  if (contracts.vault) {
    try {
      vault = await readVaultStatus();
    } catch (err) {
      vaultError = (err as Error).message.split("\n")[0];
    }
  }
  const issues = [...contractIssues];
  if (!agentConfigured()) issues.push("AGENT_PRIVATE_KEY not set (server)");
  if (vault && agentAddress() && vault.operator.toLowerCase() !== agentAddress()!.toLowerCase()) {
    issues.push("Vault operator does not match AGENT_PRIVATE_KEY address");
  }
  return NextResponse.json({
    network: activeNetwork,
    chainId: activeChain.id,
    hskswapVersion,
    marketMode: onchainMarketReady ? "onchain" : "reference",
    liveAvailable: vaultReady && agentConfigured() && !!vault,
    agentAddress: agentAddress() ?? null,
    llm: Boolean(process.env.LLM_API_KEY),
    issues,
    vault,
    vaultError,
  });
}

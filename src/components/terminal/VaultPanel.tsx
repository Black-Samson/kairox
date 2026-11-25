"use client";

import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount, useReadContract, useSignMessage, useWriteContract, usePublicClient } from "wagmi";
import { activeChain, explorerAddress } from "@/config/chains";
import { contracts } from "@/config/contracts";
import { erc20Abi } from "@/lib/chain/abis";
import { kairoxVaultAbi } from "@/lib/chain/kairoxVaultAbi";
import { buildSessionMessage, SESSION_TTL_MS } from "@/lib/chain/session";
import { fmtSigned, pnlClass, shortAddr } from "@/lib/format";
import { useAgentStore } from "@/store/agentStore";
import { refreshStatus } from "@/store/status";

function Row({ k, v, className = "text-white/80" }: { k: string; v: React.ReactNode; className?: string }) {
  return (
    <div className="flex justify-between border-b border-white/5 py-1.5 text-xs">
      <span className="text-white/45">{k}</span>
      <span className={`num ${className}`}>{v}</span>
    </div>
  );
}

function SetupGuide({ issues }: { issues: string[] }) {
  return (
    <div className="space-y-3 text-xs leading-relaxed text-white/65">
      <p className="text-sm font-semibold text-white">Vault not connected — running in sandbox</p>
      <p>
        Live trading goes through <span className="text-cyan">KairoxVault</span>: you deposit, the agent can only trade within limits the
        contract enforces on-chain, and only you can withdraw or pause it.
      </p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Paste the HSKSwap router, quoter, WHSK and USDT addresses into <code className="text-cyan">.env.local</code>.</li>
        <li>
          Deploy the vault: <code className="text-cyan">cd contracts && npm run deploy:mainnet</code>.
        </li>
        <li>
          Set <code className="text-cyan">NEXT_PUBLIC_KAIROX_VAULT_ADDRESS</code> and the server-only <code className="text-cyan">AGENT_PRIVATE_KEY</code> (the vault operator).
        </li>
        <li>Restart, connect the owner wallet, deposit USDT here, then enable live trading.</li>
      </ol>
      {issues.length > 0 && (
        <ul className="rounded-lg bg-obsidian/60 p-2 text-white/45">
          {issues.map((i) => (
            <li key={i}>• {i}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function VaultPanel() {
  const status = useAgentStore((s) => s.serverStatus);
  const executionMode = useAgentStore((s) => s.executionMode);
  const dataSource = useAgentStore((s) => s.dataSource);
  const enableLive = useAgentStore((s) => s.enableLive);
  const disableLive = useAgentStore((s) => s.disableLive);
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const [amount, setAmount] = useState("50");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const vault = status?.vault;
  const { data: quoteDecimals } = useReadContract({
    address: contracts.usdt,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!contracts.usdt },
  });

  if (!status) return <p className="py-6 text-center text-xs text-white/35">Loading vault status…</p>;
  if (!vault || !contracts.vault) {
    return (
      <>
        {status.vaultError && <p className="mb-2 text-xs text-crimson">Vault read failed: {status.vaultError}</p>}
        <SetupGuide issues={status.issues} />
      </>
    );
  }

  const isOwner = !!address && address.toLowerCase() === vault.owner.toLowerCase();
  const decimals = quoteDecimals ?? 6;

  const run = (key: string, fn: () => Promise<string | void>) => async () => {
    setBusy(key);
    setMsg(null);
    try {
      const out = await fn();
      setMsg(out ?? "Done.");
      await refreshStatus();
    } catch (e) {
      setMsg(`Error: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      setBusy(null);
    }
  };

  const wait = async (hash: `0x${string}`) => {
    await publicClient?.waitForTransactionReceipt({ hash });
    return `Confirmed ${shortAddr(hash)}`;
  };

  const deposit = run("deposit", async () => {
    const value = parseUnits(amount, decimals);
    const approve = await writeContractAsync({
      chainId: activeChain.id,
      address: contracts.usdt!,
      abi: erc20Abi,
      functionName: "approve",
      args: [contracts.vault!, value],
    });
    await publicClient?.waitForTransactionReceipt({ hash: approve });
    const hash = await writeContractAsync({
      chainId: activeChain.id,
      address: contracts.vault!,
      abi: kairoxVaultAbi,
      functionName: "deposit",
      args: [contracts.usdt!, value],
    });
    return wait(hash);
  });

  const withdraw = run("withdraw", async () => {
    const hash = await writeContractAsync({
      chainId: activeChain.id,
      address: contracts.vault!,
      abi: kairoxVaultAbi,
      functionName: "withdraw",
      args: [contracts.usdt!, parseUnits(amount, decimals), address!],
    });
    return wait(hash);
  });

  const togglePause = run("pause", async () => {
    const hash = await writeContractAsync({
      chainId: activeChain.id,
      address: contracts.vault!,
      abi: kairoxVaultAbi,
      functionName: "setPaused",
      args: [!vault.paused],
    });
    return wait(hash);
  });

  const goLive = run("live", async () => {
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const message = buildSessionMessage({ vault: contracts.vault!, chainId: activeChain.id, owner: address!, expiresAt });
    const signature = await signMessageAsync({ message });
    enableLive({ owner: address!, expiresAt, signature });
    return "Live trading enabled for 12 hours.";
  });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <p className="text-sm font-semibold text-white">KairoxVault</p>
          <a href={explorerAddress(vault.address)} target="_blank" rel="noreferrer" className="num text-xs text-cyan hover:underline">
            {shortAddr(vault.address)} ↗
          </a>
        </div>
        <Row k="On-chain state" v={vault.paused ? "PAUSED" : vault.lossHalted ? "LOSS-HALTED" : "ACTIVE"} className={vault.paused || vault.lossHalted ? "text-crimson" : "text-emerald"} />
        <Row k="USDT balance" v={vault.quoteBalance.toFixed(2)} />
        <Row k="Open exposure" v={vault.openExposure.toFixed(2)} />
        <Row k="Realized today" v={fmtSigned(vault.dailyRealizedPnl)} className={pnlClass(vault.dailyRealizedPnl)} />
        <Row k="Trades (journal)" v={vault.tradeCount} />
        <Row k="Owner" v={shortAddr(vault.owner)} />
        <Row k="Operator (agent)" v={shortAddr(vault.operator)} />
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-white">On-chain limits</p>
        <Row k="Max per trade" v={`${vault.limits.maxTradeQuote} USDT`} />
        <Row k="Max open exposure" v={`${vault.limits.maxOpenExposureQuote} USDT`} />
        <Row k="Daily loss limit" v={`${vault.limits.dailyLossLimitQuote} USDT`} />
        <Row k="Max slippage (oracle)" v={`${vault.limits.maxSlippagePct}%`} />
        <Row k="Min entry interval" v={`${vault.limits.minTradeInterval}s`} />

        <div className="mt-3 space-y-2">
          {!address && <p className="text-xs text-white/45">Connect the owner wallet to manage the vault.</p>}
          {address && !isOwner && <p className="text-xs text-amber-300">Connected wallet is not the vault owner — read-only.</p>}
          {isOwner && (
            <>
              <div className="flex gap-2">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                  className="num w-24 rounded-lg border border-white/10 bg-obsidian px-2 py-1.5 text-xs text-white outline-none focus:border-cyan/60"
                  aria-label="Amount in USDT"
                />
                <button onClick={deposit} disabled={!!busy} className="flex-1 rounded-lg bg-raised py-1.5 text-xs font-semibold text-white hover:bg-raised-hover disabled:opacity-40">
                  {busy === "deposit" ? "Depositing…" : "Deposit USDT"}
                </button>
                <button onClick={withdraw} disabled={!!busy} className="flex-1 rounded-lg bg-raised py-1.5 text-xs font-semibold text-white hover:bg-raised-hover disabled:opacity-40">
                  {busy === "withdraw" ? "Withdrawing…" : "Withdraw"}
                </button>
              </div>
              <button
                onClick={togglePause}
                disabled={!!busy}
                className={`w-full rounded-lg border py-1.5 text-xs font-semibold disabled:opacity-40 ${vault.paused ? "border-emerald/40 text-emerald" : "border-crimson/40 text-crimson"}`}
              >
                {busy === "pause" ? "Confirming…" : vault.paused ? "Unpause vault on-chain" : "Pause vault on-chain (hard kill-switch)"}
              </button>
              {executionMode === "live" ? (
                <button onClick={disableLive} className="w-full rounded-lg border border-white/15 py-2 text-xs font-semibold text-white/70 hover:text-white">
                  Back to sandbox
                </button>
              ) : (
                <button
                  onClick={goLive}
                  disabled={!!busy || !status.liveAvailable || dataSource === "replay"}
                  className="w-full rounded-lg bg-cyan py-2 text-xs font-bold text-ink disabled:opacity-40"
                  title={dataSource === "replay" ? "Switch to live data first" : !status.liveAvailable ? status.issues.join("; ") : undefined}
                >
                  {busy === "live" ? "Sign in wallet…" : "Enable live trading (sign once)"}
                </button>
              )}
            </>
          )}
          {msg && <p className="text-xs text-white/60">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

export default VaultPanel;

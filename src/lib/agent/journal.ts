import { keccak256, stringToHex } from "viem";
import type { DecisionRecord } from "./types";

/** Deterministic JSON (sorted keys) so the same decision always hashes the same way. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * Hash of the agent's decision record. In live mode this is written on-chain in
 * KairoxVault.TradeExecuted(reasonHash), so anyone can check that the reasoning shown in the
 * terminal is exactly what the agent committed to before trading.
 */
export function hashDecision(record: DecisionRecord): `0x${string}` {
  return keccak256(stringToHex(stableStringify(record)));
}

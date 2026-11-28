import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { activeChain } from "@/config/chains";

let client: PublicClient | undefined;

/** Shared public client with RPC fallback (primary RPC first, then the secondary). */
export function getPublicClient(): PublicClient {
  if (!client) {
    const urls = rpcUrls();
    client = createPublicClient({
      chain: activeChain,
      transport: fallback(urls.map((u) => http(u, { timeout: 15_000, retryCount: 2 }))),
    }) as PublicClient;
  }
  return client;
}

/**
 * RPCs in priority order: HSK_RPC_URL (optional override), the official RPC, then an optional
 * HSK_RPC_FALLBACK. Only the official RPCs are built in — unverified third-party RPCs were removed.
 */
export function rpcUrls(): string[] {
  const urls = [process.env.HSK_RPC_URL, ...activeChain.rpcUrls.default.http, process.env.HSK_RPC_FALLBACK]
    .map((u) => u?.trim())
    .filter((u): u is string => Boolean(u));
  return Array.from(new Set(urls));
}

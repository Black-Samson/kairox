import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { activeChain } from "@/config/chains";

let client: PublicClient | undefined;

/** Shared public client with RPC fallback (primary RPC first, then the secondary). */
export function getPublicClient(): PublicClient {
  if (!client) {
    const override = process.env.HSK_RPC_URL;
    const urls = override ? [override, ...activeChain.rpcUrls.default.http] : [...activeChain.rpcUrls.default.http];
    client = createPublicClient({
      chain: activeChain,
      transport: fallback(urls.map((u) => http(u, { timeout: 8000 }))),
    }) as PublicClient;
  }
  return client;
}

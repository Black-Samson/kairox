/**
 * Owner session for live trading. The browser signs one message with the vault OWNER's wallet; the
 * server verifies the signature and checks `vault.owner()` before it lets the agent key trade.
 * The agent key never leaves the server, and the vault caps what it can do anyway.
 */
import { getAddress, verifyMessage, type Address, type Hex } from "viem";

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function buildSessionMessage(params: { vault: Address; chainId: number; owner: Address; expiresAt: number }) {
  return [
    "Kairox agent session",
    `Vault: ${getAddress(params.vault)}`,
    `Owner: ${getAddress(params.owner)}`,
    `Chain: ${params.chainId}`,
    `Expires: ${new Date(params.expiresAt).toISOString()}`,
    "",
    "Signing lets the Kairox agent trade through your vault within its on-chain limits.",
    "It cannot withdraw funds.",
  ].join("\n");
}

export interface OwnerSession {
  owner: Address;
  expiresAt: number;
  signature: Hex;
}

export async function verifySession(
  session: OwnerSession,
  params: { vault: Address; chainId: number; onchainOwner: Address },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!session?.signature || !session.owner) return { ok: false, reason: "missing session" };
  if (Date.now() > session.expiresAt) return { ok: false, reason: "session expired — sign again" };
  if (getAddress(session.owner) !== getAddress(params.onchainOwner)) {
    return { ok: false, reason: "connected wallet is not the vault owner" };
  }
  const message = buildSessionMessage({
    vault: params.vault,
    chainId: params.chainId,
    owner: session.owner,
    expiresAt: session.expiresAt,
  });
  const valid = await verifyMessage({ address: session.owner, message, signature: session.signature });
  return valid ? { ok: true } : { ok: false, reason: "invalid signature" };
}

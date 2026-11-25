"use client";

import { useAgentStore, type ServerStatus } from "./agentStore";

/** Fetch /api/status (mode, config issues, on-chain vault state) into the store. */
export async function refreshStatus(): Promise<ServerStatus | undefined> {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    if (!res.ok) return undefined;
    const data = (await res.json()) as ServerStatus;
    useAgentStore.getState().setServerStatus(data);
    return data;
  } catch {
    return undefined;
  }
}

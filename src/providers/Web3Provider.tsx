"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider, createConfig as createPrivyWagmiConfig } from "@privy-io/wagmi";
import { WagmiProvider, createConfig, http, useAccount, useDisconnect } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { activeChain, hashkeyMainnet, hashkeyTestnet } from "@/config/chains";
import { useAgentStore } from "@/store/agentStore";

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
export const privyEnabled = privyAppId.length > 10;
const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

// Both HashKey chains get a transport so the config type-checks whichever network is active.
const transports = {
  [hashkeyMainnet.id]: http(hashkeyMainnet.rpcUrls.default.http[0]),
  [hashkeyTestnet.id]: http(hashkeyTestnet.rpcUrls.default.http[0]),
};

const privyWagmiConfig = createPrivyWagmiConfig({ chains: [activeChain], transports, ssr: true });

const fallbackWagmiConfig = createConfig({
  chains: [activeChain],
  transports,
  ssr: true,
  connectors: [
    injected({ shimDisconnect: true }), // MetaMask, OKX Wallet and other browser wallets
    ...(wcProjectId ? [walletConnect({ projectId: wcProjectId, showQrModal: true })] : []),
  ],
});

interface AuthActions {
  logout: () => Promise<void>;
}
const AuthActionsContext = createContext<AuthActions>({ logout: async () => {} });
export const useAuthActions = () => useContext(AuthActionsContext);

/** Mirrors Privy's auth state into the agent store. */
function PrivySessionBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, logout } = usePrivy();
  const { address } = useAccount();
  const setSession = useAgentStore((s) => s.setSession);
  const session = useAgentStore((s) => s.session);

  useEffect(() => {
    if (!ready) return;
    if (authenticated && user) {
      const method = user.google ? "google" : user.twitter ? "twitter" : user.email ? "email" : user.wallet?.walletClientType === "privy" ? "passkey" : "wallet";
      const label = user.google?.email ?? (user.twitter?.username ? `@${user.twitter.username}` : undefined) ?? user.email?.address ?? undefined;
      const name = user.google?.name ?? user.twitter?.name ?? user.twitter?.username ?? user.email?.address?.split("@")[0] ?? undefined;
      const addr = (address ?? user.wallet?.address) as `0x${string}` | undefined;
      if (session.kind !== "privy" || session.address !== addr || session.label !== label || session.name !== name) {
        setSession({ kind: "privy", method, label, name: name ?? undefined, address: addr });
      }
    } else if (session.kind === "privy") {
      setSession({ kind: "none" });
    }
  }, [ready, authenticated, user, address, session, setSession]);

  const actions = useMemo(() => ({ logout: async () => { await logout(); setSession({ kind: "none" }); } }), [logout, setSession]);
  return <AuthActionsContext.Provider value={actions}>{children}</AuthActionsContext.Provider>;
}

/** Mirrors a plain wagmi wallet connection into the agent store (used when Privy is not configured). */
function WalletSessionBridge({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const setSession = useAgentStore((s) => s.setSession);
  const session = useAgentStore((s) => s.session);

  useEffect(() => {
    if (isConnected && address) {
      if (session.kind !== "wallet" || session.address !== address) {
        setSession({ kind: "wallet", method: "wallet", address });
      }
    } else if (session.kind === "wallet") {
      setSession({ kind: "none" });
    }
  }, [isConnected, address, session, setSession]);

  const actions = useMemo(
    () => ({ logout: async () => { await disconnectAsync().catch(() => {}); setSession({ kind: "none" }); } }),
    [disconnectAsync, setSession],
  );
  return <AuthActionsContext.Provider value={actions}>{children}</AuthActionsContext.Provider>;
}

export function Web3Provider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  if (privyEnabled) {
    return (
      <PrivyProvider
        appId={privyAppId}
        config={{
          appearance: {
            theme: "dark",
            accentColor: "#00F0FF",
            walletList: ["okx_wallet", "metamask", "detected_ethereum_wallets", "wallet_connect"],
          },
          loginMethods: ["google", "twitter", "email", "wallet", "passkey"],
          embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
          defaultChain: activeChain,
          supportedChains: [activeChain],
          ...(wcProjectId ? { walletConnectCloudProjectId: wcProjectId } : {}),
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PrivyWagmiProvider config={privyWagmiConfig}>
            <PrivySessionBridge>{children}</PrivySessionBridge>
          </PrivyWagmiProvider>
        </QueryClientProvider>
      </PrivyProvider>
    );
  }

  return (
    <WagmiProvider config={fallbackWagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WalletSessionBridge>{children}</WalletSessionBridge>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

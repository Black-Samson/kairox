"use client";

import dynamic from "next/dynamic";
import { KxMark } from "@/components/brand/KairoxLogo";

// The terminal reads localStorage, wallets and live prices, so it renders on the client only.
const App = dynamic(
  async () => {
    const [{ Web3Provider }, { Terminal }] = await Promise.all([
      import("@/providers/Web3Provider"),
      import("./Terminal"),
    ]);
    return function KairoxApp() {
      return (
        <Web3Provider>
          <Terminal />
        </Web3Provider>
      );
    };
  },
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center">
        <KxMark size={44} className="kx-pulse" />
      </div>
    ),
  },
);

export function ClientApp() {
  return <App />;
}

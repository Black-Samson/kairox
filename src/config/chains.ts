import { defineChain } from "viem";

export const hashkeyMainnet = defineChain({
  id: 177,
  name: "HashKey Chain",
  nativeCurrency: { name: "HashKey Platform Token", symbol: "HSK", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://mainnet.hsk.xyz"] },
  },
  blockExplorers: {
    default: { name: "HashKey Explorer", url: "https://explorer.hsk.xyz" },
  },
});

export const hashkeyTestnet = defineChain({
  id: 133,
  name: "HashKey Chain Testnet",
  nativeCurrency: { name: "HashKey Platform Token", symbol: "HSK", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet.hsk.xyz"] },
  },
  blockExplorers: {
    default: { name: "HashKey Testnet Explorer", url: "https://testnet-explorer.hsk.xyz" },
  },
  testnet: true,
});

export type HskNetwork = "mainnet" | "testnet";

export const activeNetwork: HskNetwork =
  process.env.NEXT_PUBLIC_HSK_NETWORK === "testnet" ? "testnet" : "mainnet";

export const activeChain = activeNetwork === "testnet" ? hashkeyTestnet : hashkeyMainnet;

export const explorerTx = (hash: string) => `${activeChain.blockExplorers.default.url}/tx/${hash}`;
export const explorerAddress = (address: string) =>
  `${activeChain.blockExplorers.default.url}/address/${address}`;

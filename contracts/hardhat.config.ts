import "dotenv/config";
import type { HardhatUserConfig } from "hardhat/config";
import { subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";
import "@nomicfoundation/hardhat-toolbox-viem";
import path from "node:path";

const SOLC_VERSION = "0.8.24";

// Offline / firewalled environments: set SOLC_LOCAL=1 to compile with the bundled solc-js
// (npm "solc") instead of downloading the native compiler.
if (process.env.SOLC_LOCAL === "1") {
  subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args: { solcVersion: string }, _hre, runSuper) => {
    if (args.solcVersion !== SOLC_VERSION) return runSuper();
    return {
      compilerPath: path.join(__dirname, "node_modules", "solc", "soljson.js"),
      isSolcJs: true,
      version: SOLC_VERSION,
      longVersion: "0.8.24+commit.e11b9ed9",
    };
  });
}

const accounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: SOLC_VERSION,
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: false },
  },
  networks: {
    hashkey: {
      url: process.env.HSK_MAINNET_RPC ?? "https://mainnet.hsk.xyz",
      chainId: 177,
      accounts,
    },
    hashkeyTestnet: {
      url: process.env.HSK_TESTNET_RPC ?? "https://testnet.hsk.xyz",
      chainId: 133,
      accounts,
    },
  },
  etherscan: {
    apiKey: { hashkey: "empty", hashkeyTestnet: "empty" },
    customChains: [
      {
        network: "hashkey",
        chainId: 177,
        urls: { apiURL: "https://explorer.hsk.xyz/api", browserURL: "https://explorer.hsk.xyz" },
      },
      {
        network: "hashkeyTestnet",
        chainId: 133,
        urls: {
          apiURL: "https://testnet-explorer.hsk.xyz/api",
          browserURL: "https://testnet-explorer.hsk.xyz",
        },
      },
    ],
  },
};

export default config;

/**
 * Deploys KairoxVault to HashKey Chain.
 *
 *   npx hardhat run scripts/deploy.ts --network hashkeyTestnet
 *   npx hardhat run scripts/deploy.ts --network hashkey
 *
 * Required env (contracts/.env or exported in your shell):
 *   DEPLOYER_PRIVATE_KEY     owner of the vault (your wallet, NOT the agent key)
 *   VAULT_QUOTE_TOKEN        USDT address on the target network
 *   HSKSWAP_ROUTER           HSKSwap router address
 *   AGENT_OPERATOR_ADDRESS   address of the agent's hot wallet (from AGENT_PRIVATE_KEY)
 * Optional:
 *   VAULT_BASE_TOKENS        comma-separated base tokens to allowlist (e.g. WHSK)
 *   VAULT_MAX_TRADE          max USDT per entry        (default 50)
 *   VAULT_MAX_EXPOSURE       max open exposure in USDT (default 200)
 *   VAULT_DAILY_LOSS         daily loss limit in USDT  (default 25)
 *   VAULT_MAX_SLIPPAGE_BPS   on-chain slippage cap     (default 100 = 1%)
 *   VAULT_MIN_INTERVAL       seconds between entries   (default 30)
 */
import hre from "hardhat";
import { getAddress, isAddress, parseUnits } from "viem";
import fs from "node:fs";
import path from "node:path";

function requireAddress(name: string): `0x${string}` {
  const value = process.env[name];
  if (!value || !isAddress(value)) {
    throw new Error(`Missing or invalid ${name}. Paste the real address — never guess contract addresses.`);
  }
  return getAddress(value);
}

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const quote = requireAddress("VAULT_QUOTE_TOKEN");
  const router = requireAddress("HSKSWAP_ROUTER");
  const operator = requireAddress("AGENT_OPERATOR_ADDRESS");

  const quoteToken = await hre.viem.getContractAt("MockERC20", quote); // only ERC20 views are used
  const decimals = await quoteToken.read.decimals();
  const q = (env: string, fallback: string) => parseUnits(process.env[env] ?? fallback, decimals);

  const limits = {
    maxTradeQuote: q("VAULT_MAX_TRADE", "50"),
    maxOpenExposureQuote: q("VAULT_MAX_EXPOSURE", "200"),
    dailyLossLimitQuote: q("VAULT_DAILY_LOSS", "25"),
    maxSlippageBps: Number(process.env.VAULT_MAX_SLIPPAGE_BPS ?? 100),
    minTradeInterval: Number(process.env.VAULT_MIN_INTERVAL ?? 30),
  };

  console.log(`Network:   ${hre.network.name} (chainId ${await publicClient.getChainId()})`);
  console.log(`Owner:     ${deployer.account.address}`);
  console.log(`Operator:  ${operator}`);
  console.log(`Router:    ${router}`);
  console.log(`Quote:     ${quote} (${decimals} decimals)`);

  const vault = await hre.viem.deployContract("KairoxVault", [
    deployer.account.address,
    quote,
    router,
    operator,
    limits,
  ]);
  console.log(`\nKairoxVault deployed at ${vault.address}`);

  const bases = (process.env.VAULT_BASE_TOKENS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const base of bases) {
    if (!isAddress(base)) throw new Error(`Invalid base token ${base}`);
    const hash = await vault.write.setAllowedToken([getAddress(base), true]);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`Allowlisted ${base}`);
  }

  const out = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        vault: vault.address,
        owner: deployer.account.address,
        operator,
        router,
        quote,
        bases,
        limits: Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, v.toString()])),
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`\nSaved ${out}`);
  console.log(`Next: set NEXT_PUBLIC_KAIROX_VAULT_ADDRESS=${vault.address} in the app's .env.local`);
  console.log(`Then deposit USDT from the owner wallet (approve + vault.deposit) or via the app.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

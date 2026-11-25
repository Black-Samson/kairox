// Copies the compiled KairoxVault ABI into the app. Run after `cd contracts && npm run compile`.
import fs from "node:fs";

const artifact = JSON.parse(
  fs.readFileSync("contracts/artifacts/contracts/KairoxVault.sol/KairoxVault.json", "utf8"),
);
fs.writeFileSync(
  "src/lib/chain/kairoxVaultAbi.ts",
  `// Generated from contracts/artifacts/contracts/KairoxVault.sol/KairoxVault.json\n// Regenerate after changing the contract: npm run abi\nexport const kairoxVaultAbi = ${JSON.stringify(artifact.abi, null, 2)} as const;\n`,
);
console.log("Wrote src/lib/chain/kairoxVaultAbi.ts");

# CLAUDE.md — Kairox

## What this is

Kairox is the owner's **Track 1 (AI Agent Trading)** entry for the **HSK Chain Horizon Hackathon, Seoul**.

- **Submission deadline: Dec 3 2026, 13:00 KST** (04:00 UTC). Prefer changes that keep the demo working over new features as the deadline gets close.
- It is an autonomous trading terminal for HSKSwap on HashKey Chain (mainnet 177, testnet 133). It does long-only spot spread / mean-reversion trading against a CEX reference price.
- Stack: Next.js 15 + TypeScript app in `src/`, a separate Hardhat project (Solidity 0.8.24, OpenZeppelin 5) in `contracts/`, and a headless agent in `scripts/agent-worker.ts`.
- `README.md` holds the full architecture, demo script and env reference. `contracts/README.md` covers the contract workflow.

## Safety model — never weaken it

Every trade passes three layers, and each layer assumes the one above it can fail:

1. **Copilot (LLM) — untrusted.** `src/lib/agent/copilot.ts`. It can only output a config patch and `pause | resume | close_all`. It never trades. Every patch goes through `clampConfigPatch` in `riskEngine.ts` (hard limits, plus the vault's on-chain limits in live mode).
2. **Risk engine — deterministic TypeScript, no LLM.** `src/lib/agent/riskEngine.ts` (`validateEntry`, `evaluateExit`). It checks max trade size, slippage, daily loss limit, open positions/exposure, cooldown and pause state, and logs each rule's pass/fail.
3. **KairoxVault — on-chain.** `contracts/contracts/KairoxVault.sol`. It re-checks size, exposure, daily loss, cooldown, the token allowlist, pause, and that swap output returns to the vault, whatever the off-chain code says. The agent key is the vault's *operator* and can never withdraw. Only the owner can withdraw, pause or change limits.

**No change may weaken any layer.** That includes:
- loosening or bypassing clamps, hard limits or risk rules
- letting the LLM call execution paths directly
- giving the operator more powers, or removing `onlyOwner` checks
- widening token approvals beyond the exact trade amount
- skipping the owner-signature check in `src/app/api/agent/execute/route.ts`
- making pause stop the stop-loss/take-profit exits
- removing tests in `contracts/test/KairoxVault.test.ts`

If a task seems to need any of these, stop and ask first. When you change a layer, add or update tests that show the limit still holds.

## Environment

- The owner works on **Windows with Git Bash**. Use POSIX shell syntax and forward-slash paths.
- npm runs its scripts through `cmd.exe` on Windows by default, so inline env assignments in scripts can fail there. One example is `"test:offline": "SOLC_LOCAL=1 hardhat test"`. From Git Bash, run `SOLC_LOCAL=1 npx hardhat test` inside `contracts/` instead.
- Checks:
  - `npm run typecheck` and `npm run build` in the root
  - `npm test` in `contracts/` (17 tests)
- After changing the contract, run `npm run compile` in `contracts/`, then `npm run abi` in the root.

## Rules

- **Commits:** small, focused [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`), one logical change each.
- **Never commit `.env`, `.env.local`, `contracts/.env`** or any other real env file. Only the `*.env.example` files belong in git, and they hold no secrets.
- **Never print, log, echo or ask the owner to paste private keys** (`AGENT_PRIVATE_KEY`, `DEPLOYER_PRIVATE_KEY`) or other secrets such as `LLM_API_KEY`. Don't `cat` env files that may hold them. If a key is needed, tell the owner which variable to set in which file and let them do it.
- **Never guess contract or token addresses** (router, quoter, factory, WHSK, USDT, USDC, vault, price feed). They come from env, pasted by the owner from HSKSwap / HashKey docs or the explorer. If one is missing, leave it empty (the app falls back to sandbox mode) and ask.
- **Ask before any mainnet transaction.** That covers `npm run deploy:mainnet`, `npm run agent -- --live`, live trades, deposits, withdrawals, `setPriceFeed` and limit changes on chain 177. State what will happen and get a clear yes each time. Prefer the sandbox, Demo Replay or testnet for testing.

# KairoxVault contracts

Non-custodial vault that lets the Kairox agent trade on HSKSwap within limits enforced on-chain.
See the [main README](../README.md#why-it-is-different-kairoxvault) for the design.

```bash
npm install
npm test                 # 17 tests
npm run test:offline     # same, compiling with bundled solc-js (no compiler download)
cp .env.example .env     # owner key + real addresses
npm run deploy:testnet   # HashKey Chain testnet (133)
npm run deploy:mainnet   # HashKey Chain mainnet (177)
```

After changing the contract, run `npm run compile` here and `npm run abi` in the repo root.

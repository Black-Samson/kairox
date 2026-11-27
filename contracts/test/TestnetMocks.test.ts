/**
 * Tests for the TEST-ONLY testnet mocks (MockSwapRouter02, MockQuoterV2).
 *
 * Calldata and quotes are encoded with the app's own ABIs (src/lib/chain/abis.ts), so if the
 * mocks drift from what the Kairox app sends, these tests fail. Needs `npm install` in the repo
 * root as well (abis.ts imports viem from there).
 */
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { encodeFunctionData, getAddress, keccak256, parseUnits, toHex } from "viem";
import { quoterV2Abi, swapRouter02Abi } from "../../src/lib/chain/abis";

const USDT = (n: string) => parseUnits(n, 6);
const HSK = (n: string) => parseUnits(n, 18);
const FEE = 3000;

// 1 HSK = 0.08 USDT. USDT(6) -> WHSK(18): x * 1e12 * 100 / 8. WHSK -> USDT: the inverse.
const BUY_RATE = [10n ** 12n * 100n, 8n] as const;
const SELL_RATE = [8n, 10n ** 12n * 100n] as const;

describe("Testnet mocks (MockSwapRouter02 + MockQuoterV2)", () => {
  async function deploy() {
    const [owner, operator, stranger] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();
    const usdt = await hre.viem.deployContract("MockERC20", ["Test USDT", "USDT", 6]);
    const whsk = await hre.viem.deployContract("MockERC20", ["Test Wrapped HSK", "WHSK", 18]);
    const router = await hre.viem.deployContract("MockSwapRouter02");
    const quoter = await hre.viem.deployContract("MockQuoterV2", [router.address]);

    await router.write.setRate([usdt.address, whsk.address, ...BUY_RATE]);
    await router.write.setRate([whsk.address, usdt.address, ...SELL_RATE]);
    await usdt.write.mint([router.address, USDT("100000")]);
    await whsk.write.mint([router.address, HSK("1000000")]);
    await usdt.write.mint([owner.account.address, USDT("1000")]);

    const asStranger = await hre.viem.getContractAt("MockSwapRouter02", router.address, {
      client: { wallet: stranger },
    });

    const swap = (tokenIn: `0x${string}`, tokenOut: `0x${string}`, amountIn: bigint, recipient: `0x${string}`, minOut = 0n) =>
      encodeFunctionData({
        abi: swapRouter02Abi,
        functionName: "exactInputSingle",
        args: [
          { tokenIn, tokenOut, fee: FEE, recipient, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n },
        ],
      });

    const quote = async (tokenIn: `0x${string}`, tokenOut: `0x${string}`, amountIn: bigint) => {
      const [amountOut] = await publicClient.readContract({
        address: quoter.address,
        abi: quoterV2Abi,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn, tokenOut, amountIn, fee: FEE, sqrtPriceLimitX96: 0n }],
      });
      return amountOut;
    };

    return { owner, operator, stranger, publicClient, usdt, whsk, router, quoter, asStranger, swap, quote };
  }

  it("is marked test-only", async () => {
    const { router, quoter } = await loadFixture(deploy);
    expect(await router.read.TEST_ONLY()).to.equal(true);
    expect(await quoter.read.TEST_ONLY()).to.equal(true);
  });

  it("swaps app-encoded SwapRouter02 calldata at the owner-set rate and pays the recipient", async () => {
    const { owner, stranger, usdt, whsk, router, swap } = await loadFixture(deploy);
    await usdt.write.approve([router.address, USDT("10")]);
    await owner.sendTransaction({ to: router.address, data: swap(usdt.address, whsk.address, USDT("10"), stranger.account.address) });

    expect(await whsk.read.balanceOf([stranger.account.address])).to.equal(HSK("125")); // 10 / 0.08
    expect(await usdt.read.balanceOf([owner.account.address])).to.equal(USDT("990"));
    expect(await whsk.read.balanceOf([owner.account.address])).to.equal(0n);
  });

  it("quotes exactly what the router pays, in both directions", async () => {
    const { usdt, whsk, router, quote } = await loadFixture(deploy);
    for (const [a, b, amt] of [
      [usdt.address, whsk.address, USDT("1")],
      [usdt.address, whsk.address, USDT("37.123456")],
      [whsk.address, usdt.address, HSK("125")],
      [whsk.address, usdt.address, HSK("0.5")],
    ] as const) {
      expect(await quote(a, b, amt)).to.equal(await router.read.getAmountOut([a, b, amt]));
    }
    expect(await quote(usdt.address, whsk.address, USDT("1"))).to.equal(HSK("12.5"));
    expect(await quote(whsk.address, usdt.address, HSK("125"))).to.equal(USDT("10"));
  });

  it("returns zeros for the extra QuoterV2 outputs", async () => {
    const { usdt, whsk, quoter } = await loadFixture(deploy);
    const [, sqrtAfter, ticks, gas] = await quoter.read.quoteExactInputSingle([
      { tokenIn: usdt.address, tokenOut: whsk.address, amountIn: USDT("1"), fee: FEE, sqrtPriceLimitX96: 0n },
    ]);
    expect([sqrtAfter, ticks, gas]).to.deep.equal([0n, 0, 0n]);
  });

  it("reverts when output is below amountOutMinimum", async () => {
    const { owner, usdt, whsk, router, swap } = await loadFixture(deploy);
    await usdt.write.approve([router.address, USDT("10")]);
    await expect(
      owner.sendTransaction({
        to: router.address,
        data: swap(usdt.address, whsk.address, USDT("10"), owner.account.address, HSK("125") + 1n),
      }),
    ).to.be.rejectedWith("TooLittleReceived");
  });

  it("reverts for a pair without a rate, in the router and the quoter", async () => {
    const { usdt, router, quote } = await loadFixture(deploy);
    const other = await hre.viem.deployContract("MockERC20", ["Other", "OTH", 18]);
    await expect(router.read.getAmountOut([usdt.address, other.address, USDT("1")])).to.be.rejectedWith("RateNotSet");
    await expect(quote(usdt.address, other.address, USDT("1"))).to.be.rejectedWith("RateNotSet");
  });

  it("rejects native HSK sent with a swap", async () => {
    const { owner, usdt, whsk, router, swap } = await loadFixture(deploy);
    await usdt.write.approve([router.address, USDT("1")]);
    await expect(
      owner.sendTransaction({ to: router.address, data: swap(usdt.address, whsk.address, USDT("1"), owner.account.address), value: 1n }),
    ).to.be.rejectedWith("NativeNotSupported");
  });

  it("lets only the owner set rates or withdraw liquidity", async () => {
    const { owner, stranger, usdt, whsk, router, asStranger } = await loadFixture(deploy);
    await expect(asStranger.write.setRate([usdt.address, whsk.address, 1n, 1n])).to.be.rejectedWith("OwnableUnauthorizedAccount");
    await expect(asStranger.write.withdraw([usdt.address, 1n, stranger.account.address])).to.be.rejectedWith(
      "OwnableUnauthorizedAccount",
    );
    await expect(router.write.setRate([usdt.address, whsk.address, 0n, 1n])).to.be.rejectedWith("InvalidRate");

    await router.write.withdraw([usdt.address, USDT("5"), owner.account.address]);
    expect(await usdt.read.balanceOf([owner.account.address])).to.equal(USDT("1005"));
  });

  it("works behind KairoxVault the way the app trades: buy then sell, with the vault's guardrails intact", async () => {
    const { owner, operator, usdt, whsk, router, swap, quote } = await loadFixture(deploy);
    const vault = await hre.viem.deployContract("KairoxVault", [
      owner.account.address,
      usdt.address,
      router.address,
      operator.account.address,
      { maxTradeQuote: USDT("10"), maxOpenExposureQuote: USDT("30"), dailyLossLimitQuote: USDT("5"), maxSlippageBps: 100, minTradeInterval: 0 },
    ]);
    await vault.write.setAllowedToken([whsk.address, true]);
    await usdt.write.approve([vault.address, USDT("100")]);
    await vault.write.deposit([usdt.address, USDT("100")]);
    const asOperator = await hre.viem.getContractAt("KairoxVault", vault.address, { client: { wallet: operator } });
    const reasonHash = keccak256(toHex("testnet mock e2e"));

    // Buy, exactly as executor.ts does: quote, minOut below it, router output to the vault.
    const buyIn = USDT("10");
    const buyQuote = await quote(usdt.address, whsk.address, buyIn);
    const buyMin = (buyQuote * 99n) / 100n;
    await asOperator.write.executeTrade([
      {
        tokenIn: usdt.address,
        tokenOut: whsk.address,
        amountIn: buyIn,
        minAmountOut: buyMin,
        routerCalldata: swap(usdt.address, whsk.address, buyIn, vault.address, buyMin),
        reasonHash,
        signalScoreBps: 7000,
      },
    ]);
    const [size, basis] = await vault.read.positions([whsk.address]);
    expect(size).to.equal(buyQuote);
    expect(basis).to.equal(buyIn);

    // The vault's per-trade limit still applies with the mock router.
    const tooBig = USDT("11");
    await expect(
      asOperator.write.executeTrade([
        {
          tokenIn: usdt.address,
          tokenOut: whsk.address,
          amountIn: tooBig,
          minAmountOut: 1n,
          routerCalldata: swap(usdt.address, whsk.address, tooBig, vault.address),
          reasonHash,
          signalScoreBps: 7000,
        },
      ]),
    ).to.be.rejectedWith("TradeTooLarge");

    // Output sent anywhere but the vault is still rejected.
    await expect(
      asOperator.write.executeTrade([
        {
          tokenIn: usdt.address,
          tokenOut: whsk.address,
          amountIn: USDT("5"),
          minAmountOut: 1n,
          routerCalldata: swap(usdt.address, whsk.address, USDT("5"), operator.account.address),
          reasonHash,
          signalScoreBps: 7000,
        },
      ]),
    ).to.be.rejectedWith("InsufficientOutput");

    // Sell the whole position back at the same rate: flat PnL, exposure back to 0.
    const sellQuote = await quote(whsk.address, usdt.address, size);
    await asOperator.write.executeTrade([
      {
        tokenIn: whsk.address,
        tokenOut: usdt.address,
        amountIn: size,
        minAmountOut: sellQuote,
        routerCalldata: swap(whsk.address, usdt.address, size, vault.address, sellQuote),
        reasonHash,
        signalScoreBps: 6000,
      },
    ]);
    expect(await vault.read.openExposure()).to.equal(0n);
    expect(await usdt.read.balanceOf([vault.address])).to.equal(USDT("100"));
    expect(await usdt.read.allowance([vault.address, router.address])).to.equal(0n);
    expect(getAddress(await vault.read.router())).to.equal(getAddress(router.address));
  });
});

import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { encodeFunctionData, getAddress, keccak256, parseUnits, toHex, zeroAddress } from "viem";

const USDT = (n: string) => parseUnits(n, 6);
const HSK = (n: string) => parseUnits(n, 18);
const REASON = keccak256(toHex("spread 0.52% > 0.40% threshold, momentum +0.8"));

describe("KairoxVault", () => {
  async function deploy() {
    const [owner, operator, stranger] = await hre.viem.getWalletClients();
    const usdt = await hre.viem.deployContract("MockERC20", ["Tether USD", "USDT", 6]);
    const whsk = await hre.viem.deployContract("MockERC20", ["Wrapped HSK", "WHSK", 18]);
    const router = await hre.viem.deployContract("MockRouter");

    const limits = {
      maxTradeQuote: USDT("50"),
      maxOpenExposureQuote: USDT("120"),
      dailyLossLimitQuote: USDT("20"),
      maxSlippageBps: 100,
      minTradeInterval: 0,
    };
    const vault = await hre.viem.deployContract("KairoxVault", [
      owner.account.address,
      usdt.address,
      router.address,
      operator.account.address,
      limits,
    ]);
    await vault.write.setAllowedToken([whsk.address, true]);

    // Fund owner + router liquidity. Price: 1 HSK = 0.50 USDT.
    await usdt.write.mint([owner.account.address, USDT("1000")]);
    await usdt.write.mint([router.address, USDT("100000")]);
    await whsk.write.mint([router.address, HSK("1000000")]);
    await router.write.setRate([usdt.address, whsk.address, 2n * 10n ** 12n, 1n]); // 1 USDT(6) -> 2 HSK(18)
    await router.write.setRate([whsk.address, usdt.address, 1n, 2n * 10n ** 12n]);

    await usdt.write.approve([vault.address, USDT("1000")]);
    await vault.write.deposit([usdt.address, USDT("1000")]);

    const asOperator = await hre.viem.getContractAt("KairoxVault", vault.address, {
      client: { wallet: operator },
    });
    const asStranger = await hre.viem.getContractAt("KairoxVault", vault.address, {
      client: { wallet: stranger },
    });

    const swapData = (tokenIn: `0x${string}`, tokenOut: `0x${string}`, amountIn: bigint, recipient = vault.address) =>
      encodeFunctionData({
        abi: router.abi,
        functionName: "swapExactIn",
        args: [tokenIn, tokenOut, amountIn, 0n, recipient],
      });

    const buy = (amountIn: bigint, minOut = 1n, recipient = vault.address) =>
      asOperator.write.executeTrade([
        {
          tokenIn: usdt.address,
          tokenOut: whsk.address,
          amountIn,
          minAmountOut: minOut,
          routerCalldata: swapData(usdt.address, whsk.address, amountIn, recipient),
          reasonHash: REASON,
          signalScoreBps: 7200,
        },
      ]);

    const sell = (amountIn: bigint, minOut = 1n) =>
      asOperator.write.executeTrade([
        {
          tokenIn: whsk.address,
          tokenOut: usdt.address,
          amountIn,
          minAmountOut: minOut,
          routerCalldata: swapData(whsk.address, usdt.address, amountIn),
          reasonHash: REASON,
          signalScoreBps: 6000,
        },
      ]);

    return { owner, operator, stranger, usdt, whsk, router, vault, asOperator, asStranger, buy, sell, swapData, limits };
  }

  it("lets the operator buy within limits and tracks the position", async () => {
    const { vault, whsk, buy } = await loadFixture(deploy);
    await buy(USDT("40"));
    const [size, basis] = await vault.read.positions([whsk.address]);
    expect(size).to.equal(HSK("80"));
    expect(basis).to.equal(USDT("40"));
    expect(await vault.read.openExposure()).to.equal(USDT("40"));
    expect(await vault.read.tradeCount()).to.equal(1n);
  });

  it("emits a decision-journal event with the reason hash", async () => {
    const { vault, buy, usdt, whsk } = await loadFixture(deploy);
    await buy(USDT("10"));
    const events = await vault.getEvents.TradeExecuted();
    expect(events).to.have.lengthOf(1);
    expect(events[0].args.reasonHash).to.equal(REASON);
    expect(events[0].args.signalScoreBps).to.equal(7200);
    expect(getAddress(events[0].args.tokenIn!)).to.equal(getAddress(usdt.address));
    expect(getAddress(events[0].args.tokenOut!)).to.equal(getAddress(whsk.address));
  });

  it("rejects trades from anyone but the operator", async () => {
    const { asStranger, usdt, whsk, swapData } = await loadFixture(deploy);
    await expect(
      asStranger.write.executeTrade([
        {
          tokenIn: usdt.address,
          tokenOut: whsk.address,
          amountIn: USDT("10"),
          minAmountOut: 1n,
          routerCalldata: swapData(usdt.address, whsk.address, USDT("10")),
          reasonHash: REASON,
          signalScoreBps: 0,
        },
      ]),
    ).to.be.rejectedWith("NotOperator");
  });

  it("rejects a trade above maxTradeQuote", async () => {
    const { buy } = await loadFixture(deploy);
    await expect(buy(USDT("51"))).to.be.rejectedWith("TradeTooLarge");
  });

  it("rejects entries that would exceed max open exposure", async () => {
    const { buy } = await loadFixture(deploy);
    await buy(USDT("50"));
    await buy(USDT("50"));
    await expect(buy(USDT("30"))).to.be.rejectedWith("ExposureTooHigh");
  });

  it("blocks all operator trades while paused, but the owner can still withdraw", async () => {
    const { vault, usdt, owner, buy } = await loadFixture(deploy);
    await vault.write.setPaused([true]);
    await expect(buy(USDT("10"))).to.be.rejectedWith("VaultPaused");
    await vault.write.withdraw([usdt.address, USDT("100"), owner.account.address]);
    expect(await usdt.read.balanceOf([owner.account.address])).to.equal(USDT("100"));
  });

  it("reverts if router output goes anywhere but the vault", async () => {
    const { buy, stranger } = await loadFixture(deploy);
    await expect(buy(USDT("10"), 1n, stranger.account.address)).to.be.rejectedWith("InsufficientOutput");
  });

  it("only approves the exact amount, so a greedy router cannot drain the vault", async () => {
    const { asOperator, router, usdt, whsk } = await loadFixture(deploy);
    const data = encodeFunctionData({ abi: router.abi, functionName: "greedySwap", args: [usdt.address, USDT("10")] });
    await expect(
      asOperator.write.executeTrade([
        {
          tokenIn: usdt.address,
          tokenOut: whsk.address,
          amountIn: USDT("10"),
          minAmountOut: 1n,
          routerCalldata: data,
          reasonHash: REASON,
          signalScoreBps: 0,
        },
      ]),
    ).to.be.rejected;
  });

  it("realizes profit on a sell", async () => {
    const { vault, router, usdt, whsk, buy, sell } = await loadFixture(deploy);
    await buy(USDT("40")); // 80 HSK at 0.50
    await router.write.setRate([whsk.address, usdt.address, 11n, 20n * 10n ** 12n]); // 1 HSK -> 0.55 USDT
    await sell(HSK("80"));
    const [, , pnl, exposure] = await vault.read.status();
    expect(pnl).to.equal(USDT("4"));
    expect(exposure).to.equal(0n);
  });

  it("halts new entries after the daily loss limit but still allows exits", async () => {
    const { vault, router, usdt, whsk, buy, sell } = await loadFixture(deploy);
    await buy(USDT("50")); // 100 HSK
    await buy(USDT("50")); // 200 HSK total, basis 100
    await router.write.setRate([whsk.address, usdt.address, 7n, 20n * 10n ** 12n]); // 1 HSK -> 0.35 USDT (-30%)
    await sell(HSK("100")); // realize -15
    await sell(HSK("50")); // realize -7.5 => -22.5, limit is 20
    expect(await vault.read.isLossHalted()).to.equal(true);
    await expect(buy(USDT("5"))).to.be.rejectedWith("DailyLossLimitReached");
    await sell(HSK("50")); // exit still allowed
    expect((await vault.read.positions([whsk.address]))[0]).to.equal(0n);

    const hits = await vault.getEvents.DailyLossLimitHit({}, { fromBlock: 0n });
    expect(hits).to.have.lengthOf(1);

    await time.increase(24 * 60 * 60);
    expect(await vault.read.isLossHalted()).to.equal(false);
    await buy(USDT("5"));
  });

  it("enforces oracle-based slippage when a price feed is set", async () => {
    const { vault, whsk, buy } = await loadFixture(deploy);
    const feed = await hre.viem.deployContract("MockPriceFeed", [8, 50_000_000n]); // 0.50 USDT
    await vault.write.setPriceFeed([whsk.address, feed.address]);
    // 10 USDT -> expect 20 HSK; 1% slippage floor = 19.8 HSK
    await expect(buy(USDT("10"), HSK("19"))).to.be.rejectedWith("SlippageTooHigh");
    await buy(USDT("10"), HSK("19.9"));
  });

  it("rejects stale oracle prices", async () => {
    const { vault, whsk, buy } = await loadFixture(deploy);
    const feed = await hre.viem.deployContract("MockPriceFeed", [8, 50_000_000n]);
    await vault.write.setPriceFeed([whsk.address, feed.address]);
    await time.increase(2 * 60 * 60);
    await expect(buy(USDT("10"), HSK("19.9"))).to.be.rejectedWith("StaleOraclePrice");
  });

  it("requires a non-zero minAmountOut", async () => {
    const { buy } = await loadFixture(deploy);
    await expect(buy(USDT("10"), 0n)).to.be.rejectedWith("SlippageTooHigh");
  });

  it("enforces the minimum interval between entries", async () => {
    const { vault, buy, limits } = await loadFixture(deploy);
    await vault.write.setLimits([{ ...limits, minTradeInterval: 60 }]);
    await buy(USDT("5"));
    await expect(buy(USDT("5"))).to.be.rejectedWith("TradeTooSoon");
    await time.increase(61);
    await buy(USDT("5"));
  });

  it("caps the owner's slippage setting at 5%", async () => {
    const { vault, limits } = await loadFixture(deploy);
    await expect(vault.write.setLimits([{ ...limits, maxSlippageBps: 501 }])).to.be.rejectedWith("InvalidLimits");
  });

  it("emergencyClose pauses the agent and sells the position for the owner", async () => {
    const { vault, usdt, whsk, buy, swapData, asOperator } = await loadFixture(deploy);
    await buy(USDT("40"));
    await vault.write.emergencyClose([whsk.address, HSK("80"), 1n, swapData(whsk.address, usdt.address, HSK("80"))]);
    expect(await vault.read.paused()).to.equal(true);
    expect((await vault.read.positions([whsk.address]))[0]).to.equal(0n);
    await expect(asOperator.write.setPaused([false])).to.be.rejectedWith("OwnableUnauthorizedAccount");
  });

  it("does not allow the quote token or zero address to be allowlisted", async () => {
    const { vault, usdt } = await loadFixture(deploy);
    await expect(vault.write.setAllowedToken([usdt.address, true])).to.be.rejectedWith("InvalidPair");
    await expect(vault.write.setAllowedToken([zeroAddress, true])).to.be.rejectedWith("InvalidPair");
  });
});

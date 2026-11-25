// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Minimal Chainlink-style price feed interface (AggregatorV3Interface subset).
interface IPriceFeed {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title KairoxVault
/// @notice Non-custodial trading vault for the Kairox AI agent on HashKey Chain.
///
///         The owner deposits funds and can always withdraw. The AI agent's wallet is only an
///         *operator*: it can trade through one owner-approved DEX router, but it can never
///         withdraw, and every trade has to pass the guardrails below, enforced on-chain:
///
///         - pause / kill-switch (owner only)
///         - token allowlist (quote token <-> allowlisted base tokens only)
///         - max quote spent per trade
///         - max open exposure (total cost basis of open positions)
///         - daily realized loss limit -> new entries halt for the rest of the UTC day
///         - minimum seconds between entries
///         - minimum amount out on every swap, checked against an optional price feed
///
///         Swaps are router-agnostic: the operator passes raw router calldata (V2 or V3), and the
///         vault verifies the *result* by measuring balance changes. If the router sends the output
///         anywhere except this vault, or returns less than `minAmountOut`, the whole trade reverts.
///
///         Even if the agent's key or the off-chain server is compromised, losses are bounded by
///         the limits the owner set here.
contract KairoxVault is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct Limits {
        uint256 maxTradeQuote; // max quote tokens spent per entry
        uint256 maxOpenExposureQuote; // max total cost basis across open positions
        uint256 dailyLossLimitQuote; // net realized loss per UTC day before entries halt
        uint16 maxSlippageBps; // vs. price feed, when a feed is configured (<= 500)
        uint32 minTradeInterval; // seconds between entries
    }

    struct TradeParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        bytes routerCalldata;
        bytes32 reasonHash; // keccak256 of the agent's decision record (decision journal)
        uint16 signalScoreBps; // signal strength 0..10000 at decision time
    }

    struct Position {
        uint256 size; // base tokens acquired by the agent and still held
        uint256 costBasis; // quote tokens paid for `size`
    }

    // ---------------------------------------------------------------------
    // Constants & storage
    // ---------------------------------------------------------------------

    uint16 public constant MAX_SLIPPAGE_CAP_BPS = 500; // 5% hard ceiling the owner cannot exceed
    uint16 private constant BPS = 10_000;

    IERC20 public immutable quoteToken;
    uint8 public immutable quoteDecimals;

    address public router;
    address public operator;
    bool public paused;

    Limits public limits;
    uint256 public maxOracleAge = 1 hours;

    mapping(address => bool) public isAllowedToken;
    mapping(address => uint8) public tokenDecimals;
    mapping(address => address) public priceFeed; // base token => feed quoting 1 base in quote units
    mapping(address => Position) public positions;

    uint256 public openExposure;
    uint256 public currentDay;
    int256 public dailyRealizedPnl;
    uint256 public lastEntryAt;
    uint256 public tradeCount;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Deposited(address indexed token, uint256 amount);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);
    event OperatorSet(address indexed operator);
    event RouterSet(address indexed router);
    event LimitsUpdated(Limits limits);
    event TokenAllowed(address indexed token, bool allowed);
    event PriceFeedSet(address indexed token, address indexed feed);
    event MaxOracleAgeSet(uint256 maxOracleAge);
    event PausedSet(bool paused);
    event TradeExecuted(
        uint256 indexed id,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        int256 realizedPnlQuote,
        bytes32 reasonHash,
        uint16 signalScoreBps
    );
    event DailyLossLimitHit(uint256 indexed day, int256 dailyRealizedPnl);
    event EmergencyClosed(address indexed token, uint256 amountIn, uint256 amountOut);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotOperator();
    error VaultPaused();
    error TokenNotAllowed(address token);
    error InvalidPair();
    error TradeTooLarge(uint256 amountIn, uint256 max);
    error ExposureTooHigh(uint256 exposureAfter, uint256 max);
    error DailyLossLimitReached(int256 dailyRealizedPnl);
    error TradeTooSoon(uint256 nextAllowedAt);
    error SlippageTooHigh(uint256 minAmountOut, uint256 floor);
    error InsufficientOutput(uint256 received, uint256 minAmountOut);
    error OverSpent(uint256 spent, uint256 amountIn);
    error BadOraclePrice();
    error StaleOraclePrice(uint256 updatedAt);
    error InvalidLimits();
    error ZeroAddress();
    error ZeroAmount();

    // ---------------------------------------------------------------------
    // Construction & admin
    // ---------------------------------------------------------------------

    constructor(address owner_, address quoteToken_, address router_, address operator_, Limits memory limits_)
        Ownable(owner_)
    {
        if (quoteToken_ == address(0) || router_ == address(0)) revert ZeroAddress();
        quoteToken = IERC20(quoteToken_);
        quoteDecimals = IERC20Metadata(quoteToken_).decimals();
        router = router_;
        operator = operator_;
        _setLimits(limits_);
        currentDay = block.timestamp / 1 days;
        emit RouterSet(router_);
        emit OperatorSet(operator_);
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
        emit OperatorSet(operator_);
    }

    function setRouter(address router_) external onlyOwner {
        if (router_ == address(0)) revert ZeroAddress();
        router = router_;
        emit RouterSet(router_);
    }

    function setLimits(Limits calldata limits_) external onlyOwner {
        _setLimits(limits_);
    }

    function setAllowedToken(address token, bool allowed) external onlyOwner {
        if (token == address(0) || token == address(quoteToken)) revert InvalidPair();
        isAllowedToken[token] = allowed;
        if (allowed) tokenDecimals[token] = IERC20Metadata(token).decimals();
        emit TokenAllowed(token, allowed);
    }

    function setPriceFeed(address token, address feed) external onlyOwner {
        priceFeed[token] = feed;
        emit PriceFeedSet(token, feed);
    }

    function setMaxOracleAge(uint256 maxAge) external onlyOwner {
        maxOracleAge = maxAge;
        emit MaxOracleAgeSet(maxAge);
    }

    /// @notice Kill-switch. While paused the operator cannot trade at all.
    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function deposit(address token, uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(token, amount);
    }

    /// @notice The owner can always withdraw, paused or not. Withdrawing base tokens shrinks the
    ///         tracked position pro-rata (no PnL is realized).
    function withdraw(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        Position storage pos = positions[token];
        if (pos.size > 0) {
            uint256 balance = IERC20(token).balanceOf(address(this));
            uint256 untracked = balance > pos.size ? balance - pos.size : 0;
            if (amount > untracked) {
                uint256 fromPosition = amount - untracked;
                if (fromPosition > pos.size) fromPosition = pos.size;
                uint256 basisOut = (pos.costBasis * fromPosition) / pos.size;
                pos.size -= fromPosition;
                pos.costBasis -= basisOut;
                openExposure -= basisOut;
            }
        }
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, amount, to);
    }

    // ---------------------------------------------------------------------
    // Trading
    // ---------------------------------------------------------------------

    /// @notice Agent entry point. Buys (quote -> base) pass every guardrail; sells (base -> quote)
    ///         are exits and are always allowed while unpaused, even after the daily loss limit.
    function executeTrade(TradeParams calldata p) external onlyOperator nonReentrant returns (uint256 amountOut) {
        if (paused) revert VaultPaused();
        _rollDay();

        bool isBuy = p.tokenIn == address(quoteToken);
        if (isBuy) {
            if (!isAllowedToken[p.tokenOut]) revert TokenNotAllowed(p.tokenOut);
            _checkEntry(p.amountIn);
        } else {
            if (p.tokenOut != address(quoteToken)) revert InvalidPair();
            if (!isAllowedToken[p.tokenIn]) revert TokenNotAllowed(p.tokenIn);
        }
        _checkSlippage(isBuy, isBuy ? p.tokenOut : p.tokenIn, p.amountIn, p.minAmountOut);

        uint256 spent;
        (spent, amountOut) = _swap(p.tokenIn, p.tokenOut, p.amountIn, p.minAmountOut, p.routerCalldata);

        int256 realized;
        if (isBuy) {
            Position storage pos = positions[p.tokenOut];
            pos.size += amountOut;
            pos.costBasis += spent;
            openExposure += spent;
            lastEntryAt = block.timestamp;
        } else {
            realized = _realize(p.tokenIn, spent, amountOut);
        }

        unchecked {
            tradeCount++;
        }
        emit TradeExecuted(tradeCount, p.tokenIn, p.tokenOut, spent, amountOut, realized, p.reasonHash, p.signalScoreBps);
    }

    /// @notice Owner-only emergency exit: pauses the agent and sells a base token back to quote.
    function emergencyClose(address token, uint256 amountIn, uint256 minAmountOut, bytes calldata routerCalldata)
        external
        onlyOwner
        nonReentrant
        returns (uint256 amountOut)
    {
        if (!paused) {
            paused = true;
            emit PausedSet(true);
        }
        if (token == address(quoteToken)) revert InvalidPair();
        _rollDay();
        uint256 spent;
        (spent, amountOut) = _swap(token, address(quoteToken), amountIn, minAmountOut, routerCalldata);
        _realize(token, spent, amountOut);
        emit EmergencyClosed(token, spent, amountOut);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function isLossHalted() public view returns (bool) {
        if (block.timestamp / 1 days != currentDay) return false;
        return dailyRealizedPnl <= -int256(limits.dailyLossLimitQuote);
    }

    function status()
        external
        view
        returns (
            bool paused_,
            bool lossHalted_,
            int256 dailyRealizedPnl_,
            uint256 openExposure_,
            uint256 tradeCount_,
            uint256 quoteBalance_
        )
    {
        int256 pnl = block.timestamp / 1 days == currentDay ? dailyRealizedPnl : int256(0);
        return (paused, isLossHalted(), pnl, openExposure, tradeCount, quoteToken.balanceOf(address(this)));
    }

    function getLimits() external view returns (Limits memory) {
        return limits;
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _setLimits(Limits memory l) internal {
        if (l.maxSlippageBps == 0 || l.maxSlippageBps > MAX_SLIPPAGE_CAP_BPS) revert InvalidLimits();
        if (l.maxTradeQuote == 0 || l.maxOpenExposureQuote < l.maxTradeQuote) revert InvalidLimits();
        if (l.dailyLossLimitQuote == 0) revert InvalidLimits();
        limits = l;
        emit LimitsUpdated(l);
    }

    function _rollDay() internal {
        uint256 day = block.timestamp / 1 days;
        if (day != currentDay) {
            currentDay = day;
            dailyRealizedPnl = 0;
        }
    }

    function _checkEntry(uint256 amountIn) internal view {
        Limits memory l = limits;
        if (amountIn == 0) revert ZeroAmount();
        if (amountIn > l.maxTradeQuote) revert TradeTooLarge(amountIn, l.maxTradeQuote);
        if (openExposure + amountIn > l.maxOpenExposureQuote) {
            revert ExposureTooHigh(openExposure + amountIn, l.maxOpenExposureQuote);
        }
        if (dailyRealizedPnl <= -int256(l.dailyLossLimitQuote)) revert DailyLossLimitReached(dailyRealizedPnl);
        if (lastEntryAt != 0 && block.timestamp < lastEntryAt + l.minTradeInterval) {
            revert TradeTooSoon(lastEntryAt + l.minTradeInterval);
        }
    }

    /// @dev When a price feed exists for the base token, `minAmountOut` must be within
    ///      `maxSlippageBps` of the oracle-implied output. Without a feed only a non-zero minimum
    ///      is required (the off-chain engine still quotes and caps slippage before submitting).
    function _checkSlippage(bool isBuy, address base, uint256 amountIn, uint256 minAmountOut) internal view {
        if (minAmountOut == 0) revert SlippageTooHigh(0, 1);
        address feed = priceFeed[base];
        if (feed == address(0)) return;

        (, int256 answer,, uint256 updatedAt,) = IPriceFeed(feed).latestRoundData();
        if (answer <= 0) revert BadOraclePrice();
        if (block.timestamp > updatedAt + maxOracleAge) revert StaleOraclePrice(updatedAt);

        uint256 price = uint256(answer);
        uint256 feedScale = 10 ** IPriceFeed(feed).decimals();
        uint256 baseScale = 10 ** tokenDecimals[base];
        uint256 quoteScale = 10 ** quoteDecimals;

        uint256 expected = isBuy
            ? (amountIn * feedScale * baseScale) / (price * quoteScale)
            : (amountIn * price * quoteScale) / (feedScale * baseScale);
        uint256 floor = (expected * (BPS - limits.maxSlippageBps)) / BPS;
        if (minAmountOut < floor) revert SlippageTooHigh(minAmountOut, floor);
    }

    function _swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes calldata data)
        internal
        returns (uint256 spent, uint256 received)
    {
        if (amountIn == 0) revert ZeroAmount();
        IERC20 inToken = IERC20(tokenIn);
        IERC20 outToken = IERC20(tokenOut);
        uint256 inBefore = inToken.balanceOf(address(this));
        uint256 outBefore = outToken.balanceOf(address(this));

        inToken.forceApprove(router, amountIn);
        (bool ok, bytes memory ret) = router.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        inToken.forceApprove(router, 0);

        uint256 inAfter = inToken.balanceOf(address(this));
        uint256 outAfter = outToken.balanceOf(address(this));
        spent = inBefore > inAfter ? inBefore - inAfter : 0;
        received = outAfter > outBefore ? outAfter - outBefore : 0;
        if (spent > amountIn) revert OverSpent(spent, amountIn);
        if (received < minAmountOut || received == 0) revert InsufficientOutput(received, minAmountOut);
    }

    /// @dev Realizes PnL on the tracked part of a sell. Tokens the owner deposited directly (not
    ///      bought by the agent) have no cost basis and do not count toward PnL.
    function _realize(address base, uint256 spent, uint256 received) internal returns (int256 realized) {
        Position storage pos = positions[base];
        if (pos.size == 0 || spent == 0) return 0;
        uint256 tracked = spent > pos.size ? pos.size : spent;
        uint256 basisOut = (pos.costBasis * tracked) / pos.size;
        uint256 proceeds = (received * tracked) / spent;
        pos.size -= tracked;
        pos.costBasis -= basisOut;
        openExposure -= basisOut;

        realized = int256(proceeds) - int256(basisOut);
        bool wasHalted = dailyRealizedPnl <= -int256(limits.dailyLossLimitQuote);
        dailyRealizedPnl += realized;
        if (!wasHalted && dailyRealizedPnl <= -int256(limits.dailyLossLimitQuote)) {
            emit DailyLossLimitHit(currentDay, dailyRealizedPnl);
        }
    }
}

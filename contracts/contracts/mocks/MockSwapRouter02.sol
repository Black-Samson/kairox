// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockSwapRouter02 — TEST-ONLY, never deploy to mainnet
/// @notice Stand-in for Uniswap/HSKSwap SwapRouter02 on HashKey testnet (chainId 133), where HSKSwap
///         may not exist. It speaks exactly the `exactInputSingle` interface the Kairox app encodes
///         (`swapRouter02Abi` in src/lib/chain/abis.ts: the SwapRouter02 struct, no deadline).
///
///         There is no pool and no price impact: it pays `amountIn * num / den` of `tokenOut` from its
///         own pre-funded balance to `recipient`, at a rate the owner sets per direction. `fee` and
///         `sqrtPriceLimitX96` are accepted and ignored. MockQuoterV2 quotes from the same rates.
contract MockSwapRouter02 is Ownable {
    using SafeERC20 for IERC20;

    /// @notice Marker so scripts and tests can check they are talking to a mock.
    bool public constant TEST_ONLY = true;

    /// @dev Field order must match SwapRouter02 (IV3SwapRouter.ExactInputSingleParams).
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct Rate {
        uint256 num;
        uint256 den;
    }

    /// @notice tokenIn => tokenOut => rate, in raw token units (decimals included).
    mapping(address => mapping(address => Rate)) public rates;

    event RateSet(address indexed tokenIn, address indexed tokenOut, uint256 num, uint256 den);
    event Swap(address indexed tokenIn, address indexed tokenOut, address indexed recipient, uint256 amountIn, uint256 amountOut);

    error RateNotSet(address tokenIn, address tokenOut);
    error InvalidRate();
    error NativeNotSupported();
    error TooLittleReceived(uint256 amountOut, uint256 amountOutMinimum);

    constructor() Ownable(msg.sender) {}

    /// @notice Raw-unit rate: `amountOut = amountIn * num / den`. Example for 1 HSK = 0.08 USDT with
    ///         USDT(6) -> WHSK(18): num = 1e12 * 100, den = 8.
    function setRate(address tokenIn, address tokenOut, uint256 num, uint256 den) external onlyOwner {
        if (num == 0 || den == 0) revert InvalidRate();
        rates[tokenIn][tokenOut] = Rate(num, den);
        emit RateSet(tokenIn, tokenOut, num, den);
    }

    /// @notice What `exactInputSingle` would pay for `amountIn`. Reverts if no rate is set.
    function getAmountOut(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256) {
        Rate memory r = rates[tokenIn][tokenOut];
        if (r.den == 0) revert RateNotSet(tokenIn, tokenOut);
        return (amountIn * r.num) / r.den;
    }

    /// @notice Pulls `amountIn` of `tokenIn` from the caller (needs an allowance) and sends the output
    ///         to `params.recipient`.
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut) {
        if (msg.value != 0) revert NativeNotSupported();
        amountOut = getAmountOut(params.tokenIn, params.tokenOut, params.amountIn);
        if (amountOut < params.amountOutMinimum) revert TooLittleReceived(amountOut, params.amountOutMinimum);
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);
        emit Swap(params.tokenIn, params.tokenOut, params.recipient, params.amountIn, amountOut);
    }

    /// @notice Owner can take the router's liquidity back.
    function withdraw(address token, uint256 amount, address to) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}

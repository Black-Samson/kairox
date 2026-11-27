// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockSwapRouter02} from "./MockSwapRouter02.sol";

/// @title MockQuoterV2 — TEST-ONLY, never deploy to mainnet
/// @notice Stand-in for Uniswap/HSKSwap QuoterV2 on HashKey testnet. Matches `quoterV2Abi` in
///         src/lib/chain/abis.ts and quotes from MockSwapRouter02's rates, so a quote always equals
///         what the router then pays. Declared `view` (the real QuoterV2 is non-view and reverts
///         internally); the app reads it with eth_call either way.
///         `sqrtPriceX96After`, `initializedTicksCrossed` and `gasEstimate` are always 0.
contract MockQuoterV2 {
    /// @notice Marker so scripts and tests can check they are talking to a mock.
    bool public constant TEST_ONLY = true;

    /// @dev Field order must match QuoterV2 (IQuoterV2.QuoteExactInputSingleParams).
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    MockSwapRouter02 public immutable router;

    constructor(MockSwapRouter02 router_) {
        router = router_;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams calldata params)
        external
        view
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)
    {
        amountOut = router.getAmountOut(params.tokenIn, params.tokenOut, params.amountIn);
        return (amountOut, 0, 0, 0);
    }
}

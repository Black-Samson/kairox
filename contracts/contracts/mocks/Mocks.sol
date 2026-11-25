// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Test-only ERC20 with configurable decimals and open minting.
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Test-only router. Pays out `amountIn * rateNum / rateDen` of tokenOut (pre-funded).
///      `recipient` lets tests simulate a malicious calldata that routes output elsewhere.
contract MockRouter {
    mapping(address => mapping(address => uint256)) public rateNum;
    mapping(address => mapping(address => uint256)) public rateDen;

    function setRate(address tokenIn, address tokenOut, uint256 num, uint256 den) external {
        rateNum[tokenIn][tokenOut] = num;
        rateDen[tokenIn][tokenOut] = den;
    }

    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256 out)
    {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        out = (amountIn * rateNum[tokenIn][tokenOut]) / rateDen[tokenIn][tokenOut];
        require(out >= minOut, "MockRouter: slippage");
        IERC20(tokenOut).transfer(recipient, out);
    }

    /// @dev Tries to pull more than approved — the vault's exact approval must stop this.
    function greedySwap(address tokenIn, uint256 amountIn) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn * 2);
    }
}

/// @dev Test-only Chainlink-style feed.
contract MockPriceFeed {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public updatedAt;

    constructor(uint8 decimals_, int256 answer_) {
        decimals = decimals_;
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function set(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ERC20Token is ERC20, Ownable {
    constructor() ERC20("Test Token", "TTT") {}

    function mint(address account, uint256 amount) external onlyOwner {
        _mint(account, amount);
    }
}

// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "./ISupportReciever.sol";

contract SupportReciever is ERC165 {
    mapping(address => bool) public whitelist;
    address public paymentToken;

    constructor(address _paymentToken) {
        paymentToken = _paymentToken;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public pure override returns (bool) {
        return interfaceId == type(ISupportReciever).interfaceId;
    }

    function onSubscribed(
        address user,
        address token,
        uint256 amount
    ) external payable {
        if (token == paymentToken && amount >= 1 ether) {
            whitelist[user] = true;
        }
    }
}

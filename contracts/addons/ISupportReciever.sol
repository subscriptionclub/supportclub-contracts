// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

interface ISupportReciever {
    function onSubscribed(
        address user,
        address token,
        uint256 currentAmount
    ) external payable;

    function onRenewed(address user) external payable;

    function onUnsubscribed(address user) external payable;
}

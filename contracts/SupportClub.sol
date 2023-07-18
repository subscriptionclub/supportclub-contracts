// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import "./NextDate.sol";
import "./erc20/SafeERC20.sol";

import "./addons/ISupportReciever.sol";

contract SupportClub is Ownable, NextDate {
    using ERC165Checker for address;
    using SafeERC20 for IERC20;

    struct Subscription {
        uint128 id;
        uint32 amount;
        uint8 amountDecimals;
        uint16 tokenIndex;
        uint8 lastRenewRound;
        uint8 subscriptionRound;
    }
    struct RenewRound {
        uint32 startsAt;
        uint8 id;
    }
    struct PaymentToken {
        address address_;
        uint16 minAmount;
        uint8 minAmountDecimals;
    }
    struct ClubData {
        uint128 nextSubscriptionId;
        uint96 id;
        bool refundForbidden;
        bool isSupportReciever;
    }

    mapping(address => mapping(address => Subscription)) public subscriptionTo;
    mapping(address => mapping(uint128 => address)) public subscriberOf;
    mapping(address => uint128[]) public userSubscriptions;

    mapping(address => bool) public refundForbidden;

    PaymentToken[10_000] public paymentTokens;
    uint256 public totalPaymentTokens;
    RenewRound public renewRound;
    address[] public clubOwners;
    mapping(address => ClubData) public clubs;

    uint256 constant MAX_REFUND_FEE = 1500;
    bool public immutable storeExtraData;

    error SubscriptionNotExpired();
    error InvalidParams();
    error Forbidden();
    error NotSubscribed();
    event Subscribed(address indexed clubOwner, address indexed user);
    event SubscriptionsRenewed(
        address indexed clubOwner,
        uint256 indexed subscriptionsCount
    );
    event SubscriptionBurned(address indexed clubOwner, address indexed user);

    constructor(bool _storeExtraData) {
        storeExtraData = _storeExtraData;
        getActualRound();
        clubOwners.push(address(0));
    }

    function totalClubs() external view returns (uint256) {
        return clubOwners.length - 1;
    }

    function userSubscriptionsCount(
        address user
    ) external view returns (uint256) {
        return userSubscriptions[user].length;
    }

    function subscriptionsCount(
        address clubOwner
    ) external view returns (uint256) {
        uint256 nextId = clubs[clubOwner].nextSubscriptionId;

        if (nextId == 0) return 0;
        return nextId - 1;
    }

    function initClub(address clubOwner) external {
        require(clubs[clubOwner].id == 0, "Already initialized");
        _initClub(clubOwner);
    }

    function subscribe(
        address clubOwner,
        uint16 tokenIndex,
        uint32 amount,
        uint8 amountDecimals,
        uint256 currentAmount
    ) external payable {
        if (
            subscriptionTo[clubOwner][msg.sender].amount != 0 ||
            msg.sender == clubOwner
        ) revert Forbidden();

        RenewRound memory _renewRound = getActualRound();
        unchecked {
            if (clubs[clubOwner].nextSubscriptionId == 0) {
                _initClub(clubOwner);
            }

            uint128 subId;
            if (storeExtraData) {
                subId = clubs[clubOwner].nextSubscriptionId++;

                subscriberOf[clubOwner][subId] = msg.sender;
                userSubscriptions[msg.sender].push(clubs[clubOwner].id);
            }
            subscriptionTo[clubOwner][msg.sender] = Subscription({
                id: subId,
                amount: amount,
                amountDecimals: amountDecimals,
                tokenIndex: tokenIndex,
                lastRenewRound: 0,
                subscriptionRound: _renewRound.id
            });
        }

        PaymentToken memory paymentToken = paymentTokens[tokenIndex];

        uint256 totalAmount = amount * (10 ** amountDecimals);
        uint256 minAmount = paymentToken.minAmount *
            (10 ** paymentToken.minAmountDecimals);

        if (
            totalAmount < minAmount ||
            currentAmount < minAmount ||
            currentAmount > totalAmount
        ) revert InvalidParams();

        IERC20(paymentToken.address_).safeTransferFrom(
            msg.sender,
            clubOwner,
            currentAmount
        );

        if (clubs[clubOwner].isSupportReciever) {
            ISupportReciever(clubOwner).onSubscribed{value: msg.value}(
                msg.sender,
                paymentToken.address_,
                currentAmount
            );
        }

        emit Subscribed(clubOwner, msg.sender);
    }

    function addPaymentTokens(
        PaymentToken[] calldata erc20Tokens
    ) external payable onlyOwner {
        for (uint256 i = totalPaymentTokens; i < erc20Tokens.length; ++i) {
            PaymentToken calldata erc20Token = erc20Tokens[i];

            paymentTokens[i] = (
                PaymentToken({
                    address_: erc20Token.address_,
                    minAmount: erc20Token.minAmount,
                    minAmountDecimals: erc20Token.minAmountDecimals
                })
            );
        }
        totalPaymentTokens += erc20Tokens.length;
    }

    function setMinAmounts(
        uint256[] calldata indexes,
        PaymentToken[] calldata erc20Tokens
    ) external payable onlyOwner {
        uint256 totalPaymentTokens_ = totalPaymentTokens;
        for (uint256 i; i < erc20Tokens.length; ++i) {
            uint256 index = indexes[i];
            require(index < totalPaymentTokens_, "Invalid index");
            PaymentToken calldata erc20Token = erc20Tokens[i];

            paymentTokens[index].minAmount = erc20Token.minAmount;
            paymentTokens[index].minAmountDecimals = erc20Token
                .minAmountDecimals;
        }
    }

    function getActualRound() public returns (RenewRound memory) {
        RenewRound memory renewRound_ = renewRound;
        if (renewRound_.startsAt < block.timestamp) {
            uint32 nextRoundStartsAt = uint32(
                getStartOfNextMonth(block.timestamp)
            ); // create new round

            renewRound_.id += renewRound_.startsAt != 0
                ? uint8((nextRoundStartsAt - renewRound_.startsAt) / 28 days)
                : 1;
            renewRound_.startsAt = nextRoundStartsAt;

            renewRound = renewRound_;

            return renewRound_;
        }
        return renewRound_;
    }

    function burnSubscription(
        address clubOwner,
        uint256 userSubscriptionIndex
    ) external {
        address user = msg.sender;

        Subscription memory subscription = subscriptionTo[clubOwner][user];
        if (subscription.amount == 0) revert NotSubscribed();

        if (storeExtraData) {
            if (
                userSubscriptions[user][userSubscriptionIndex] !=
                clubs[clubOwner].id
            ) revert InvalidParams();

            uint128 subscriptionId_ = subscription.id;

            uint128 lastSubscriptionId = clubs[clubOwner].nextSubscriptionId -
                1;
            if (subscriptionId_ != lastSubscriptionId) {
                address lastSubscriptionUser = subscriberOf[clubOwner][
                    lastSubscriptionId
                ];

                subscriptionTo[clubOwner][lastSubscriptionUser]
                    .id = subscriptionId_;

                subscriberOf[clubOwner][subscriptionId_] = lastSubscriptionUser;
            }

            delete subscriberOf[clubOwner][lastSubscriptionId];

            uint256 lastUserSubscriptionIndex = userSubscriptions[user].length -
                1;
            userSubscriptions[user][userSubscriptionIndex] = userSubscriptions[
                user
            ][lastUserSubscriptionIndex];
            userSubscriptions[user].pop();

            clubs[clubOwner].nextSubscriptionId--;
        }
        delete subscriptionTo[clubOwner][user];

        if (clubs[clubOwner].isSupportReciever) {
            ISupportReciever(clubOwner).onUnsubscribed(user);
        }
        emit SubscriptionBurned(clubOwner, user);
    }

    function renewClubsSubscriptions(
        address[] calldata _clubOwners,
        address[][] calldata _subscribers
    ) external {
        if (_clubOwners.length != _subscribers.length) revert Forbidden();
        uint8 renewRoundId = getActualRound().id;

        for (uint i = 0; i < _clubOwners.length; i++) {
            address clubOwner = _clubOwners[i];
            address[] calldata clubSubscribers = _subscribers[i];

            bool isSupportReciever = clubs[clubOwner].isSupportReciever;
            for (uint256 index; index < clubSubscribers.length; ++index) {
                Subscription memory subscription = subscriptionTo[clubOwner][
                    clubSubscribers[index]
                ];
                _renewSubscription(
                    subscription,
                    clubOwner,
                    clubSubscribers[index],
                    renewRoundId,
                    false
                );
                if (isSupportReciever)
                    ISupportReciever(clubOwner).onRenewed(
                        clubSubscribers[index]
                    );
            }
            emit SubscriptionsRenewed(clubOwner, clubSubscribers.length);
        }
    }

    function renewClubsSubscriptionsWRefund(
        address[] calldata _clubOwners,
        address[][] calldata _subscribers,
        uint8 tokenIndex,
        uint256 refundFeePerSub,
        address refundRecipient
    ) external onlyOwner {
        if (_clubOwners.length != _subscribers.length) revert Forbidden();
        uint8 renewRoundId = getActualRound().id;

        uint256 totalRefundAmount;

        address tokenAddress = paymentTokens[tokenIndex].address_;
        for (uint i = 0; i < _clubOwners.length; i++) {
            address clubOwner = _clubOwners[i];
            if (refundForbidden[clubOwner]) revert Forbidden();

            bool isSupportReciever = clubs[clubOwner].isSupportReciever;
            address[] calldata clubSubscribers = _subscribers[i];

            uint256 amountForClub;
            for (uint256 index; index < clubSubscribers.length; ++index) {
                Subscription memory subscription = subscriptionTo[clubOwner][
                    clubSubscribers[index]
                ];
                if (subscription.tokenIndex != tokenIndex) revert Forbidden();
                amountForClub += _renewSubscription(
                    subscription,
                    clubOwner,
                    clubSubscribers[index],
                    renewRoundId,
                    true
                );

                if (isSupportReciever)
                    ISupportReciever(clubOwner).onRenewed(
                        clubSubscribers[index]
                    );
            }

            uint256 refundFromClub = clubSubscribers.length * refundFeePerSub;
            if (refundFromClub > (amountForClub * MAX_REFUND_FEE) / DENOMINATOR)
                revert Forbidden(); // max 15% fee
            IERC20(tokenAddress).safeTransfer(
                clubOwner,
                amountForClub - refundFromClub
            );

            totalRefundAmount += refundFromClub;
        }

        IERC20(tokenAddress).safeTransfer(refundRecipient, totalRefundAmount);
    }

    function _renewSubscription(
        Subscription memory subscription,
        address clubOwner,
        address subscriber,
        uint8 renewRoundId,
        bool withRefund
    ) internal returns (uint256) {
        uint8 lastRenewRound = subscription.lastRenewRound;
        if (lastRenewRound == 0)
            lastRenewRound = subscription.subscriptionRound;
        if (lastRenewRound == renewRoundId) revert SubscriptionNotExpired();

        subscriptionTo[clubOwner][subscriber].lastRenewRound = renewRoundId;

        uint16 tokenIndex = subscription.tokenIndex;
        uint256 fullAmount = (subscription.amount *
            (renewRoundId - lastRenewRound)) *
            (10 ** subscription.amountDecimals); // (amount * non-renewed periods) * decimals
        IERC20(paymentTokens[tokenIndex].address_).safeTransferFrom(
            subscriber,
            withRefund ? address(this) : clubOwner,
            fullAmount
        );

        return fullAmount;
    }

    function _initClub(address clubOwner) internal {
        ++clubs[clubOwner].nextSubscriptionId;
        clubs[clubOwner].id = uint96(clubOwners.length);
        if (clubOwner.code.length > 0) {
            clubs[clubOwner].isSupportReciever = clubOwner
                .supportsERC165InterfaceUnchecked(
                    type(ISupportReciever).interfaceId
                );
        }
        clubOwners.push(clubOwner);
    }
}

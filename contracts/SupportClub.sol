// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import "./NextDate.sol";
import "./erc20/SafeERC20.sol";

import "./addons/ISupportReciever.sol";

/**
 * @title SupportClub
 * @dev This contract allows to sign up for monthly payments in ERC20 tokens to any address. User can subscribe in any token from `paymentTokens` array, in any amount, but not less than the minimum value `minAmount * 10**minAmountDecimals`. On the first day of each month, the sums donated to recipient (=club owner) via subscriptions become eligible for collection and renewal by {renewClubsSubscriptions} & {renewClubsSubscriptionsWRefund} methods.
 */
contract SupportClub is Ownable, NextDate {
    using ERC165Checker for address;
    using SafeERC20 for IERC20;

    /**
     * @dev `amount` & `amountDecimals` are used to reduce Subscription struct storage size,
     * total subscription amount = `amount * (10**amountDecimals)`
     */
    struct Subscription {
        uint128 idx;
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

    /**
    * @dev
     `refundForbidden` – a clubOwner can disable the renewal of club subscriptions with {renewClubsSubscriptionsWRefund} method
     `isSupportReciever` – whether the clubOwner is a SupportReciever-compatible contract
     */
    struct ClubData {
        uint128 nextSubscriptionIdx;
        uint96 id;
        bool refundForbidden;
        bool isSupportReciever;
    }

    /**
     * @dev clubOwner => (user => Subscription)
     */
    mapping(address => mapping(address => Subscription)) public subscriptionTo;
    /**
     * @dev clubOwner => (subscriberIndex => user)
     */
    mapping(address => mapping(uint128 => address)) public subscriberOf;
    /**
     * @dev user: clubId[]
     */
    mapping(address => uint128[]) public userSubscriptions;

    PaymentToken[10_000] public paymentTokens;
    uint256 public totalPaymentTokens;
    RenewRound public renewRound;
    address[] public clubOwners;
    mapping(address => ClubData) public clubs;

    uint256 constant MAX_REFUND_FEE = 1500; // 15%
    /**
     * @dev if `true` {subscribe} method will store extra data about subsciption for easy data querying;
     * `true` for all chains except Ethereum mainnet since its high gas cost for using extra storage
     */
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
    event SetIsSupportReciever(address clubOwner);
    event SetRefundForbidden(bool refundForbidden);

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
    ) external view returns (uint128) {
        uint128 nextId = clubs[clubOwner].nextSubscriptionIdx;

        if (nextId == 0) return 0;
        return nextId - 1;
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

        if (clubs[clubOwner].nextSubscriptionIdx == 0) _initClub(clubOwner);

        uint128 subIdx;
        if (storeExtraData) {
            subIdx = clubs[clubOwner].nextSubscriptionIdx++;

            subscriberOf[clubOwner][subIdx] = msg.sender;
            userSubscriptions[msg.sender].push(clubs[clubOwner].id);
        }
        subscriptionTo[clubOwner][msg.sender] = Subscription({
            idx: subIdx,
            amount: amount,
            amountDecimals: amountDecimals,
            tokenIndex: tokenIndex,
            lastRenewRound: 0,
            subscriptionRound: _renewRound.id
        });

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

    function initClub(address clubOwner) external {
        require(
            clubs[clubOwner].nextSubscriptionIdx == 0,
            "Already initialized"
        );
        _initClub(clubOwner);
    }

    function setIsSupportReciever(address clubOwner) external {
        if (clubOwner.code.length > 0) {
            clubs[clubOwner].isSupportReciever = clubOwner
                .supportsERC165InterfaceUnchecked(
                    type(ISupportReciever).interfaceId
                );

            emit SetIsSupportReciever(clubOwner);
        }
    }

    function setRefundForbidden(bool refundForbidden) external {
        clubs[msg.sender].refundForbidden = refundForbidden;

        emit SetRefundForbidden(refundForbidden);
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
        address user,
        address clubOwner,
        uint256 userSubscriptionIndex
    ) external {
        if (msg.sender != user && msg.sender != owner()) revert Forbidden();

        Subscription memory subscription = subscriptionTo[clubOwner][user];
        if (subscription.amount == 0) revert NotSubscribed();

        if (storeExtraData) {
            if (
                userSubscriptions[user][userSubscriptionIndex] !=
                clubs[clubOwner].id
            ) revert InvalidParams();

            uint128 subscriberIdx = subscription.idx;

            uint128 lastSubIdx = clubs[clubOwner].nextSubscriptionIdx - 1;
            if (subscriberIdx != lastSubIdx) {
                address lastSubscriptionUser = subscriberOf[clubOwner][
                    lastSubIdx
                ];

                subscriptionTo[clubOwner][lastSubscriptionUser]
                    .idx = subscriberIdx;

                subscriberOf[clubOwner][subscriberIdx] = lastSubscriptionUser;
            }

            delete subscriberOf[clubOwner][lastSubIdx];

            uint256 lastUserSubscriptionIndex = userSubscriptions[user].length -
                1;
            if (userSubscriptionIndex != lastUserSubscriptionIndex) {
                userSubscriptions[user][
                    userSubscriptionIndex
                ] = userSubscriptions[user][lastUserSubscriptionIndex];
            }
            userSubscriptions[user].pop();

            clubs[clubOwner].nextSubscriptionIdx--;
        }
        delete subscriptionTo[clubOwner][user];

        if (clubs[clubOwner].isSupportReciever) {
            /**
             * @dev ignore {SupportReciever.onUnsubscribed} method failing
             */
            clubOwner.call(
                abi.encodeWithSelector(
                    ISupportReciever.onUnsubscribed.selector,
                    user
                )
            );
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
                _renewSubscription(
                    clubOwner,
                    clubSubscribers[index],
                    renewRoundId
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
            if (clubs[clubOwner].refundForbidden) revert Forbidden();

            bool isSupportReciever = clubs[clubOwner].isSupportReciever;
            address[] calldata clubSubscribers = _subscribers[i];

            uint256 amountForClub;
            for (uint256 index; index < clubSubscribers.length; ++index) {
                Subscription memory subscription = subscriptionTo[clubOwner][
                    clubSubscribers[index]
                ];
                if (subscription.tokenIndex != tokenIndex)
                    revert InvalidParams();

                amountForClub += _renewSubscriptionWRefund(
                    subscription,
                    clubOwner,
                    clubSubscribers[index],
                    tokenAddress,
                    renewRoundId
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
        address clubOwner,
        address subscriber,
        uint8 renewRoundId
    ) internal {
        Subscription memory subscription = subscriptionTo[clubOwner][
            subscriber
        ];
        if (subscription.amount == 0) revert InvalidParams();

        uint8 lastRenewRound = subscription.lastRenewRound;
        if (lastRenewRound == 0)
            lastRenewRound = subscription.subscriptionRound;
        if (lastRenewRound == renewRoundId) revert SubscriptionNotExpired();

        subscriptionTo[clubOwner][subscriber].lastRenewRound = renewRoundId;

        uint16 tokenIndex = subscription.tokenIndex;

        IERC20(paymentTokens[tokenIndex].address_).safeTransferFrom(
            subscriber,
            clubOwner,
            (subscription.amount * (renewRoundId - lastRenewRound)) *
                (10 ** subscription.amountDecimals) // (amount * non-renewed periods) * decimals
        );
    }

    function _renewSubscriptionWRefund(
        Subscription memory subscription,
        address clubOwner,
        address subscriber,
        address token,
        uint8 renewRoundId
    ) internal returns (uint256) {
        if (subscription.amount == 0) revert InvalidParams();

        uint8 lastRenewRound = subscription.lastRenewRound;
        if (lastRenewRound == 0)
            lastRenewRound = subscription.subscriptionRound;
        if (lastRenewRound == renewRoundId) revert SubscriptionNotExpired();

        subscriptionTo[clubOwner][subscriber].lastRenewRound = renewRoundId;

        uint256 fullAmount = (subscription.amount *
            (renewRoundId - lastRenewRound)) *
            (10 ** subscription.amountDecimals); // (amount * non-renewed periods) * decimals
        IERC20(token).safeTransferFrom(subscriber, address(this), fullAmount);

        return fullAmount;
    }

    function _initClub(address clubOwner) internal {
        ++clubs[clubOwner].nextSubscriptionIdx;
        if (clubOwner.code.length > 0) {
            clubs[clubOwner].isSupportReciever = clubOwner
                .supportsERC165InterfaceUnchecked(
                    type(ISupportReciever).interfaceId
                );
        }
        if (storeExtraData) {
            clubs[clubOwner].id = uint96(clubOwners.length);
            clubOwners.push(clubOwner);
        }
    }
}

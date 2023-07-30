// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISupportClub {
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

    function subscriberOf(
        address clubOwner,
        uint128 id
    ) external view returns (address);

    function subscriptionTo(
        address clubOwner,
        address user
    ) external view returns (Subscription memory);

    function userSubscriptionsCount(
        address user
    ) external view returns (uint256);

    function userSubscriptions(
        address clubOwner,
        uint256 index
    ) external view returns (uint128);

    function clubOwners(uint256 index) external view returns (address);

    function renewRound() external view returns (RenewRound memory);

    function paymentTokens(
        uint256 index
    ) external view returns (PaymentToken memory);

    function subscriptionsCount(
        address clubOwner
    ) external view returns (uint128);
}

contract ClubQuery {
    ISupportClub internal _club;

    struct Subscriber {
        address user;
        bool availableForRenew;
    }

    constructor(address supportClubAddress) {
        _club = ISupportClub(supportClubAddress);
    }

    function getSubscribers(
        address clubOwner,
        uint128 from,
        uint128 to,
        bool checkRenewState
    )
        external
        view
        returns (Subscriber[] memory, ISupportClub.Subscription[] memory)
    {
        {
            uint128 subscriptionsCount = _club.subscriptionsCount(clubOwner);
            if (to == 0) to = subscriptionsCount;
            require(
                from > 0 && to >= from && to <= subscriptionsCount,
                "Invalid pagination params"
            );
        }

        ISupportClub.RenewRound memory renewRound = _club.renewRound();
        if (renewRound.startsAt < block.timestamp) renewRound.id++;

        uint256 limit = (to - from) + 1;
        Subscriber[] memory subscribers = new Subscriber[](limit);
        ISupportClub.Subscription[]
            memory subscriptions_ = new ISupportClub.Subscription[](limit);

        uint256 index;
        for (uint128 subIdx = from; subIdx <= to; subIdx++) {
            address user = _club.subscriberOf(clubOwner, subIdx);
            ISupportClub.Subscription memory sub = _club.subscriptionTo(
                clubOwner,
                user
            );

            Subscriber memory subscriber = Subscriber({
                user: user,
                availableForRenew: false
            });

            uint8 lastRenewRound = sub.lastRenewRound == 0
                ? sub.subscriptionRound
                : sub.lastRenewRound;
            if (lastRenewRound != renewRound.id && checkRenewState) {
                address tokenAddress = _club
                    .paymentTokens((sub.tokenIndex))
                    .address_;

                uint256 totalAmount = (sub.amount * 10 ** sub.amountDecimals);

                bool isAllowed = IERC20(tokenAddress).allowance(
                    user,
                    address(_club)
                ) >= totalAmount;

                bool isEnoughBalance = IERC20(tokenAddress).balanceOf(user) >=
                    totalAmount;

                bool availableForRenew = isAllowed && isEnoughBalance;

                subscriber.availableForRenew = availableForRenew;
            }
            subscribers[index] = subscriber;
            subscriptions_[index] = sub;
            index++;
        }
        return (subscribers, subscriptions_);
    }

    function getSubscribersForRenew(
        address clubOwner,
        uint128 from,
        uint128 to
    )
        external
        view
        returns (address[] memory, ISupportClub.Subscription[] memory)
    {
        require(
            from > 0 && to > from && to <= _club.subscriptionsCount(clubOwner),
            "Invalid pagination params"
        );

        ISupportClub.RenewRound memory renewRound = _club.renewRound();
        if (renewRound.startsAt < block.timestamp) renewRound.id++;

        uint256 limit = (to - from) + 1;
        address[] memory users = new address[](limit);
        ISupportClub.Subscription[]
            memory subscriptions_ = new ISupportClub.Subscription[](limit);

        uint256 index;
        for (uint128 subIdx = from; subIdx <= to; subIdx++) {
            address user = _club.subscriberOf(clubOwner, subIdx);
            ISupportClub.Subscription memory sub = _club.subscriptionTo(
                clubOwner,
                user
            );

            if (sub.lastRenewRound == renewRound.id) continue;

            address tokenAddress = _club.paymentTokens(sub.tokenIndex).address_;

            uint256 totalAmount = (sub.amount * 10 ** sub.amountDecimals);

            bool isAllowed = IERC20(tokenAddress).allowance(
                user,
                address(_club)
            ) >= totalAmount;
            bool isEnoughBalance = IERC20(tokenAddress).balanceOf(user) >=
                totalAmount;

            bool isAvailableForRenew = isAllowed && isEnoughBalance;
            if (!isAvailableForRenew) continue;

            users[index] = user;
            subscriptions_[index] = sub;
            index++;
        }
        return (users, subscriptions_);
    }

    function getUserSubscriptionsFulfilled(
        address user
    )
        external
        view
        returns (
            address[] memory,
            ISupportClub.Subscription[] memory,
            uint256[] memory
        )
    {
        uint256 userSubscriptionsCount = _club.userSubscriptionsCount(user);
        address[] memory userClubsOwners = new address[](
            userSubscriptionsCount
        );
        ISupportClub.Subscription[]
            memory subscriptions = new ISupportClub.Subscription[](
                userSubscriptionsCount
            );
        uint256[] memory subscriptionIndexes = new uint256[](
            userSubscriptionsCount
        );
        for (uint i = 0; i < userSubscriptionsCount; i++) {
            uint128 clubId = _club.userSubscriptions(user, i);
            address clubOwner = _club.clubOwners(clubId);

            userClubsOwners[i] = clubOwner;
            subscriptions[i] = _club.subscriptionTo(clubOwner, user);
            subscriptionIndexes[i] = i;
        }

        return (userClubsOwners, subscriptions, subscriptionIndexes);
    }

    function getClubPaymentTokens(
        uint16 from,
        uint16 to
    ) external view returns (ISupportClub.PaymentToken[] memory) {
        require(from > 0 && to > from, "Invalid pagination params");

        uint16 limit = (to - from) + 1;
        ISupportClub.PaymentToken[]
            memory paymentTokens = new ISupportClub.PaymentToken[](limit);

        for (uint16 index = 0; index <= limit; index++) {
            paymentTokens[index] = _club.paymentTokens(from + index);
        }

        return paymentTokens;
    }
}

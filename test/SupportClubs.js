// require("@nomicfoundation/hardhat-toolbox");
const { ethers } = require(`hardhat`);
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { parseUnits, formatEther, parseEther } = require("ethers/lib/utils");
const { jsParseDate, struct } = require(`./utils`);
const { getOutOfBoundIndex } = require("../utils");
const { Zero } = ethers.constants;

const { createRandom } = ethers.Wallet;

const SUBSCRIPTION_PRICE = 10;
const DECIMALS = 18;
const DENOMINATOR = 10_000;

const MAX_ALLOWANCE_IN_MONTHS = 12;
const USER_INIT_BALANCE = SUBSCRIPTION_PRICE * MAX_ALLOWANCE_IN_MONTHS * 1000;
const userInitBalanceWei = parseUnits(`${USER_INIT_BALANCE}`, DECIMALS);

describe("SupportClub", function () {
  async function deployFixture(storeExtraData) {
    const [owner, ...allClubOwners] = await ethers.getSigners();

    const Erc20Token = await ethers.getContractFactory("ERC20Token");

    const SupportClub = await ethers.getContractFactory("SupportClub");
    const supportClub = await SupportClub.deploy(storeExtraData);

    const ClubQuery = await ethers.getContractFactory("ClubQuery");
    const clubQuery = await ClubQuery.deploy(supportClub.address);

    const additionalsUsers = await Promise.all(
      new Array(5).fill(null).map(async () => {
        const randomUser = createRandom();
        await owner.sendTransaction({
          value: parseUnits("1", 18),
          to: randomUser.address,
        });
        return new ethers.Wallet(
          randomUser._signingKey().privateKey,
          ethers.provider
        );
      })
    );
    const users = [...additionalsUsers];
    // console.log(`users`, users.length);

    const paymentTokens = [];
    const erc20Tokens = [];

    const clubOwners = allClubOwners.slice(0, 4);

    for (let index = 0; index < users.length; index++) {
      const erc20 = await Erc20Token.deploy();

      erc20Tokens.push(erc20);
      paymentTokens.push([erc20.address, SUBSCRIPTION_PRICE, DECIMALS]);

      for (let i = 0; i < users.length; i++) {
        const user = users[i];

        await erc20.mint(user.address, userInitBalanceWei);
        await erc20
          .connect(user)
          .approve(supportClub.address, userInitBalanceWei)
          .then((tx) => tx.wait());
      }
      await erc20.mint(supportClub.address, userInitBalanceWei);
      await erc20.mint(owner.address, userInitBalanceWei);
      for (let index = 0; index < clubOwners.length; index++) {
        const clubOwner = clubOwners[index];
        await erc20.mint(clubOwner.address, userInitBalanceWei);
      }
    }

    const SupportReciever = await ethers.getContractFactory(`SupportReciever`);
    const supportReciever = await SupportReciever.deploy(
      erc20Tokens[0].address
    );

    clubOwners.unshift(supportReciever);

    await supportClub.addPaymentTokens(paymentTokens).then((tx) => tx.wait());

    return {
      supportClub,
      clubQuery,
      clubOwners,
      users,
      paymentTokens,
      erc20Tokens,
      parsedDate: jsParseDate(await currentDate(), 1),
      owner,
      supportReciever,
    };
  }

  const currentDate = async () => new Date((await time.latest()) * 1000);

  describe(`prepare seed data`, function () {
    it(`Test Tokens should be payment tokens`, async function () {
      const { supportClub, paymentTokens } = await deployFixture();

      for (let index = 0; index < paymentTokens.length; index++) {
        const token = paymentTokens[index];

        const paymentToken = await supportClub.paymentTokens(index);

        expect(paymentToken.address_).to.eq(token[0]);
        expect(paymentToken.minAmount).to.eq(token[1]);
        expect(paymentToken.minAmountDecimals).to.eq(token[2]);
      }
    });
  });

  describe(`subscribe & renew & burn`, function () {
    async function createAndCheckSubscriptions(storeExtraData = true) {
      const {
        supportClub,
        clubQuery,
        users,
        clubOwners,
        erc20Tokens,
        paymentTokens,
        owner,
      } = await deployFixture(storeExtraData);

      const date = await currentDate();
      const monthIndex = date.getUTCMonth();
      const year = date.getFullYear();

      const nextFirstDate = Date.UTC(year, monthIndex + 1, 1);

      const jsExpiration = Math.floor(nextFirstDate / 1000);

      const initRenewRound = await supportClub.renewRound();
      expect(initRenewRound.id).to.deep.eq(1);
      expect(initRenewRound.startsAt).to.eq(jsExpiration);

      const clubOwnersSubscribers = [];
      const clubTokenAmounts = [];
      for (let cIndex = 0; cIndex < clubOwners.length; cIndex++) {
        const clubOwner = clubOwners[cIndex];
        clubOwnersSubscribers.push([]);
        clubTokenAmounts.push({});

        await supportClub.getActualRound();

        await supportClub.initClub(clubOwner.address).then((tx) => tx.wait());
        expect(await supportClub.subscriptionsCount(clubOwner.address)).to.eq(
          0
        );

        await expect(
          clubQuery.getSubscribers(clubOwner.address, 1, 2, false)
        ).to.revertedWith("Invalid pagination params");

        const clubSubscriptions = [];

        let lastTokenIndex = 0;
        for (let uIndex = 0; uIndex < users.length; uIndex++) {
          const user = users[uIndex];

          const [tokenIndex, newLastIndex] = getOutOfBoundIndex(
            uIndex,
            lastTokenIndex,
            erc20Tokens.length
          );
          lastTokenIndex = newLastIndex;

          const [tokenAddress, minAmount, decimals] = paymentTokens[tokenIndex];

          const subAmount = minAmount * 2;
          const subscriptionPriceWei = parseUnits(`${subAmount}`, decimals);

          if (!clubTokenAmounts[cIndex][tokenAddress]) {
            clubTokenAmounts[cIndex][tokenAddress] = {
              users: [],
              total: Zero,
            };
          }
          const subsAmountByToken =
            clubTokenAmounts[cIndex][tokenAddress].total;

          clubTokenAmounts[cIndex][tokenAddress].total =
            subsAmountByToken.add(subscriptionPriceWei);

          clubTokenAmounts[cIndex][tokenAddress].users.push(user.address);

          const payAmount = parseUnits(`${minAmount}`, decimals).add(1);

          await expect(
            supportClub
              .connect(user)
              .subscribe(
                clubOwner.address,
                tokenIndex,
                subAmount,
                decimals,
                payAmount
              )
          ).to.changeTokenBalances(
            erc20Tokens[tokenIndex],
            [clubOwner, user],
            [payAmount, payAmount.mul(-1)]
          );

          // SupportReciever
          if (clubOwner.functions && tokenIndex === 0) {
            expect(await clubOwner.points(user.address)).to.eq(1);
          }

          clubOwnersSubscribers[cIndex].push(user.address);

          const subscription = {
            idx: uIndex + 1,
            amount: subAmount,
            amountDecimals: decimals,
            tokenIndex,
            lastRenewRound: 0,
            subscriptionRound: initRenewRound.id,
          };
          clubSubscriptions.push(subscription);

          if (storeExtraData) {
            const subscriptionTo = await supportClub.subscriptionTo(
              clubOwner.address,
              user.address
            );

            expect(struct(subscriptionTo)).to.deep.eq(subscription);

            expect(
              await supportClub.subscriptionsCount(clubOwner.address)
            ).to.eq(clubSubscriptions.length);
          }
        }

        if (storeExtraData)
          expect(
            await clubQuery
              .getSubscribers(clubOwner.address, 1, users.length, false)
              .then(([subscribers, subs]) => [
                struct(subscribers),
                struct(subs),
              ])
          ).to.deep.eq([
            clubOwnersSubscribers[cIndex].map((s) => ({
              user: s,
              availableForRenew: false,
            })),
            clubSubscriptions,
          ]);
      }

      const clubOwnersAddresses = clubOwners.map((c) => c.address);

      for (let index = 0; index < 2; index++) {
        const { nextDateTimestamp } = jsParseDate(await currentDate(), 1);
        await time.increaseTo(+nextDateTimestamp + 1);

        const { nextDateTimestamp: newNextDateTimestamp } = jsParseDate(
          await currentDate(),
          1
        );

        const prevRenewRound = await supportClub.renewRound();

        const renewTx = supportClub.renewClubsSubscriptions(
          clubOwnersAddresses,
          clubOwnersSubscribers
        );

        await expect(
          supportClub.renewClubsSubscriptions(
            clubOwnersAddresses,
            clubOwnersSubscribers
          )
        ).to.revertedWithCustomError(supportClub, `SubscriptionNotExpired`);

        for (let index = 0; index < erc20Tokens.length; index++) {
          const erc20Token = erc20Tokens[index];

          await expect(renewTx).to.changeTokenBalances(
            erc20Token,
            clubOwners,
            clubOwners.map(
              (_, cIndex) => clubTokenAmounts[cIndex][erc20Token.address].total
            )
          );
        }

        expect(struct(await supportClub.renewRound())).to.deep.eq({
          startsAt: newNextDateTimestamp,
          id: prevRenewRound.id + 1,
        });
      }

      for (let index = 0; index < 2; index++) {
        const { nextDateTimestamp } = jsParseDate(await currentDate(), 1);
        await time.increaseTo(+nextDateTimestamp + 1);

        const { nextDateTimestamp: newNextDateTimestamp } = jsParseDate(
          await currentDate(),
          1
        );

        const prevRenewRound = await supportClub.renewRound();

        for (let index = 0; index < erc20Tokens.length; index++) {
          const erc20Token = erc20Tokens[index];
          const [, minAmount, decimals] = paymentTokens[index];

          const fee = 1500;
          const refundFeePerSub = parseUnits(
            `${(minAmount * 2 * fee) / DENOMINATOR}`,
            decimals
          );
          const clubTokenSubscribers = clubOwners.map(
            (_, cIndex) => clubTokenAmounts[cIndex][erc20Token.address].users
          );
          const totalRefundFee = refundFeePerSub.mul(
            clubTokenSubscribers.flat().length
          );

          await expect(
            supportClub.renewClubsSubscriptionsWRefund(
              clubOwnersAddresses,
              clubTokenSubscribers,
              index,
              refundFeePerSub.add(1),
              owner.address
            )
          ).to.revertedWithCustomError(supportClub, `Forbidden`);

          const renewTx = supportClub.renewClubsSubscriptionsWRefund(
            clubOwnersAddresses,
            clubTokenSubscribers,
            index,
            refundFeePerSub,
            owner.address
          );

          await expect(renewTx).to.changeTokenBalances(
            erc20Token,
            [...clubOwners, owner],
            [
              ...clubOwners.map((_, cIndex) =>
                clubTokenAmounts[cIndex][erc20Token.address].total
                  .mul(DENOMINATOR - fee)
                  .div(DENOMINATOR)
              ),
              totalRefundFee,
            ]
          );
        }

        expect(struct(await supportClub.renewRound())).to.deep.eq({
          startsAt: newNextDateTimestamp,
          id: prevRenewRound.id + 1,
        });
      }

      for (let uIndex = 0; uIndex < users.length; uIndex++) {
        const user = users[uIndex];

        const [_userClubOwners, userSubs] =
          await clubQuery.getUserSubscriptionsFulfilled(user.address);
        const userClubOwners = [..._userClubOwners];

        const userSubscriptionsCount = await supportClub.userSubscriptionsCount(
          user.address
        );
        expect(userSubscriptionsCount).to.eq(userClubOwners.length);

        for (
          let userSubscriptionIndex = 0;
          userSubscriptionIndex < userClubOwners.length;

        ) {
          const userClubOwner = userClubOwners[userSubscriptionIndex];
          const userSub = userSubs[userSubscriptionIndex];

          const subscriptionTo = await supportClub.subscriptionTo(
            userClubOwner,
            user.address
          );
          expect(subscriptionTo).to.deep.eq(userSub);

          const subIndex = 0;
          const tx = await supportClub
            .connect(user)
            .burnSubscription(user.address, userClubOwner, subIndex);
          await tx.wait();

          const lastIndex = userClubOwners.length - 1;
          userClubOwners[subIndex] = userClubOwners[lastIndex];
          userClubOwners.pop();

          const newSubscriptionsCount =
            await supportClub.userSubscriptionsCount(user.address);
          expect(newSubscriptionsCount).to.eq(userClubOwners.length);
        }
      }
    }

    it(`Should create & renew subscriptions for free with ExtraData`, () =>
      createAndCheckSubscriptions());
    it(`Should create & renew subscriptions for free`, () =>
      createAndCheckSubscriptions(false));

    async function subscribeAndBurn() {
      const { supportClub, users, clubOwners } = await deployFixture(true);

      const userSubscriptions = {};
      const clubSubscriptions = {};

      const tokenIndex = 0;
      for (let uIndex = 0; uIndex < users.length; uIndex++) {
        const user = users[uIndex];

        userSubscriptions[user.address] = [];

        for (let cIndex = 0; cIndex < clubOwners.length; cIndex++) {
          const clubOwner = clubOwners[cIndex];

          if (!clubSubscriptions[clubOwner.address])
            clubSubscriptions[clubOwner.address] = [];

          const subIdx = await supportClub
            .clubs(clubOwner.address)
            .then((r) =>
              +r.nextSubscriptionIdx === 0 ? 1 : +r.nextSubscriptionIdx
            );
          await supportClub
            .connect(user)
            .subscribe(clubOwner.address, tokenIndex, 10, 18, parseEther(`10`));

          userSubscriptions[user.address].push({
            clubOwner: clubOwner.address,
            idx: subIdx,
          });
          clubSubscriptions[clubOwner.address].push({
            user: user.address,
            idx: subIdx,
          });
        }
      }

      for (let uIndex = 0; uIndex < users.length; uIndex++) {
        const deleteSubIndex = clubOwners.length - 1;

        const user = users[uIndex];

        const clubId = await supportClub.userSubscriptions(
          user.address,
          deleteSubIndex
        );
        const clubOwnerAddress = await supportClub.clubOwners(clubId);

        {
          const subscribtion = await supportClub.subscriptionTo(
            clubOwnerAddress,
            user.address
          );

          expect(struct(subscribtion)).to.deep.eq({
            idx: subscribtion.idx,
            amount: 10,
            amountDecimals: 18,
            tokenIndex: 0,
            lastRenewRound: 0,
            subscriptionRound: 1,
          });
        }

        await supportClub
          .connect(user)
          .burnSubscription(user.address, clubOwnerAddress, deleteSubIndex);

        {
          const subscribtion = await supportClub.subscriptionTo(
            clubOwnerAddress,
            user.address
          );

          expect(struct(subscribtion)).to.deep.eq({
            idx: 0,
            amount: 0,
            amountDecimals: 0,
            tokenIndex: 0,
            lastRenewRound: 0,
            subscriptionRound: 0,
          });
        }
      }
    }

    it(`Should subscribeAndBurn`, subscribeAndBurn);
  });
});

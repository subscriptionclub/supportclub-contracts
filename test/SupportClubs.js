const { ethers } = require(`hardhat`);
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { parseUnits, formatEther } = require("ethers/lib/utils");
const { jsParseDate, struct } = require(`./utils`);
const { getOutOfBoundIndex } = require("../utils");
const { AddressZero, Zero } = ethers.constants;

const { createRandom } = ethers.Wallet;

const SUBSCRIPTION_PRICE = 10;
const DECIMALS = 18;
const DENOMINATOR = 10_000;

const MAX_ALLOWANCE_IN_MONTHS = 12;
const USER_INIT_BALANCE = SUBSCRIPTION_PRICE * MAX_ALLOWANCE_IN_MONTHS;
const userInitBalanceWei = parseUnits(`${USER_INIT_BALANCE}`, DECIMALS);

describe("SupportClub", function () {
  async function deployFixture() {
    const [owner, ...allClubOwners] = await ethers.getSigners();

    const Erc20Token = await ethers.getContractFactory("ERC20Token");

    const SupportClub = await ethers.getContractFactory("SupportClub");
    const supportClub = await SupportClub.deploy(true);

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

    const clubOwners = allClubOwners.slice(0, 2);

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

  describe(`subscribe & renew`, function () {
    async function createAndCheckSubscriptions() {
      const {
        supportClub,
        clubQuery,
        users,
        clubOwners,
        erc20Tokens,
        paymentTokens,
        owner,
      } = await deployFixture();

      const date = await currentDate();
      const monthIndex = date.getUTCMonth();
      const year = date.getFullYear();

      const nextFirstDate = Date.UTC(year, monthIndex + 1, 1);

      const jsExpiration = Math.floor(nextFirstDate / 1000);

      const initRenewRound = await supportClub.renewRound();
      expect(initRenewRound.id).to.deep.eq(1);
      expect(initRenewRound.startsAt).to.eq(jsExpiration);

      const { startsAt } = initRenewRound;
      const daysTillNextMonth =
        startsAt - (await time.latest()) > 86_400
          ? Math.floor((startsAt - (await time.latest())) / 86_400)
          : 1;

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

          const [tokenAddress, price, decimals] = paymentTokens[tokenIndex];

          const subscriptionPriceWei = parseUnits(`${price}`, decimals);

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

          const totalPayAmount =
            daysTillNextMonth < 30
              ? subscriptionPriceWei.div(30).mul(daysTillNextMonth)
              : subscriptionPriceWei;
          await expect(
            supportClub
              .connect(user)
              .subscribe(clubOwner.address, tokenIndex, price, decimals)
          ).to.changeTokenBalances(
            erc20Tokens[tokenIndex],
            [clubOwner, user],
            [totalPayAmount, totalPayAmount.mul(-1)]
          );

          clubOwnersSubscribers[cIndex].push(user.address);

          const subscription = {
            id: uIndex + 1,
            amount: price,
            amountDecimals: decimals,
            tokenIndex,
            lastRenewRound: 0,
            subscriptionRound: initRenewRound.id,
          };
          clubSubscriptions.push(subscription);

          const subscriptionTo = await supportClub.subscriptionTo(
            clubOwner.address,
            user.address
          );

          expect(struct(subscriptionTo)).to.deep.eq(subscription);

          expect(await supportClub.subscriptionsCount(clubOwner.address)).to.eq(
            clubSubscriptions.length
          );
        }

        expect(
          await clubQuery
            .getSubscribers(clubOwner.address, 1, users.length, false)
            .then(([subscribers, subs]) => [struct(subscribers), struct(subs)])
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
          const [, price, decimals] = paymentTokens[index];

          const fee = 1500;
          const refundFeePerSub = parseUnits(
            `${(price * fee) / DENOMINATOR}`,
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
    }

    it(`Should create & renew subscriptions for free`, () =>
      createAndCheckSubscriptions());
  });
});
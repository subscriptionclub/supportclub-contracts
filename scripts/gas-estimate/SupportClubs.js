const { ethers } = require(`hardhat`);
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const {
  formatUnits,
  parseUnits,
  formatEther,
  defaultAbiCoder,
  parseEther,
} = require("ethers/lib/utils");
const { jsParseDate } = require("../../test/utils");
const { currentDate, getOutOfBoundIndex } = require("../../utils");

const { createRandom } = ethers.Wallet;

const SUBSCRIPTION_PRICE = `100`;
const DECIMALS = 18;
const subscriptionPriceWei = parseUnits(`${SUBSCRIPTION_PRICE}`, DECIMALS);
console.log(
  "subscriptionPriceWei",
  (+formatEther(subscriptionPriceWei)).toLocaleString(`en-US`, {
    style: "currency",
    currency: `USD`,
  })
);

const MAX_ALLOWANCE_IN_MONTHS = 12;

const userInitBalanceWei = parseUnits(
  `${SUBSCRIPTION_PRICE * MAX_ALLOWANCE_IN_MONTHS * 10}`,
  DECIMALS
);

const ethPriceData = { eth: 1800, gas: +formatUnits(30, "gwei") };
const bnbPriceData = { eth: 300, gas: +formatUnits(5, "gwei") };
const addGasData = (receipt) => {
  const { gasUsed } = receipt;
  return {
    gasUsed: +gasUsed,
    eth: +(ethPriceData.gas * ethPriceData.eth * gasUsed).toFixed(3),
    bnb: +(bnbPriceData.gas * bnbPriceData.eth * gasUsed).toFixed(3),
  };
};

async function main() {
  const gasAnalytics = {};
  // Contracts are deployed using the first signer/account by default
  const [owner, ...allClubOwners] = await ethers.getSigners();

  const Erc20Token = await ethers.getContractFactory("ERC20Token");

  const SupportClub = await ethers.getContractFactory("SupportClub");
  const supportClub = await SupportClub.deploy(true);

  const additionalsUsers = await Promise.all(
    new Array(10).fill(null).map(async () => {
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
  // console.log(`clubOwners`, clubOwners.length);
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
  // console.log(`erc20Tokens`, erc20Tokens.length);

  await supportClub
    .addPaymentTokens(paymentTokens)
    .then((tx) => tx.wait())
    .then(
      (rec) =>
        (gasAnalytics[`addPaymentTokens${paymentTokens.length}`] =
          addGasData(rec))
    );

  await supportClub
    .setMinAmounts(
      paymentTokens.map((_, index) => index),
      paymentTokens
    )
    .then((tx) => tx.wait())
    .then(
      (rec) =>
        (gasAnalytics[`setMinAmounts${paymentTokens.length}`] = addGasData(rec))
    );

  gasAnalytics[`subscribe`] = [];
  gasAnalytics[`initClub`] = [];

  const showTokensByClub = false;

  showTokensByClub && (gasAnalytics[`tokensByClub`] = []);
  const clubOwnersSubscribers = [];
  for (let cIndex = 0; cIndex < clubOwners.length; cIndex++) {
    const clubOwner = clubOwners[cIndex];
    clubOwnersSubscribers.push([]);
    showTokensByClub && gasAnalytics[`tokensByClub`].push([]);
    const rec = await supportClub
      .initClub(clubOwner.address)
      .then((tx) => tx.wait());
    gasAnalytics[`initClub`].push(addGasData(rec));

    let lastTokenIndex = 0;
    for (let uIndex = 0; uIndex < 5; uIndex++) {
      const user = users[uIndex];

      const [tokenIndex, newLastIndex] = getOutOfBoundIndex(
        uIndex,
        lastTokenIndex,
        erc20Tokens.length
      );
      lastTokenIndex = newLastIndex;

      const [, price, decimals] = paymentTokens[tokenIndex];
      await supportClub.getActualRound();
      await supportClub
        .connect(user)
        .subscribe(clubOwner.address, tokenIndex, price, decimals)
        .then((tx) => tx.wait())
        .then((rec) =>
          uIndex < 2 && cIndex < 5
            ? gasAnalytics[`subscribe`].push(addGasData(rec))
            : null
        );

      clubOwnersSubscribers[cIndex].push(user.address);
      showTokensByClub && gasAnalytics[`tokensByClub`][cIndex].push(tokenIndex);
    }
  }
  const clubOwnersAddresses = clubOwners.slice(0).map((c) => c.address);
  const allSubs = clubOwnersSubscribers
    .slice(0, clubOwnersAddresses.length)
    .flat().length;
  const clubSubscribers = clubOwnersSubscribers.slice(
    0,
    clubOwnersAddresses.length
  );

  console.log(
    `clubSubscribers`,
    clubSubscribers.map((a) => a.length)
  );

  console.log(gasAnalytics);

  const renewKey = `renew${clubOwnersAddresses.length}Clubs${allSubs}Subs`;
  gasAnalytics[renewKey] = [];
  for (let index = 0; index < 5; index++) {
    const { nextDateTimestamp } = jsParseDate(await currentDate(), 1);
    await time.increaseTo(+nextDateTimestamp + 1);

    await supportClub
      .renewClubsSubscriptions(clubOwnersAddresses, clubSubscribers)
      .then((tx) => tx.wait())
      .then((rec) =>
        index < 5 ? gasAnalytics[renewKey].push(addGasData(rec)) : null
      );
  }

  console.log(`all subs`, allSubs);

  const defaulTokenIndex = 0;
  const defaultToken = erc20Tokens[defaulTokenIndex];

  await defaultToken
    .connect(users[defaulTokenIndex])
    .transfer(clubOwners[0].address, subscriptionPriceWei)
    .then((tx) => tx.wait())
    .then((rec) => (gasAnalytics[`transfer`] = addGasData(rec)));

  console.log(`gasAnalytics`, gasAnalytics);

  const oneSub = Math.round(gasAnalytics[renewKey][0].gasUsed / allSubs);
  console.log(`one sub`, oneSub, oneSub / gasAnalytics[`transfer`].gasUsed);
}

main().catch(console.log);

//  1 sub renew: 58354
/**
 * 10 subs, 1 club, gas per sub:
 * 1 token = 26 350
 * 3 tokens = 28 210
 * 6 tokens = 31 000
 * 10 tokens = 34 720,1
 */

/**
 * 30 subs, 1 club, gas per sub:
 * 30 token = 32 956
 */
/**
 * 100 subs, 10 clubs, gas per sub:
 * 10 tokens = 20018
 */

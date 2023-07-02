const { ethers } = require(`hardhat`);
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const { formatUnits, parseUnits, formatEther } = require("ethers/lib/utils");
const { jsParseDate } = require("../../test/utils");
const { currentDate } = require("../../utils");

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

const ethPriceData = { eth: 1600, gas: +formatUnits(15, "gwei") };
const bnbPriceData = { eth: 300, gas: +formatUnits(5, "gwei") };
const addGasData = ({ gasUsed }) => ({
  gasUsed: +gasUsed,
  eth: +(ethPriceData.gas * ethPriceData.eth * gasUsed).toFixed(3),
  bnb: +(bnbPriceData.gas * bnbPriceData.eth * gasUsed).toFixed(3),
});

const {
  eth: { tokens: ethTokens, WETH, uniFactory },
} = require(`../../utils`);

async function main(refundRenew = false, mintNFT = false) {
  const gasAnalytics = { refundRenew, mintNFT };
  // Contracts are deployed using the first signer/account by default
  const [owner, clubOwner, user, ...allUsers] = await ethers.getSigners();

  const Erc20Token = await ethers.getContractFactory("ERC20Token");

  const SupportClub = await ethers.getContractFactory("SupportClub");
  const supportClub = await SupportClub.deploy();

  const Erc20GasOracle = await ethers.getContractFactory("Erc20GasOracle");
  const erc20GasOracle = await Erc20GasOracle.deploy(WETH, uniFactory);
  {
    // await supportClub
    //   .initClub(clubOwner.address)
    //   .then((tx) => tx.wait())
    //   .then((rec) => (gasAnalytics[`initClub`] = addGasData(rec)));

    await supportClub.setErc20GasOracle(erc20GasOracle.address);

    await owner.sendTransaction({
      to: supportClub.address,
      value: parseUnits(`1`, 18),
    });
  }

  const additionalsUsers = await Promise.all(
    new Array(0).fill(null).map(async () => {
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
  const users = [user, ...allUsers.slice(0, 5), ...additionalsUsers]; //.slice(0, 5)

  const paymentTokens = [];
  const erc20Tokens = [];

  for (let index = 0; index < ethTokens.length; index++) {
    const ethToken = ethTokens[index];
    const erc20 = Erc20Token.attach(ethToken.address);

    await owner.sendTransaction({
      to: ethToken.minter,
      value: parseUnits(`2`, 18),
    });

    const userInitBalanceWei = parseUnits(
      `${ethToken.price * MAX_ALLOWANCE_IN_MONTHS}`,
      ethToken.decimals
    );

    erc20Tokens.push(erc20);
    paymentTokens.push([erc20.address, ethToken.price, ethToken.decimals]);

    const minter = await ethers.getImpersonatedSigner(ethToken.minter);
    const minterErc20 = erc20.connect(minter);

    await erc20GasOracle.setTokenInfo(
      ethToken.address,
      ethToken.poolFee,
      ethToken.transferCost
    );

    for (let i = 0; i < users.length; i++) {
      const user = users[i];

      await minterErc20.transfer(user.address, userInitBalanceWei);
      await erc20
        .connect(user)
        .approve(supportClub.address, userInitBalanceWei)
        .then((tx) => tx.wait());
    }
    await minterErc20.transfer(supportClub.address, userInitBalanceWei);
    await minterErc20.transfer(clubOwner.address, userInitBalanceWei);
    await minterErc20.transfer(owner.address, userInitBalanceWei);
  }

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

  const defaulTokenIndex = 4;

  gasAnalytics[`subscribe`] = [];

  let tokenIndex_ = 0;
  const subscriptionsByToken = {};
  for (let index = 0; index < users.length; index++) {
    const user = users[index];

    const isOutOfBoundToken = index > ethTokens.length - 1;
    if (isOutOfBoundToken) tokenIndex_ = index % ethTokens.length;
    const tokenIndex = isOutOfBoundToken ? tokenIndex_ : index;

    const [, price, decimals] = paymentTokens[tokenIndex];

    await supportClub
      .connect(user)
      .subscribe(clubOwner.address, tokenIndex, price, decimals)
      .then((tx) => tx.wait())
      .then((rec) =>
        index < 5
          ? gasAnalytics[`subscribe`].push({
              ...addGasData(rec),
              token: ethTokens[tokenIndex].symbol,
            })
          : null
      );

    const tokenSymbol = ethTokens[tokenIndex].symbol;
    if (!subscriptionsByToken[tokenSymbol])
      subscriptionsByToken[tokenSymbol] = [];

    subscriptionsByToken[tokenSymbol].push(index + 1);
  }
  gasAnalytics.subscriptionsByToken = subscriptionsByToken;

  const ids = users.map((_, index) => index + 1);
  gasAnalytics[`renew${users.length}Subscriptions`] = [];

  for (let index = 0; index < 3; index++) {
    // if (index >= 0) continue;
    const { nextDateTimestamp } = jsParseDate(await currentDate(), 1);
    await time.increaseTo(+nextDateTimestamp + 1);

    await supportClub
      .getActualRound()
      .then((tx) => tx.wait())
      .then((rec) => (gasAnalytics[`getActualRound`] = addGasData(rec)));
    await supportClub
      .connect(clubOwner)
      .renewSubscriptions(clubOwner.address, ids)
      .then((tx) => tx.wait())
      .then((rec) =>
        index < 5
          ? gasAnalytics[`renew${users.length}Subscriptions`].push(
              addGasData(rec)
            )
          : null
      );
  }

  if (refundRenew) {
    gasAnalytics[`renewWRefund`] = {};
    for (let index = 0; index < 3; index++) {
      const { nextDateTimestamp } = jsParseDate(await currentDate(), 1);
      await time.increaseTo(+nextDateTimestamp + 1);

      await supportClub
        .getActualRound()
        .then((tx) => tx.wait())
        .then((rec) => (gasAnalytics[`getActualRound`] = addGasData(rec)));
      for (
        let tokenIndex = 0;
        tokenIndex < paymentTokens.length;
        tokenIndex++
      ) {
        const { symbol } = ethTokens[tokenIndex];

        const idsByToken = subscriptionsByToken[symbol];
        const tokenKey = symbol + `_` + idsByToken.length;
        if (!gasAnalytics[`renewWRefund`][tokenKey])
          gasAnalytics[`renewWRefund`][tokenKey] = [];

        await supportClub
          .connect(clubOwner)
          .renewWRefund(clubOwner.address, tokenIndex, idsByToken)
          .then((tx) => tx.wait())
          .then((rec) =>
            gasAnalytics[`renewWRefund`][tokenKey].push(addGasData(rec))
          );
      }
    }
  }

  const logWithdraw = false;
  if (refundRenew && logWithdraw) {
    gasAnalytics[`withdrawErc20`] = [];
    for (let index = 0; index < ethTokens.length; index++) {
      const erc20Token = ethTokens[index];

      const balance = await erc20Token.balanceOf(supportClub.address);

      await supportClub
        .withdrawErc20(clubOwner.address, erc20Token.address, balance)
        .then((tx) => tx.wait())
        .then((rec) =>
          index < 5 ? gasAnalytics[`withdrawErc20`].push(addGasData(rec)) : null
        );
    }
  }

  const defaultToken = erc20Tokens[defaulTokenIndex];
  const defaultEthToken = ethTokens[defaulTokenIndex];

  await defaultToken
    .connect(users[defaulTokenIndex])
    .transfer(
      clubOwner.address,
      parseUnits(`${defaultEthToken.price}`, defaultEthToken.decimals)
    )
    .then((tx) => tx.wait())
    .then(
      (rec) =>
        (gasAnalytics[`transfer`] = {
          ...addGasData(rec),
          token: defaultEthToken.symbol,
        })
    );

  console.log(`renewWRefund`, gasAnalytics[`renewWRefund`]);
  delete gasAnalytics[`renewWRefund`];
  console.log(`gasAnalytics`, gasAnalytics);
}
// true, true
// false, false
main(true, false).catch(console.log);

// https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=KQ3VZ7NDE9WITCH9V81K24EEIVG6YFNEIP

/*
{
  USDC: [
    { gasUsed: 149205, eth: 3.581, bnb: 0.224 },
    { gasUsed: 149205, eth: 3.581, bnb: 0.224 },
    { gasUsed: 149205, eth: 3.581, bnb: 0.224 }
  ],
  USDT: [
    { gasUsed: 120803, eth: 2.899, bnb: 0.181 },
    { gasUsed: 120803, eth: 2.899, bnb: 0.181 },
    { gasUsed: 120803, eth: 2.899, bnb: 0.181 }
  ],
  WBTC: [
    { gasUsed: 109636, eth: 2.631, bnb: 0.164 },
    { gasUsed: 109636, eth: 2.631, bnb: 0.164 },
    { gasUsed: 109636, eth: 2.631, bnb: 0.164 }
  ],
  UNI: [
    { gasUsed: 117782, eth: 2.827, bnb: 0.177 },
    { gasUsed: 117782, eth: 2.827, bnb: 0.177 },
    { gasUsed: 117782, eth: 2.827, bnb: 0.177 }
  ],
  DAI: [
    { gasUsed: 107293, eth: 2.575, bnb: 0.161 },
    { gasUsed: 107293, eth: 2.575, bnb: 0.161 },
    { gasUsed: 107293, eth: 2.575, bnb: 0.161 }
  ]
}
gasAnalytics {
  refundRenew: true,
  mintNFT: false,
  initClub: { gasUsed: 74208, eth: 1.781, bnb: 0.111 },
  addPaymentTokens5: { gasUsed: 165007, eth: 3.96, bnb: 0.248 },
  setMinAmounts5: { gasUsed: 46479, eth: 1.115, bnb: 0.07 },
  subscribe: [
    { gasUsed: 117974, eth: 2.831, bnb: 0.177, token: 'USDC' },
    { gasUsed: 112818, eth: 2.708, bnb: 0.169, token: 'USDT' },
    { gasUsed: 104464, eth: 2.507, bnb: 0.157, token: 'WBTC' },
    { gasUsed: 109428, eth: 2.626, bnb: 0.164, token: 'UNI' },
    { gasUsed: 102269, eth: 2.454, bnb: 0.153, token: 'DAI' }
  ],
  subscriptionsByToken: { USDC: [ 1, 6 ], USDT: [ 2 ], WBTC: [ 3 ], UNI: [ 4 ], DAI: [ 5 ] },
  renew6Subscriptions: [
    { gasUsed: 249809, eth: 5.995, bnb: 0.375 },
    { gasUsed: 246509, eth: 5.916, bnb: 0.37 },
    { gasUsed: 246509, eth: 5.916, bnb: 0.37 }
  ],
  getActualRound: { gasUsed: 30322, eth: 0.728, bnb: 0.045 },
  transfer: { gasUsed: 34706, eth: 0.833, bnb: 0.052, token: 'DAI' }
}
*/

/*

*/

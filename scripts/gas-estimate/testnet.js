const { ethers } = require(`hardhat`);
const { formatUnits, parseUnits, formatEther } = require("ethers/lib/utils");

const SUBSCRIPTION_PRICE = `100`;
const DECIMALS = 18;
const subscriptionPriceWei = parseUnits(`${SUBSCRIPTION_PRICE}`, DECIMALS);
const MAX_ALLOWANCE_IN_MONTHS = 12;

const userInitBalanceWei = parseUnits(
  `${SUBSCRIPTION_PRICE * MAX_ALLOWANCE_IN_MONTHS}`,
  DECIMALS
);

const supportClubAddress = "0x768ba7672f8f5131007db65fdffe715ed525a513";
const erc20TokenAddress = "0x56cbc74fb9304f19651f07eacc91da1b56b60957";
const erc20KekAddress = "0x38afebb6fee0441ff3a8dde95a046c0ed4ea73d0";
async function main() {
  const [owner, clubOwner, ...users] = await ethers.getSigners();

  const Erc20Token = await ethers.getContractFactory("ERC20Token");

  const SupportClub = await ethers.getContractFactory("SupportClub");

  const erc20Token = Erc20Token.attach(erc20TokenAddress);

  const supportClub = SupportClub.attach(supportClubAddress);

  const erc20Tokens = [erc20Token];

  console.log(
    `subscriptionsCount`,
    await supportClub.subscriptionsCount(clubOwner.address)
  );
  console.log(
    `subscriptionsCount 1`,
    await supportClub.subscriptionsCount(users[0].address)
  );

  const ids = users.map((_, index) => index + 1);
  console.log(
    `ids`,
    await erc20Token
      .connect(users[0])
      .estimateGas.transfer(clubOwner.address, parseUnits(`100`, 18))
  );
  // const tx = await supportClub.renewSubscriptions(clubOwner.address, ids);

  // console.log(`renew tx`, tx.hash);
}

main().catch(console.log);

async function mintNApprove(users, erc20Tokens) {
  for (let index = 0; index < erc20Tokens.length; index++) {
    const erc20 = erc20Tokens[index];

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      await erc20.mint(user.address, userInitBalanceWei);
      await erc20.connect(user).approve(supportClubAddress, userInitBalanceWei);
    }
    console.log(`user`, i + 1, user.address);
  }
}

async function addPaymentTokens(supportClub, erc20Tokens) {
  await supportClub
    .addPaymentTokens(
      erc20Tokens.map((erc20) => [erc20.address, SUBSCRIPTION_PRICE, DECIMALS])
    )
    .then((tx) => tx.wait());
}

async function subscribe(supportClub, clubOwner, users, erc20Tokens) {
  for (let index = 0; index < erc20Tokens.length; index++) {
    if (index === 0) continue;
    const tokenIndex = index;
    for (let i = 0; i < users.length; i++) {
      const user = users[i];

      const sub = await supportClub.subscriptionIds(
        users[0].address,
        user.address
      );
      console.log(i + 1, `sub`, +sub);
      if (!!+sub) continue;

      await supportClub
        .connect(user)
        .subscribe(users[0].address, tokenIndex, SUBSCRIPTION_PRICE, DECIMALS)
        .catch((err) => console.log(err.message));
      console.log(i + 1, `user`, tokenIndex, user.address);
    }
  }
}

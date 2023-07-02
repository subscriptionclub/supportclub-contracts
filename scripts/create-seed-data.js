const { ethers } = require(`hardhat`);
const { parseUnits, formatUnits } = require("ethers/lib/utils");

const {
  eth: { tokens: ethTokens, WETH, uniFactory },
} = require(`../utils`);

const MAX_ALLOWANCE_IN_MONTHS = 12;

async function main() {
  const [owner, clubOwner, ...allUsers] = await ethers.getSigners();

  const Erc20Token = await ethers.getContractFactory("ERC20Token");

  const SupportClub = await ethers.getContractFactory("SupportClub");
  const supportClub = await SupportClub.deploy(true);

  const ClubQuery = await ethers.getContractFactory("ClubQuery");
  const clubQuery = await ClubQuery.deploy(supportClub.address);

  {
    await owner.sendTransaction({
      to: supportClub.address,
      value: parseUnits(`1`, 18),
    });
  }

  const users = allUsers.slice(0, 4);
  // const ethToken = ethTokens[0];
  // const erc20 = Erc20Token.attach(ethToken.address);

  // const minter = await ethers.getImpersonatedSigner(ethToken.minter);
  // console.log(
  //   `erc20`,
  //   await erc20.connect(minter).transfer(users[0].address, 1),
  //   await erc20.connect(minter).balanceOf(users[0].address)
  // );

  const paymentTokens = [];
  const erc20Tokens = [];

  for (let index = 0; index < ethTokens.length; index++) {
    const ethToken = ethTokens[index];
    const erc20 = Erc20Token.attach(ethToken.address);

    await owner.sendTransaction({
      to: ethToken.minter,
      value: parseUnits(`100`, 18),
    });

    const userInitBalanceWei = parseUnits(
      `${ethToken.price * MAX_ALLOWANCE_IN_MONTHS}`,
      ethToken.decimals
    );

    erc20Tokens.push(erc20);
    paymentTokens.push([erc20.address, ethToken.price, ethToken.decimals]);

    const minter = await ethers.getImpersonatedSigner(ethToken.minter);
    const minterErc20 = erc20.connect(minter);

    console.log(`ethToken`, ethToken.symbol);
    for (let i = 0; i < users.length; i++) {
      const user = users[i];

      // console.log(`user`, user.address);
      const tx = await minterErc20.transfer(user.address, userInitBalanceWei);
      await tx.wait();

      console.log(
        `balance`,
        formatUnits(await erc20.balanceOf(user.address), ethToken.decimals),
        ethToken.symbol
      );
    }

    await minterErc20.transfer(supportClub.address, userInitBalanceWei);
    await minterErc20.transfer(clubOwner.address, userInitBalanceWei);
    await minterErc20.transfer(owner.address, userInitBalanceWei);
  }

  await supportClub.addPaymentTokens(paymentTokens).then((tx) => tx.wait());

  console.log({
    club: supportClub.address,
    clubQuery: clubQuery.address,
    // erc20GasOracle: erc20GasOracle.address,
  });
}

main();

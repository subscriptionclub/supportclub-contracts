const { ethers } = require("hardhat");

async function addTokens() {
  // We get the contract to deploy
  const contractFactory = await ethers.getContractFactory(`SupportClub`); // signer

  const contract = new ethers.Contract(
    `0xc3ef59c25bbc3cc5811bc7ec5658498c67e4d3c7`,
    contractFactory.interface,
    contractFactory.signer
  );

  // return console.log(await contract.paymentTokens(1));
  const addTx = await contract.addPaymentTokens([
    ["0x2791bca1f2de4661ed88a30c99a7a9449aa84174", 1, 6],
    ["0xc2132D05D31c914a87C6611C10748AEb04B58e8F", 1, 6],
    ["0x8f3cf7ad23cd3cadbd9735aff958023239c6a063", 1, 18],
  ]);
  console.log(`Tx hash`, addTx.hash);
  await addTx.wait();
}

addTokens();

const hre = require("hardhat");
const { ethers } = hre;

async function deploy({ name: contractName, props = "" }) {
  const parsedProps = props.length > 0 ? props.split(",") : [];
  console.log(contractName, "parsedProps", parsedProps);

  await hre.run("compile");

  // We get the contract to deploy
  const contractFactory = await ethers.getContractFactory(contractName); // signer

  const contract = await contractFactory.deploy(...parsedProps);

  console.log(`Tx hash`, contract.deployTransaction.hash);

  await contract.deployed();
  console.log(`Deployment successful! Contract Address:`, contract.address);
}

module.exports = deploy;

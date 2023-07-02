require("@nomicfoundation/hardhat-toolbox");

const ethers = require(`ethers`);

task("deploy", "Deploy contract factory")
  .addParam("name", "Contract to deploy", "PaymentToken")
  .addParam("props", "Contract arguments", "")
  .setAction(async (taskArgs) => {
    const deploy = require("./tasks/deploy");
    await deploy(taskArgs);
  });

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  defaultNetwork: "hardhat",
  solidity: {
    version: "0.8.18",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
};

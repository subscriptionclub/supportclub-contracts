const { time } = require("@nomicfoundation/hardhat-network-helpers");

function main(amountToIncrease) {
  time.increase(amountToIncrease);
}

main(86_400 * 31);

const { ethers } = require(`hardhat`);
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const { addGasData, currentDate } = require(`../../utils`);
const { jsParseDate } = require(`../../test/utils`);

async function main() {
  const gasAnalytics = [];

  const NextDate = await ethers.getContractFactory(`NextDate`);
  const nextDate = await NextDate.deploy();

  const SupportClub = await ethers.getContractFactory("SupportClub");

  const supportClub = await SupportClub.deploy();

  for (let index = 0; index < 12; index++) {
    const now = await time.latest();
    const pureCalc = await nextDate.estimateGas
      .getStartOfNextMonth(now)
      .then((res) => +res);
    // gasAnalytics.push(pureCalc);
    const { nextDateTimestamp } = jsParseDate(await currentDate(), 1);
    await time.increaseTo(+nextDateTimestamp + 1);

    await supportClub
      .getActualRound()
      .then((tx) => tx.wait())
      .then((rec) =>
        gasAnalytics.push({
          ...addGasData(rec),
          pureCalc,
          date: new Date(nextDateTimestamp * 1000).toLocaleDateString(),
        })
      );
  }

  // const avgGas =
  //   gasAnalytics.reduce((acc, current) => (acc += current), 0) /
  //   gasAnalytics.length;
  const avgGas =
    gasAnalytics.reduce((acc, current) => (acc += current.eth), 0) /
    gasAnalytics.length;
  const oldAvgGas =
    old.reduce((acc, current) => (acc += current.eth), 0) / old.length;
  console.log(
    `gasAnalytics`,
    gasAnalytics,
    {
      avgGas: +avgGas.toFixed(4),
      oldAvgGas: +oldAvgGas.toFixed(4),
      diff: +(avgGas / oldAvgGas).toFixed(4),
    } /**/
  );
}

main().catch(console.log);

const old = [
  { gasUsed: 32489, eth: 0.374, bnb: 0.049, date: "01.02.2023" },
  { gasUsed: 32849, eth: 0.378, bnb: 0.049, date: "01.03.2023" },
  { gasUsed: 33209, eth: 0.382, bnb: 0.05, date: "01.04.2023" },
  { gasUsed: 33569, eth: 0.386, bnb: 0.05, date: "01.05.2023" },
  { gasUsed: 33929, eth: 0.39, bnb: 0.051, date: "01.06.2023" },
  { gasUsed: 34289, eth: 0.394, bnb: 0.051, date: "01.07.2023" },
  { gasUsed: 34649, eth: 0.398, bnb: 0.052, date: "01.08.2023" },
  { gasUsed: 35009, eth: 0.403, bnb: 0.053, date: "01.09.2023" },
  { gasUsed: 35369, eth: 0.407, bnb: 0.053, date: "01.10.2023" },
  { gasUsed: 35729, eth: 0.411, bnb: 0.054, date: "01.11.2023" },
  { gasUsed: 36089, eth: 0.415, bnb: 0.054, date: "01.12.2023" },
  { gasUsed: 32119, eth: 0.369, bnb: 0.048, date: "01.01.2024" },
];
/*
  { avgGas: 0.3923, oldAvgGas: 0.3922, diff: 1 }
 */

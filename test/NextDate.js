const { ethers } = require(`hardhat`);
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");

const {
  parseSeconds,
  parseDays,
  jsParseDate,
  DAY_IN_SECS,
} = require(`./utils`);

describe("NextDate", function () {
  async function deployFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner] = await ethers.getSigners();

    const NextDate = await ethers.getContractFactory("NextDate");
    const nextDate = await NextDate.deploy();

    return { nextDate, owner };
  }

  describe("Parse startOfNextMonth from timestamp", function () {
    const testDate = async (dateToParse = new Date()) => {
      const { nextDate } = await loadFixture(deployFixture);

      const { nextDateTimestamp: jsNextDateTimestamp } = jsParseDate(
        dateToParse,
        1
      );

      const nextDateTimestamp = await nextDate.getStartOfNextMonth(
        parseSeconds(dateToParse)
      );

      expect(new Date(nextDateTimestamp * 1000).toDateString()).to.eq(
        new Date(jsNextDateTimestamp * 1000).toDateString(),
        dateToParse.toDateString()
      );
    };

    it(`Should return today startOfNextMonth`, async function () {
      await testDate(new Date());
    });

    it(`Should return startOfNextMonth for every 1 Jan from 2000`, async function () {
      const today = new Date();
      const currentYear = today.getUTCFullYear();

      for (let year = 2007; year <= currentYear; year++) {
        const date = new Date(`01.01.${year} UTC`);

        await testDate(date);
      }
    });

    it(`Should return startOfNextMonth for every 28 Feb from 2010`, async function () {
      const today = new Date();
      const currentYear = today.getUTCFullYear();

      for (let year = 2010; year <= currentYear; year++) {
        const date = new Date(`02.28.${year} UTC`);

        await testDate(date);
      }
    });

    const yearFrom = 2019;
    const yearTo = 2026;

    it(`Should return startOfNextMonth for every day from ${yearFrom} to ${yearTo}`, async function () {
      const daysTillFrom = parseDays(new Date(`01.01.${yearFrom} UTC`));
      const daysTillTo = parseDays(new Date(`01.01.${yearTo} UTC`));

      for (let days = daysTillFrom; days <= daysTillTo; days++) {
        const date = new Date(days * DAY_IN_SECS * 1000);

        await testDate(date);
      }
    });
  });
});

/*
[
  23321, 23703, 23703,
  23703, 23703, 23703,
  23703, 23688, 23688,
  23688, 23688, 23688
] avgGas 23664.916666666668
*/

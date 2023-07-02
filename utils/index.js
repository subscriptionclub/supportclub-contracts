const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { formatUnits, parseUnits, formatEther } = require("ethers/lib/utils");

const currentDate = async () => new Date((await time.latest()) * 1000);
const ethPriceData = { eth: 1150, gas: +formatUnits(10, "gwei") };
const bnbPriceData = { eth: 300, gas: +formatUnits(5, "gwei") };
const addGasData = ({ gasUsed }) => ({
  gasUsed: +gasUsed,
  eth: +(ethPriceData.gas * ethPriceData.eth * gasUsed).toFixed(3),
  bnb: +(bnbPriceData.gas * bnbPriceData.eth * gasUsed).toFixed(3),
});

const getOutOfBoundIndex = (current = 0, lastIndex = 0, arrLength = 1) => {
  const isOutOfBoundToken = current > arrLength - 1;
  if (isOutOfBoundToken) lastIndex = current % arrLength;
  const outOfBoudIndex = isOutOfBoundToken ? lastIndex : current;

  return [outOfBoudIndex, lastIndex];
};

const uniFactory = `0x1F98431c8aD98523631AE4a59f267346ea31F984`;
const WETH = `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`;
const ethTokens = [
  {
    address: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`,
    symbol: `USDC`,
    minter: `0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503`,
    decimals: 6,
    price: 10,
    poolFee: 3000,
    transferCost: 54000,
  },
  {
    address: `0xdAC17F958D2ee523a2206206994597C13D831ec7`,
    symbol: `USDT`,
    minter: `0x5754284f345afc66a98fbB0a0Afe71e0F007B949`,
    decimals: 6,
    price: 10,
    poolFee: 3000,
    transferCost: 54128,
  },
  {
    address: `0x6B175474E89094C44Da98b954EedeAC495271d0F`,
    symbol: `DAI`,
    minter: `0x075e72a5edf65f0a5f44699c7654c1a76941ddc8`,
    decimals: 18,
    price: 10,
    poolFee: 3000,
    transferCost: 45000,
  },
  /* 
  {
    address: `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599`,
    symbol: `WBTC`,
    minter: `0x218b95be3ed99141b0144dba6ce88807c4ad7c09`,
    decimals: 8,
    price: 1,
    poolFee: 3000,
    transferCost: 54399,
  },
  {
    address: `0x1f9840a85d5af5bf1d1762f925bdaddc4201f984`,
    symbol: `UNI`,
    minter: `0x47173B170C64d16393a52e6C480b3Ad8c302ba1e`,
    decimals: 18,
    price: 10,
    poolFee: 3000,
    transferCost: 52418,
  }, */
];

/*
0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 1 635858423
0xdac17f958d2ee523a2206206994597c13d831ec7 1 635922009
0x2260fac5e5542a773aa44fbcfedf7c193bc2c599 1 145466966101
0x1f9840a85d5af5bf1d1762f925bdaddc4201f984 1000000000 4230535
0x6b175474e89094c44da98b954eedeac495271d0f 1000000000 636050
*/

module.exports = {
  addGasData,
  currentDate,
  getOutOfBoundIndex,
  eth: {
    tokens: ethTokens,
    WETH,
    uniFactory,
  },
};

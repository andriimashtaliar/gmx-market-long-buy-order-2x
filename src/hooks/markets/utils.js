import { getByKey } from "lib/objects";
import { BigNumber } from "ethers";
import { NATIVE_TOKEN_ADDRESS } from "config/tokens";
import { convertToContractTokenPrices, convertToUsd, getMidPrice } from "../tokens";
import { PRECISION } from "lib/numbers";

export function getContractMarketPrices(tokensData, market) {
  const indexToken = getByKey(tokensData, market.indexTokenAddress);
  const longToken = getByKey(tokensData, market.longTokenAddress);
  const shortToken = getByKey(tokensData, market.shortTokenAddress);

  if (!indexToken || !longToken || !shortToken) {
    return undefined;
  }

  return {
    indexTokenPrice: convertToContractTokenPrices(indexToken.prices, indexToken.decimals),
    longTokenPrice: convertToContractTokenPrices(longToken.prices, longToken.decimals),
    shortTokenPrice: convertToContractTokenPrices(shortToken.prices, shortToken.decimals),
  };
}

export function getMarketFullName(p) {
  const { indexToken, longToken, shortToken, isSpotOnly } = p;

  return `${getMarketIndexName({ indexToken, isSpotOnly })} [${getMarketPoolName({ longToken, shortToken })}]`;
}

export function getMarketIndexName(p) {
  const { indexToken, isSpotOnly } = p;

  if (isSpotOnly) {
    return `SWAP-ONLY`;
  }

  return `${indexToken.baseSymbol || indexToken.symbol}/USD`;
}

export function getReservedUsd(marketInfo, isLong) {
  const { indexToken } = marketInfo;

  if (isLong) {
    return convertToUsd(marketInfo.longInterestInTokens, marketInfo.indexToken.decimals, indexToken.prices.maxPrice);
  } else {
    return marketInfo.shortInterestUsd;
  }
}

export function getAvailableUsdLiquidityForCollateral(marketInfo, isLong) {
  const poolUsd = getPoolUsdWithoutPnl(marketInfo, isLong, "minPrice");

  if (marketInfo.isSpotOnly) {
    return poolUsd;
  }

  const reservedUsd = getReservedUsd(marketInfo, isLong);
  const maxReserveFactor = isLong ? marketInfo.reserveFactorLong : marketInfo.reserveFactorShort;

  if (maxReserveFactor.eq(0)) {
    return BigNumber.from(0);
  }

  const minPoolUsd = reservedUsd.mul(PRECISION).div(maxReserveFactor);

  const liqudiity = poolUsd.sub(minPoolUsd);

  return liqudiity;
}

export function getPoolUsdWithoutPnl(
  marketInfo,
  isLong,
  priceType
) {
  const poolAmount = isLong ? marketInfo.longPoolAmount : marketInfo.shortPoolAmount;
  const token = isLong ? marketInfo.longToken : marketInfo.shortToken;

  let price;

  if (priceType === "minPrice") {
    price = token.prices?.minPrice;
  } else if (priceType === "maxPrice") {
    price = token.prices?.maxPrice;
  } else {
    price = getMidPrice(token.prices);
  }

  return convertToUsd(poolAmount, token.decimals, price);
}


export function getOppositeCollateral(marketInfo, tokenAddress) {
  const poolType = getTokenPoolType(marketInfo, tokenAddress);

  if (poolType === "long") {
    return marketInfo.shortToken;
  }

  if (poolType === "short") {
    return marketInfo.longToken;
  }

  return undefined;
}

export function getMarketPoolName(p) {
  const { longToken, shortToken } = p;

  if (longToken.address === shortToken.address) {
    return longToken.symbol;
  }

  return `${longToken.symbol}-${shortToken.symbol}`;
}

export function getTokenPoolType(marketInfo, tokenAddress) {
  const { longToken, shortToken } = marketInfo;

  if (tokenAddress === longToken.address || (tokenAddress === NATIVE_TOKEN_ADDRESS && longToken.isWrapped)) {
    return "long";
  }

  if (tokenAddress === shortToken.address || (tokenAddress === NATIVE_TOKEN_ADDRESS && shortToken.isWrapped)) {
    return "short";
  }

  return undefined;
}
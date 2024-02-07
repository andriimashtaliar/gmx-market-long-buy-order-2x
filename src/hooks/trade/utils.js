/* global BigInt */

import { BigNumber, ethers } from "ethers";
import { NATIVE_TOKEN_ADDRESS} from "config/tokens";
import { getChainName, getHighExecutionFee } from "config/chains";
import { getByKey } from "lib/objects";
import { convertToTokenAmount, convertToUsd, getMidPrice, getIsEquivalentTokens, getTokenData } from "hooks/tokens";
import { getTokenPoolType, getAvailableUsdLiquidityForCollateral, getOppositeCollateral } from "hooks/markets";
import { bigNumberify, expandDecimals, roundUpMagnitudeDivision, applyFactor, adjustForDecimals, getBasisPoints, PRECISION, USD_DECIMALS, BASIS_POINTS_DIVISOR } from "lib/numbers";

export function getExecutionFee(chainId, gasLimts, tokensData, estimatedGasLimit, gasPrice) {
    const nativeToken = getTokenData(tokensData, NATIVE_TOKEN_ADDRESS);
  
    if (!nativeToken) return undefined;
  
    const baseGasLimit = gasLimts.estimatedFeeBaseGasLimit;
    const multiplierFactor = gasLimts.estimatedFeeMultiplierFactor;
    const adjustedGasLimit = baseGasLimit.add(applyFactor(estimatedGasLimit, multiplierFactor));
  
    const feeTokenAmount = adjustedGasLimit.mul(gasPrice);
  
    const feeUsd = convertToUsd(feeTokenAmount, nativeToken.decimals, nativeToken.prices.minPrice);
  
    const isFeeHigh = feeUsd.gt(expandDecimals(getHighExecutionFee(chainId), USD_DECIMALS));
  
    const warning = isFeeHigh
      ? `The network Fees are very high currently, which may be due to a temporary increase in transactions on the ${getChainName(
          chainId
        )} network.`
      : undefined;
  
    return {
      feeUsd,
      feeTokenAmount,
      feeToken: nativeToken,
      warning,
    };
}

export function estimateExecuteIncreaseOrderGasLimit(
    gasLimits,
    order
  ) {
    return gasLimits.increaseOrder.add(gasLimits.singleSwap.mul(order.swapsCount || 0)).add(order.callbackGasLimit || 0);
}

export function getAmountByRatio(p) {
    const { fromToken, toToken, fromTokenAmount, ratio, shouldInvertRatio } = p;
  
    if (getIsEquivalentTokens(fromToken, toToken) || fromTokenAmount.eq(0)) {
      return p.fromTokenAmount;
    }
  
    const _ratio = shouldInvertRatio ? PRECISION.mul(PRECISION).div(ratio) : ratio;
  
    const adjustedDecimalsRatio = adjustForDecimals(_ratio, fromToken.decimals, toToken.decimals);

    return p.fromTokenAmount.mul(adjustedDecimalsRatio).div(PRECISION);
}

export function getAcceptablePriceInfo(p) {
    const { marketInfo, isIncrease, isLong, indexPrice, sizeDeltaUsd, maxNegativePriceImpactBps } = p;
    const { indexToken } = marketInfo;
  
    const values = {
      acceptablePrice: BigNumber.from(0),
      acceptablePriceDeltaBps: BigNumber.from(0),
      priceImpactDeltaAmount: BigNumber.from(0),
      priceImpactDeltaUsd: BigNumber.from(0),
      priceImpactDiffUsd: BigNumber.from(0),
    };
  
    if (!sizeDeltaUsd.gt(0) || indexPrice.eq(0)) {
      return values;
    }
  
    const shouldFlipPriceImpact = getShouldUseMaxPrice(p.isIncrease, p.isLong);
  
    // For Limit / Trigger orders
    if (maxNegativePriceImpactBps?.gt(0)) {
      let priceDelta = indexPrice.mul(maxNegativePriceImpactBps).div(BASIS_POINTS_DIVISOR);
      priceDelta = shouldFlipPriceImpact ? priceDelta?.mul(-1) : priceDelta;
  
      values.acceptablePrice = indexPrice.sub(priceDelta);
      values.acceptablePriceDeltaBps = maxNegativePriceImpactBps.mul(-1);
  
      const priceImpact = getPriceImpactByAcceptablePrice({
        sizeDeltaUsd,
        acceptablePrice: values.acceptablePrice,
        indexPrice,
        isLong,
        isIncrease,
      });
  
      values.priceImpactDeltaUsd = priceImpact.priceImpactDeltaUsd;
      values.priceImpactDeltaAmount = priceImpact.priceImpactDeltaAmount;
  
      return values;
    }
  
    values.priceImpactDeltaUsd = getCappedPositionImpactUsd(
      marketInfo,
      isIncrease ? sizeDeltaUsd : sizeDeltaUsd.mul(-1),
      isLong,
      {
        fallbackToZero: !isIncrease,
      }
    );
  
    if (!isIncrease && values.priceImpactDeltaUsd.lt(0)) {
      const minPriceImpactUsd = applyFactor(sizeDeltaUsd, marketInfo.maxPositionImpactFactorNegative).mul(-1);
  
      if (values.priceImpactDeltaUsd.lt(minPriceImpactUsd)) {
        values.priceImpactDiffUsd = minPriceImpactUsd.sub(values.priceImpactDeltaUsd);
        values.priceImpactDeltaUsd = minPriceImpactUsd;
      }
    }
  
    if (values.priceImpactDeltaUsd.gt(0)) {
      values.priceImpactDeltaAmount = convertToTokenAmount(
        values.priceImpactDeltaUsd,
        indexToken.decimals,
        indexToken.prices.maxPrice
      );
    } else {
      values.priceImpactDeltaAmount = roundUpMagnitudeDivision(
        values.priceImpactDeltaUsd.mul(expandDecimals(1, indexToken.decimals)),
        indexToken.prices.minPrice
      );
    }
  
    const acceptablePriceValues = getAcceptablePriceByPriceImpact({
      isIncrease,
      isLong,
      indexPrice,
      sizeDeltaUsd,
      priceImpactDeltaUsd: values.priceImpactDeltaUsd,
    });
  
    values.acceptablePrice = acceptablePriceValues.acceptablePrice;
    values.acceptablePriceDeltaBps = acceptablePriceValues.acceptablePriceDeltaBps;
  
    return values;
}

export function getPriceImpactByAcceptablePrice(p) {
    const { sizeDeltaUsd, acceptablePrice, indexPrice: markPrice, isLong, isIncrease } = p;
  
    const shouldFlipPriceDiff = isIncrease ? !isLong : isLong;
  
    const priceDelta = markPrice.sub(acceptablePrice).mul(shouldFlipPriceDiff ? -1 : 1);
    const acceptablePriceDeltaBps = getBasisPoints(priceDelta, p.indexPrice);
  
    const priceImpactDeltaUsd = sizeDeltaUsd.mul(priceDelta).div(acceptablePrice);
  
    const priceImpactDeltaAmount = priceImpactDeltaUsd.div(markPrice);
  
    return {
      priceImpactDeltaUsd,
      priceImpactDeltaAmount,
      priceDelta,
      acceptablePriceDeltaBps,
    };
}

export function getAcceptablePriceByPriceImpact(p) {
    const { indexPrice, sizeDeltaUsd, priceImpactDeltaUsd } = p;
  
    if (!sizeDeltaUsd.gt(0) || indexPrice.eq(0)) {
      return {
        acceptablePrice: indexPrice,
        acceptablePriceDeltaBps: BigNumber.from(0),
        priceDelta: BigNumber.from(0),
      };
    }
  
    const shouldFlipPriceImpact = getShouldUseMaxPrice(p.isIncrease, p.isLong);
  
    const priceImpactForPriceAdjustment = shouldFlipPriceImpact ? priceImpactDeltaUsd.mul(-1) : priceImpactDeltaUsd;
    const acceptablePrice = indexPrice.mul(sizeDeltaUsd.add(priceImpactForPriceAdjustment)).div(sizeDeltaUsd);
    const priceDelta = indexPrice.sub(acceptablePrice).mul(shouldFlipPriceImpact ? 1 : -1);
    const acceptablePriceDeltaBps = getBasisPoints(priceDelta, p.indexPrice);
  
    return {
      acceptablePrice,
      acceptablePriceDeltaBps,
      priceDelta,
    };
}

export function getTotalSwapVolumeFromSwapStats(swapSteps) {
    if (!swapSteps) return BigNumber.from(0);
  
    return swapSteps.reduce((acc, curr) => {
      return acc.add(curr.usdIn);
    }, BigNumber.from(0));
}

export function getPositionFee(
    marketInfo,
    sizeDeltaUsd,
    forPositiveImpact,
    referralInfo,
    uiFeeFactor
) {
    const factor = forPositiveImpact
      ? marketInfo.positionFeeFactorForPositiveImpact
      : marketInfo.positionFeeFactorForNegativeImpact;
  
    let positionFeeUsd = applyFactor(sizeDeltaUsd, factor);
    const uiFeeUsd = applyFactor(sizeDeltaUsd, uiFeeFactor || BigNumber.from(0));
  
    if (!referralInfo) {
      return { positionFeeUsd, discountUsd: BigNumber.from(0), totalRebateUsd: BigNumber.from(0) };
    }
  
    const totalRebateUsd = applyFactor(positionFeeUsd, referralInfo.totalRebateFactor);
    const discountUsd = applyFactor(totalRebateUsd, referralInfo.discountFactor);
  
    positionFeeUsd = positionFeeUsd.sub(discountUsd);
  
    return {
      positionFeeUsd,
      discountUsd,
      totalRebateUsd,
      uiFeeUsd,
    };
}
  
export function applySlippageToPrice(allowedSlippage, price, isIncrease, isLong) {
    const shouldIncreasePrice = getShouldUseMaxPrice(isIncrease, isLong);
  
    const slippageBasisPoints = shouldIncreasePrice
      ? BASIS_POINTS_DIVISOR + allowedSlippage
      : BASIS_POINTS_DIVISOR - allowedSlippage;
  
    return price.mul(slippageBasisPoints).div(BASIS_POINTS_DIVISOR);
}

export function getSwapAmountsByFromValue(p) {
    const { tokenIn, tokenOut, amountIn, triggerRatio, isLimit, findSwapPath, uiFeeFactor } = p;
  
    const priceIn = tokenIn.prices.minPrice;
    const priceOut = tokenOut.prices.maxPrice;
  
    const usdIn = convertToUsd(amountIn, tokenIn.decimals, priceIn);
  
    let amountOut = BigNumber.from(0);
    let usdOut = BigNumber.from(0);
    let minOutputAmount = BigNumber.from(0);
  
    const defaultAmounts = {
      amountIn,
      usdIn,
      amountOut,
      usdOut,
      minOutputAmount,
      priceIn,
      priceOut,
      swapPathStats: undefined,
    };
  
    if (amountIn.lte(0)) {
      return defaultAmounts;
    }
  
    if (getIsEquivalentTokens(tokenIn, tokenOut)) {
      amountOut = amountIn;
      usdOut = usdIn;
      minOutputAmount = amountOut;
  
      return {
        amountIn,
        usdIn,
        amountOut,
        usdOut,
        minOutputAmount,
        priceIn,
        priceOut,
        swapPathStats: undefined,
      };
    }
  
    const swapPathStats = findSwapPath(defaultAmounts.usdIn, { byLiquidity: isLimit });
  
    const totalSwapVolume = getTotalSwapVolumeFromSwapStats(swapPathStats?.swapSteps);
    const swapUiFeeUsd = applyFactor(totalSwapVolume, uiFeeFactor);
    const swapUiFeeAmount = convertToTokenAmount(swapUiFeeUsd, tokenOut.decimals, priceOut);
  
    if (!swapPathStats) {
      return defaultAmounts;
    }
  
    if (isLimit) {
      if (!triggerRatio) {
        return defaultAmounts;
      }
  
      amountOut = getAmountByRatio({
        fromToken: tokenIn,
        toToken: tokenOut,
        fromTokenAmount: amountIn,
        ratio: triggerRatio.ratio,
        shouldInvertRatio: triggerRatio.largestToken.address === tokenOut.address,
      });
  
      usdOut = convertToUsd(amountOut, tokenOut.decimals, priceOut);
      usdOut = usdOut
        .sub(swapPathStats.totalSwapFeeUsd)
        .sub(swapUiFeeUsd)
        .add(swapPathStats.totalSwapPriceImpactDeltaUsd);
      amountOut = convertToTokenAmount(usdOut, tokenOut.decimals, priceOut);
      minOutputAmount = amountOut;
    } else {
      usdOut = swapPathStats.usdOut.sub(swapUiFeeUsd);
      amountOut = swapPathStats.amountOut.sub(swapUiFeeAmount);
      minOutputAmount = amountOut;
    }
  
    if (amountOut.lt(0)) {
      amountOut = BigNumber.from(0);
      usdOut = BigNumber.from(0);
      minOutputAmount = BigNumber.from(0);
    }
  
    return {
      amountIn,
      usdIn,
      amountOut,
      usdOut,
      priceIn,
      priceOut,
      minOutputAmount,
      swapPathStats,
    };
}

export function getMarkPrice(p) {
    const { prices, isIncrease, isLong } = p;
  
    const shouldUseMaxPrice = getShouldUseMaxPrice(isIncrease, isLong);
  
    return shouldUseMaxPrice ? prices.maxPrice : prices.minPrice;
}

export function getShouldUseMaxPrice(isIncrease, isLong) {
    return isIncrease ? isLong : !isLong;
}

export function getCappedPositionImpactUsd(
    marketInfo,
    sizeDeltaUsd,
    isLong,
    opts = {}
) {
    const priceImpactDeltaUsd = getPriceImpactForPosition(marketInfo, sizeDeltaUsd, isLong, opts);
  
    if (priceImpactDeltaUsd.lt(0)) {
      return priceImpactDeltaUsd;
    }
  
    const { indexToken } = marketInfo;
  
    const impactPoolAmount = marketInfo?.positionImpactPoolAmount;
  
    const maxPriceImpactUsdBasedOnImpactPool = convertToUsd(
      impactPoolAmount,
      indexToken.decimals,
      indexToken.prices.minPrice
    );
  
    let cappedImpactUsd = priceImpactDeltaUsd;
  
    if (cappedImpactUsd.gt(maxPriceImpactUsdBasedOnImpactPool)) {
      cappedImpactUsd = maxPriceImpactUsdBasedOnImpactPool;
    }
  
    const maxPriceImpactFactor = marketInfo.maxPositionImpactFactorPositive;
    const maxPriceImpactUsdBasedOnMaxPriceImpactFactor = applyFactor(sizeDeltaUsd.abs(), maxPriceImpactFactor);
  
    if (cappedImpactUsd.gt(maxPriceImpactUsdBasedOnMaxPriceImpactFactor)) {
      cappedImpactUsd = maxPriceImpactUsdBasedOnMaxPriceImpactFactor;
    }
  
    return cappedImpactUsd;
}

export function getPriceImpactForPosition(
    marketInfo,
    sizeDeltaUsd,
    isLong,
    opts = {}
  ) {
    const { longInterestUsd, shortInterestUsd } = marketInfo;
  
    const { currentLongUsd, currentShortUsd, nextLongUsd, nextShortUsd } = getNextOpenInterestParams({
      currentLongUsd: longInterestUsd,
      currentShortUsd: shortInterestUsd,
      usdDelta: sizeDeltaUsd,
      isLong: isLong,
    });
  
    const priceImpactUsd = getPriceImpactUsd({
      currentLongUsd,
      currentShortUsd,
      nextLongUsd,
      nextShortUsd,
      factorPositive: marketInfo.positionImpactFactorPositive,
      factorNegative: marketInfo.positionImpactFactorNegative,
      exponentFactor: marketInfo.positionImpactExponentFactor,
      fallbackToZero: opts.fallbackToZero,
    });
  
    if (priceImpactUsd.gt(0)) {
      return priceImpactUsd;
    }
  
    if (!marketInfo.virtualInventoryForPositions.abs().gt(0)) {
      return priceImpactUsd;
    }
  
    const virtualInventoryParams = getNextOpenInterestForVirtualInventory({
      virtualInventory: marketInfo.virtualInventoryForPositions,
      usdDelta: sizeDeltaUsd,
      isLong: isLong,
    });
  
    const priceImpactUsdForVirtualInventory = getPriceImpactUsd({
      currentLongUsd: virtualInventoryParams.currentLongUsd,
      currentShortUsd: virtualInventoryParams.currentShortUsd,
      nextLongUsd: virtualInventoryParams.nextLongUsd,
      nextShortUsd: virtualInventoryParams.nextShortUsd,
      factorPositive: marketInfo.positionImpactFactorPositive,
      factorNegative: marketInfo.positionImpactFactorNegative,
      exponentFactor: marketInfo.positionImpactExponentFactor,
      fallbackToZero: opts.fallbackToZero,
    });
  
    return priceImpactUsdForVirtualInventory.lt(priceImpactUsd) ? priceImpactUsdForVirtualInventory : priceImpactUsd;
}

function getNextOpenInterestForVirtualInventory(p) {
    const { virtualInventory, usdDelta, isLong } = p;
  
    let currentLongUsd = BigNumber.from(0);
    let currentShortUsd = BigNumber.from(0);
  
    if (virtualInventory.gt(0)) {
      currentShortUsd = virtualInventory;
    } else {
      currentLongUsd = virtualInventory.mul(-1);
    }
  
    if (usdDelta.lt(0)) {
      const offset = usdDelta.abs();
      currentLongUsd = currentLongUsd.add(offset);
      currentShortUsd = currentShortUsd.add(offset);
    }
  
    return getNextOpenInterestParams({
      currentLongUsd,
      currentShortUsd,
      usdDelta,
      isLong,
    });
}
  
function getNextOpenInterestParams(p) {
    const { currentLongUsd, currentShortUsd, usdDelta, isLong } = p;
  
    let nextLongUsd = currentLongUsd;
    let nextShortUsd = currentShortUsd;
  
    if (isLong) {
      nextLongUsd = currentLongUsd?.add(usdDelta || 0);
    } else {
      nextShortUsd = currentShortUsd?.add(usdDelta || 0);
    }
  
    return {
      currentLongUsd,
      currentShortUsd,
      nextLongUsd,
      nextShortUsd,
    };
}

export function getSwapFee(marketInfo, swapAmount, forPositiveImpact) {
    const factor = forPositiveImpact
      ? marketInfo.swapFeeFactorForPositiveImpact
      : marketInfo.swapFeeFactorForNegativeImpact;
  
    return applyFactor(swapAmount, factor);
}

export function getNextPoolAmountsParams(p) {
    const { marketInfo, longToken, shortToken, longPoolAmount, shortPoolAmount, longDeltaUsd, shortDeltaUsd } = p;
  
    const longPrice = getMidPrice(longToken.prices);
    const shortPrice = getMidPrice(shortToken.prices);
  
    const longPoolUsd = convertToUsd(longPoolAmount, longToken.decimals, longPrice);
    const shortPoolUsd = convertToUsd(shortPoolAmount, shortToken.decimals, shortPrice);
  
    const longPoolUsdAdjustment = convertToUsd(marketInfo.longPoolAmountAdjustment, longToken.decimals, longPrice);
    const shortPoolUsdAdjustment = convertToUsd(marketInfo.shortPoolAmountAdjustment, shortToken.decimals, shortPrice);
  
    const nextLongPoolUsd = longPoolUsd.add(longDeltaUsd).add(longPoolUsdAdjustment);
    const nextShortPoolUsd = shortPoolUsd.add(shortDeltaUsd).add(shortPoolUsdAdjustment);
  
    return {
      longPoolUsd,
      shortPoolUsd,
      nextLongPoolUsd,
      nextShortPoolUsd,
    };
}

export function getPriceImpactUsd(p) {
    const { nextLongUsd, nextShortUsd } = p;
  
    if (nextLongUsd.lt(0) || nextShortUsd.lt(0)) {
      if (p.fallbackToZero) {
        return BigNumber.from(0);
      } else {
        throw new Error("Negative pool amount");
      }
    }
  
    const currentDiff = p.currentLongUsd.sub(p.currentShortUsd).abs();
    const nextDiff = nextLongUsd.sub(nextShortUsd).abs();
  
    const isSameSideRebalance = p.currentLongUsd.lt(p.currentShortUsd) === nextLongUsd.lt(nextShortUsd);
  
    let impactUsd;
  
    if (isSameSideRebalance) {
      const hasPositiveImpact = nextDiff.lt(currentDiff);
      const factor = hasPositiveImpact ? p.factorPositive : p.factorNegative;
  
      impactUsd = calculateImpactForSameSideRebalance({
        currentDiff,
        nextDiff,
        hasPositiveImpact,
        factor,
        exponentFactor: p.exponentFactor,
      });
    } else {
      impactUsd = calculateImpactForCrossoverRebalance({
        currentDiff,
        nextDiff,
        factorPositive: p.factorPositive,
        factorNegative: p.factorNegative,
        exponentFactor: p.exponentFactor,
      });
    }
  
    return impactUsd;
}
  
export function calculateImpactForSameSideRebalance(p) {
    const { currentDiff, nextDiff, hasPositiveImpact, factor, exponentFactor } = p;
  
    const currentImpact = applyImpactFactor(currentDiff, factor, exponentFactor);
    const nextImpact = applyImpactFactor(nextDiff, factor, exponentFactor);
  
    const deltaDiff = currentImpact.sub(nextImpact).abs();
  
    return hasPositiveImpact ? deltaDiff : BigNumber.from(0).sub(deltaDiff);
}
  
export function calculateImpactForCrossoverRebalance(p) {
    const { currentDiff, nextDiff, factorNegative, factorPositive, exponentFactor } = p;
  
    const positiveImpact = applyImpactFactor(currentDiff, factorPositive, exponentFactor);
    const negativeImpactUsd = applyImpactFactor(nextDiff, factorNegative, exponentFactor);
  
    const deltaDiffUsd = positiveImpact.sub(negativeImpactUsd).abs();
  
    return positiveImpact.gt(negativeImpactUsd) ? deltaDiffUsd : BigNumber.from(0).sub(deltaDiffUsd);
}
  
  export function applyImpactFactor(diff, factor, exponent) {
    // Convert diff and exponent to float js numbers
    const _diff = Number(diff) / 10 ** 30;
    const _exponent = Number(exponent) / 10 ** 30;
  
    // Pow and convert back to BigNumber with 30 decimals
    let result = bigNumberify(BigInt(Math.round(_diff ** _exponent * 10 ** 30)));
  
    result = result.mul(factor).div(expandDecimals(1, 30));
  
    return result;
}
  

export function getPriceImpactForSwap(
    marketInfo,
    tokenA,
    tokenB,
    usdDeltaTokenA,
    usdDeltaTokenB,
    opts = {}
  ) {
    const tokenAPoolType = getTokenPoolType(marketInfo, tokenA.address);
    const tokenBPoolType = getTokenPoolType(marketInfo, tokenB.address);
  
    if (
      tokenAPoolType === undefined ||
      tokenBPoolType === undefined ||
      (tokenAPoolType === tokenBPoolType && !marketInfo.isSameCollaterals)
    ) {
      throw new Error(`Invalid tokens to swap ${marketInfo.marketTokenAddress} ${tokenA.address} ${tokenB.address}`);
    }
  
    const [longToken, shortToken] = tokenAPoolType === "long" ? [tokenA, tokenB] : [tokenB, tokenA];
    const [longDeltaUsd, shortDeltaUsd] =
      tokenAPoolType === "long" ? [usdDeltaTokenA, usdDeltaTokenB] : [usdDeltaTokenB, usdDeltaTokenA];
  
    const { longPoolUsd, shortPoolUsd, nextLongPoolUsd, nextShortPoolUsd } = getNextPoolAmountsParams({
      marketInfo,
      longToken,
      shortToken,
      longPoolAmount: marketInfo.longPoolAmount,
      shortPoolAmount: marketInfo.shortPoolAmount,
      longDeltaUsd,
      shortDeltaUsd,
    });
  
    const priceImpactUsd = getPriceImpactUsd({
      currentLongUsd: longPoolUsd,
      currentShortUsd: shortPoolUsd,
      nextLongUsd: nextLongPoolUsd,
      nextShortUsd: nextShortPoolUsd,
      factorPositive: marketInfo.swapImpactFactorPositive,
      factorNegative: marketInfo.swapImpactFactorNegative,
      exponentFactor: marketInfo.swapImpactExponentFactor,
      fallbackToZero: opts.fallbackToZero,
    });
  
    if (priceImpactUsd.gt(0)) {
      return priceImpactUsd;
    }
  
    const virtualInventoryLong = marketInfo.virtualPoolAmountForLongToken;
    const virtualInventoryShort = marketInfo.virtualPoolAmountForShortToken;
  
    if (!virtualInventoryLong.gt(0) || !virtualInventoryShort.gt(0)) {
      return priceImpactUsd;
    }
  
    const virtualInventoryParams = getNextPoolAmountsParams({
      marketInfo,
      longToken,
      shortToken,
      longPoolAmount: virtualInventoryLong,
      shortPoolAmount: virtualInventoryShort,
      longDeltaUsd,
      shortDeltaUsd,
    });
  
    const priceImpactUsdForVirtualInventory = getPriceImpactUsd({
      currentLongUsd: virtualInventoryParams.longPoolUsd,
      currentShortUsd: virtualInventoryParams.shortPoolUsd,
      nextLongUsd: virtualInventoryParams.nextLongPoolUsd,
      nextShortUsd: virtualInventoryParams.nextShortPoolUsd,
      factorPositive: marketInfo.swapImpactFactorPositive,
      factorNegative: marketInfo.swapImpactFactorNegative,
      exponentFactor: marketInfo.swapImpactExponentFactor,
      fallbackToZero: opts.fallbackToZero,
    });
  
    return priceImpactUsdForVirtualInventory.lt(priceImpactUsd) ? priceImpactUsdForVirtualInventory : priceImpactUsd;
}

export function applySwapImpactWithCap(marketInfo, token, priceImpactDeltaUsd) {
    const tokenPoolType = getTokenPoolType(marketInfo, token.address);
  
    if (!tokenPoolType) {
      throw new Error(`Token ${token.address} is not a collateral of the market ${marketInfo.marketTokenAddress}`);
    }
  
    const isLongCollateral = tokenPoolType === "long";
    const price = priceImpactDeltaUsd.gt(0) ? token.prices.maxPrice : token.prices.minPrice;
  
    let impactDeltaAmount;
  
    if (priceImpactDeltaUsd.gt(0)) {
      // round positive impactAmount down, this will be deducted from the swap impact pool for the user
      impactDeltaAmount = convertToTokenAmount(priceImpactDeltaUsd, token.decimals, price);
  
      const maxImpactAmount = isLongCollateral
        ? marketInfo.swapImpactPoolAmountLong
        : marketInfo.swapImpactPoolAmountShort;
  
      if (impactDeltaAmount.gt(maxImpactAmount)) {
        impactDeltaAmount = maxImpactAmount;
      }
    } else {
      // round negative impactAmount up, this will be deducted from the user
      impactDeltaAmount = roundUpMagnitudeDivision(priceImpactDeltaUsd.mul(expandDecimals(1, token.decimals)), price);
    }
  
    return impactDeltaAmount;
}

export function getSwapPathOutputAddresses(p) {
    const { marketsInfoData, initialCollateralAddress, swapPath, wrappedNativeTokenAddress, shouldUnwrapNativeToken } = p;
  
    if (swapPath.length === 0) {
      return {
        outTokenAddress:
          shouldUnwrapNativeToken && initialCollateralAddress === wrappedNativeTokenAddress
            ? NATIVE_TOKEN_ADDRESS
            : initialCollateralAddress,
  
        outMarketAddress: undefined,
      };
    }
  
    const [firstMarketAddress, ...marketAddresses] = swapPath;
  
    let outMarket = getByKey(marketsInfoData, firstMarketAddress);
  
    if (!outMarket) {
      return {
        outTokenAddress: undefined,
        outMarketAddress: undefined,
      };
    }
  
    let outTokenType = getTokenPoolType(outMarket, initialCollateralAddress);
    let outToken = outTokenType === "long" ? outMarket.shortToken : outMarket.longToken;
  
    for (const marketAddress of marketAddresses) {
      outMarket = getByKey(marketsInfoData, marketAddress);
  
      if (!outMarket) {
        return {
          outTokenAddress: undefined,
          outMarketAddress: undefined,
        };
      }
  
      outTokenType = outMarket.longTokenAddress === outToken.address ? "short" : "long";
      outToken = outTokenType === "long" ? outMarket.longToken : outMarket.shortToken;
    }
  
    const outTokenAddress =
      shouldUnwrapNativeToken && outToken.address === wrappedNativeTokenAddress ? NATIVE_TOKEN_ADDRESS : outToken.address;
  
    return {
      outTokenAddress,
      outMarketAddress: outMarket.marketTokenAddress,
    };
}
  
export function getMaxSwapPathLiquidity(p) {
    const { marketsInfoData, swapPath, initialCollateralAddress } = p;
  
    if (swapPath.length === 0) {
      return BigNumber.from(0);
    }
  
    let minMarketLiquidity = ethers.constants.MaxUint256;
    let tokenInAddress = initialCollateralAddress;
  
    for (const marketAddress of swapPath) {
      const marketInfo = getByKey(marketsInfoData, marketAddress);
  
      if (!marketInfo) {
        return BigNumber.from(0);
      }
  
      const tokenOut = getOppositeCollateral(marketInfo, tokenInAddress);
  
      if (!tokenOut) {
        return BigNumber.from(0);
      }
  
      const isTokenOutLong = getTokenPoolType(marketInfo, tokenOut.address) === "long";
      const liquidity = getAvailableUsdLiquidityForCollateral(marketInfo, isTokenOutLong);
  
      if (liquidity.lt(minMarketLiquidity)) {
        minMarketLiquidity = liquidity;
      }
  
      tokenInAddress = tokenOut.address;
    }
  
    if (minMarketLiquidity.eq(ethers.constants.MaxUint256)) {
      return BigNumber.from(0);
    }
  
    return minMarketLiquidity;
}
  
export function getSwapPathStats(p) {
    const {
      marketsInfoData,
      swapPath,
      initialCollateralAddress,
      usdIn,
      shouldUnwrapNativeToken,
      shouldApplyPriceImpact,
      wrappedNativeTokenAddress,
    } = p;
  
    if (swapPath.length === 0) {
      return undefined;
    }
  
    const swapSteps = [];
  
    let usdOut = usdIn;
  
    let tokenInAddress = initialCollateralAddress;
    let tokenOutAddress = initialCollateralAddress;
  
    let totalSwapPriceImpactDeltaUsd = BigNumber.from(0);
    let totalSwapFeeUsd = BigNumber.from(0);
  
    for (let i = 0; i < swapPath.length; i++) {
      const marketAddress = swapPath[i];
      const marketInfo = marketsInfoData[marketAddress];
  
      tokenOutAddress = getOppositeCollateral(marketInfo, tokenInAddress).address;
  
      if (i === swapPath.length - 1 && shouldUnwrapNativeToken && tokenOutAddress === wrappedNativeTokenAddress) {
        tokenOutAddress = NATIVE_TOKEN_ADDRESS;
      }
  
      const swapStep = getSwapStats({
        marketInfo,
        tokenInAddress,
        tokenOutAddress,
        usdIn: usdOut,
        shouldApplyPriceImpact,
      });
  
      tokenInAddress = swapStep.tokenOutAddress;
      usdOut = swapStep.usdOut;
  
      totalSwapPriceImpactDeltaUsd = totalSwapPriceImpactDeltaUsd.add(swapStep.priceImpactDeltaUsd);
      totalSwapFeeUsd = totalSwapFeeUsd.add(swapStep.swapFeeUsd);
  
      swapSteps.push(swapStep);
    }
  
    const lastStep = swapSteps[swapSteps.length - 1];
    const targetMarketAddress = lastStep.marketAddress;
    const amountOut = lastStep.amountOut;
  
    const totalFeesDeltaUsd = BigNumber.from(0).sub(totalSwapFeeUsd).add(totalSwapPriceImpactDeltaUsd);
  
    return {
      swapPath,
      tokenInAddress,
      tokenOutAddress,
      targetMarketAddress,
      swapSteps,
      usdOut,
      amountOut,
      totalSwapFeeUsd,
      totalSwapPriceImpactDeltaUsd,
      totalFeesDeltaUsd,
    };
}
  
  export function getSwapStats(p) {
    const { marketInfo, tokenInAddress, tokenOutAddress, usdIn, shouldApplyPriceImpact } = p;
  
    const isWrap = tokenInAddress === NATIVE_TOKEN_ADDRESS;
    const isUnwrap = tokenOutAddress === NATIVE_TOKEN_ADDRESS;
  
    const tokenIn =
      getTokenPoolType(marketInfo, tokenInAddress) === "long" ? marketInfo.longToken : marketInfo.shortToken;
  
    const tokenOut =
      getTokenPoolType(marketInfo, tokenOutAddress) === "long" ? marketInfo.longToken : marketInfo.shortToken;
  
    const priceIn = tokenIn.prices.minPrice;
    const priceOut = tokenOut.prices.maxPrice;
  
    const amountIn = convertToTokenAmount(usdIn, tokenIn.decimals, priceIn);
  
    let priceImpactDeltaUsd;
  
    try {
      priceImpactDeltaUsd = getPriceImpactForSwap(marketInfo, tokenIn, tokenOut, usdIn, usdIn.mul(-1));
    } catch (e) {
      return {
        swapFeeUsd: BigNumber.from(0),
        swapFeeAmount: BigNumber.from(0),
        isWrap,
        isUnwrap,
        marketAddress: marketInfo.marketTokenAddress,
        tokenInAddress,
        tokenOutAddress,
        priceImpactDeltaUsd: BigNumber.from(0),
        amountIn,
        amountInAfterFees: amountIn,
        usdIn,
        amountOut: BigNumber.from(0),
        usdOut: BigNumber.from(0),
        isOutLiquidity: true,
      };
    }
  
    const swapFeeAmount = getSwapFee(marketInfo, amountIn, priceImpactDeltaUsd.gt(0));
    const swapFeeUsd = getSwapFee(marketInfo, usdIn, priceImpactDeltaUsd.gt(0));
  
    const amountInAfterFees = amountIn.sub(swapFeeAmount);
    const usdInAfterFees = usdIn.sub(swapFeeUsd);
  
    let usdOut = usdInAfterFees;
    let amountOut = convertToTokenAmount(usdOut, tokenOut.decimals, priceOut);
  
    let cappedImpactDeltaUsd;
  
    if (priceImpactDeltaUsd.gt(0)) {
      const positiveImpactAmount = applySwapImpactWithCap(marketInfo, tokenOut, priceImpactDeltaUsd);
      cappedImpactDeltaUsd = convertToUsd(positiveImpactAmount, tokenOut.decimals, priceOut);
    } else {
      const negativeImpactAmount = applySwapImpactWithCap(marketInfo, tokenIn, priceImpactDeltaUsd);
      cappedImpactDeltaUsd = convertToUsd(negativeImpactAmount, tokenIn.decimals, priceIn);
    }
  
    if (shouldApplyPriceImpact) {
      usdOut = usdOut.add(cappedImpactDeltaUsd);
    }
  
    if (usdOut.lt(0)) {
      usdOut = BigNumber.from(0);
    }
  
    amountOut = convertToTokenAmount(usdOut, tokenOut.decimals, priceOut);
  
    const liquidity = getAvailableUsdLiquidityForCollateral(
      marketInfo,
      getTokenPoolType(marketInfo, tokenOutAddress) === "long"
    );
  
    const isOutLiquidity = liquidity.lt(usdOut);
  
    return {
      swapFeeUsd,
      swapFeeAmount,
      isWrap,
      isUnwrap,
      marketAddress: marketInfo.marketTokenAddress,
      tokenInAddress,
      tokenOutAddress,
      priceImpactDeltaUsd: cappedImpactDeltaUsd,
      amountIn,
      amountInAfterFees,
      usdIn,
      amountOut,
      usdOut,
      isOutLiquidity,
    };
}
  

export function getMarketsGraph(markets) {
  const graph = {
    abjacencyList: {},
    edges: [],
  };

  for (const market of markets) {
    const { longTokenAddress, shortTokenAddress, marketTokenAddress, isSameCollaterals, isDisabled } = market;

    if (isSameCollaterals || isDisabled) {
      continue;
    }

    const longShortEdge = {
      marketInfo: market,
      marketAddress: marketTokenAddress,
      from: longTokenAddress,
      to: shortTokenAddress,
    };

    const shortLongEdge = {
      marketInfo: market,
      marketAddress: marketTokenAddress,
      from: shortTokenAddress,
      to: longTokenAddress,
    };

    graph.abjacencyList[longTokenAddress] = graph.abjacencyList[longTokenAddress] || [];
    graph.abjacencyList[longTokenAddress].push(longShortEdge);
    graph.abjacencyList[shortTokenAddress] = graph.abjacencyList[shortTokenAddress] || [];
    graph.abjacencyList[shortTokenAddress].push(shortLongEdge);

    graph.edges.push(longShortEdge, shortLongEdge);
  }

  return graph;
}

export const createSwapEstimator = (marketsInfoData) => {
  return (e, usdIn) => {
    const marketInfo = marketsInfoData[e.marketAddress];

    const swapStats = getSwapStats({
      marketInfo,
      usdIn,
      tokenInAddress: e.from,
      tokenOutAddress: e.to,
      shouldApplyPriceImpact: true,
    });

    const isOutLiquidity = swapStats?.isOutLiquidity;
    const usdOut = swapStats?.usdOut;

    if (!usdOut || isOutLiquidity) {
      return {
        usdOut: BigNumber.from(0),
      };
    }

    return {
      usdOut,
    };
  };
};

export function getBestSwapPath(routes, usdIn, estimator) {
  if (routes.length === 0) {
    return undefined;
  }

  let bestPath = routes[0].path;
  let bestUsdOut = BigNumber.from(0);

  for (const route of routes) {
    try {
      const pathUsdOut = route.edged.reduce((prevUsdOut, edge) => {
        const { usdOut } = estimator(edge, prevUsdOut);
        return usdOut;
      }, usdIn);

      if (pathUsdOut.gt(bestUsdOut)) {
        bestPath = route.path;
        bestUsdOut = pathUsdOut;
      }
    } catch (e) {
      continue;
    }
  }

  return bestPath;
}

export function findAllPaths(
  marketsInfoData,
  graph,
  from,
  to,
  maxDepth = 3
) {
  const routes = [];

  const edges = graph.abjacencyList[from];

  if (!edges?.length) {
    return undefined;
  }

  for (const e of edges) {
    dfs(e, [], [], {});
  }

  function dfs(edge, path, pathEdges, visited) {
    // avoid too deep paths and cycles
    if (path.length >= maxDepth || visited[edge.marketAddress]) {
      return;
    }

    visited[edge.marketAddress] = true;
    pathEdges.push(edge);
    path.push(edge.marketAddress);

    if (edge.to === to) {
      routes.push({
        edged: pathEdges,
        path: path,
        liquidity: getMaxSwapPathLiquidity({ marketsInfoData, swapPath: path, initialCollateralAddress: from }),
      });
      return;
    }

    const edges = graph.abjacencyList[edge.to];

    if (!edges?.length) {
      return;
    }

    for (const e of edges) {
      dfs(e, [...path], [...pathEdges], { ...visited });
    }
  }

  return routes;
}

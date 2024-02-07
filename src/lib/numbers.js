import { BigNumber, ethers } from "ethers";

export const PRECISION = expandDecimals(1, 30);
export const USD_DECIMALS = 30;
const MAX_EXCEEDING_THRESHOLD = "1000000000";
const MIN_EXCEEDING_THRESHOLD = "0.01";
export const TRIGGER_PREFIX_ABOVE = ">";
export const TRIGGER_PREFIX_BELOW = "<";
export const BASIS_POINTS_DIVISOR = 10000;

export function bigNumberify(n) {
    try {
      return BigNumber.from(n);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("bigNumberify error", e);
      return undefined;
    }
}

export function applyFactor(value, factor) {
    return value.mul(factor).div(PRECISION);
}
  
export function expandDecimals(n, decimals) {
    // @ts-ignore
    return bigNumberify(n).mul(bigNumberify(10).pow(decimals));
}

export function adjustForDecimals(amount, divDecimals, mulDecimals) {
    return amount.mul(expandDecimals(1, mulDecimals)).div(expandDecimals(1, divDecimals));
}


export const limitDecimals = (amount, maxDecimals) => {
    let amountStr = amount.toString();
    if (maxDecimals === undefined) {
      return amountStr;
    }
    if (maxDecimals === 0) {
      return amountStr.split(".")[0];
    }
    const dotIndex = amountStr.indexOf(".");
    if (dotIndex !== -1) {
      let decimals = amountStr.length - dotIndex - 1;
      if (decimals > maxDecimals) {
        amountStr = amountStr.substr(0, amountStr.length - (decimals - maxDecimals));
      }
    }
  
    return amountStr;
};

export function getBasisPoints(numerator, denominator, shouldRoundUp = false) {
    const result = numerator.mul(BASIS_POINTS_DIVISOR).div(denominator);
  
    if (shouldRoundUp) {
      const remainder = numerator.mul(BASIS_POINTS_DIVISOR).mod(denominator);
      if (!remainder.isZero()) {
        return result.isNegative() ? result.sub(1) : result.add(1);
      }
    }
  
    return result;
}
  
export const padDecimals = (amount, minDecimals) => {
    let amountStr = amount.toString();
    const dotIndex = amountStr.indexOf(".");
    if (dotIndex !== -1) {
      const decimals = amountStr.length - dotIndex - 1;
      if (decimals < minDecimals) {
        amountStr = amountStr.padEnd(amountStr.length + (minDecimals - decimals), "0");
      }
    } else {
      amountStr = amountStr + ".0000";
    }
    return amountStr;
};

export function numberWithCommas(x) {
    if (!x) {
      return "...";
    }
  
    const parts = x.toString().split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
}

function getLimitedDisplay(
    amount,
    tokenDecimals,
    opts = {}
) {
    const { maxThreshold = MAX_EXCEEDING_THRESHOLD, minThreshold = MIN_EXCEEDING_THRESHOLD } = opts;
    const max = expandDecimals(maxThreshold, tokenDecimals);
    const min = ethers.utils.parseUnits(minThreshold, tokenDecimals);
    const absAmount = amount.abs();
  
    if (absAmount.eq(0)) {
      return {
        symbol: "",
        value: absAmount,
      };
    }
  
    const symbol = absAmount.gt(max) ? TRIGGER_PREFIX_ABOVE : absAmount.lt(min) ? TRIGGER_PREFIX_BELOW : "";
    const value = absAmount.gt(max) ? max : absAmount.lt(min) ? min : absAmount;
  
    return {
      symbol,
      value,
    };
}

export const parseValue = (value, tokenDecimals) => {
    const pValue = parseFloat(value);
  
    if (isNaN(pValue)) {
      return undefined;
    }
    value = limitDecimals(value, tokenDecimals);
    const amount = ethers.utils.parseUnits(value, tokenDecimals);
    return bigNumberify(amount);
};

export function roundUpMagnitudeDivision(a, b) {
    if (a.lt(0)) {
      return a.sub(b).add(1).div(b);
    }
  
    return a.add(b).sub(1).div(b);
}

export const trimZeroDecimals = (amount) => {
    if (parseFloat(amount) === parseInt(amount)) {
      return parseInt(amount).toString();
    }
    return amount;
};

export const formatAmount = (
    amount,
    tokenDecimals,
    displayDecimals,
    useCommas,
    defaultValue
  ) => {
    if (!defaultValue) {
      defaultValue = "...";
    }
    if (amount === undefined || amount.toString().length === 0) {
      return defaultValue;
    }
    if (displayDecimals === undefined) {
      displayDecimals = 4;
    }
    let amountStr = ethers.utils.formatUnits(amount, tokenDecimals);
    amountStr = limitDecimals(amountStr, displayDecimals);
    if (displayDecimals !== 0) {
      amountStr = padDecimals(amountStr, displayDecimals);
    }
    if (useCommas) {
      return numberWithCommas(amountStr);
    }
    return amountStr;
};

export const formatAmountFree = (amount, tokenDecimals, displayDecimals) => {
    if (!amount) {
      return "...";
    }
    let amountStr = ethers.utils.formatUnits(amount, tokenDecimals);
    amountStr = limitDecimals(amountStr, displayDecimals);
    return trimZeroDecimals(amountStr);
};

export function formatTokenAmount(
    amount,
    tokenDecimals,
    symbol,
    opts = {}
) {
    const {
      displayDecimals = 4,
      showAllSignificant = false,
      fallbackToZero = false,
      useCommas = false,
      minThreshold = "0",
      maxThreshold,
    } = opts;
  
    const symbolStr = symbol ? ` ${symbol}` : "";
  
    if (!amount || !tokenDecimals) {
      if (fallbackToZero) {
        amount = BigNumber.from(0);
        tokenDecimals = displayDecimals;
      } else {
        return undefined;
      }
    }
  
    let amountStr;
  
    const sign = amount.lt(0) ? "-" : "";
  
    if (showAllSignificant) {
      amountStr = formatAmountFree(amount, tokenDecimals, tokenDecimals);
    } else {
      const exceedingInfo = getLimitedDisplay(amount, tokenDecimals, { maxThreshold, minThreshold });
      const symbol = exceedingInfo.symbol ? `${exceedingInfo.symbol} ` : "";
      amountStr = `${symbol}${sign}${formatAmount(exceedingInfo.value, tokenDecimals, displayDecimals, useCommas)}`;
    }
  
    return `${amountStr}${symbolStr}`;
  }
  
  export function formatTokenAmountWithUsd(
    tokenAmount,
    usdAmount,
    tokenSymbol,
    tokenDecimals,
    opts = {}
  ) {
    if (!tokenAmount || !usdAmount || !tokenSymbol || !tokenDecimals) {
      if (!opts.fallbackToZero) {
        return undefined;
      }
    }
  
    const tokenStr = formatTokenAmount(tokenAmount, tokenDecimals, tokenSymbol, { ...opts, useCommas: true });
  
    const usdStr = formatUsd(usdAmount, {
      fallbackToZero: opts.fallbackToZero,
    });
  
    return `${tokenStr} (${usdStr})`;
  }

  export function formatUsd(
    usd,
    opts = {}
  ) {
    const { fallbackToZero = false, displayDecimals = 2 } = opts;
  
    if (!usd) {
      if (fallbackToZero) {
        usd = BigNumber.from(0);
      } else {
        return undefined;
      }
    }
  
    const exceedingInfo = getLimitedDisplay(usd, USD_DECIMALS, opts);
    const sign = usd.lt(0) ? "-" : "";
    const symbol = exceedingInfo.symbol ? `${exceedingInfo.symbol} ` : "";
    const displayUsd = formatAmount(exceedingInfo.value, USD_DECIMALS, displayDecimals, true);
    return `${symbol}${sign}$${displayUsd}`;
  }
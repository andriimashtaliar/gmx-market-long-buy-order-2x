import { NATIVE_TOKEN_ADDRESS, convertTokenAddress, getWrappedToken } from "config/tokens";
import { BigNumber } from "ethers";
import useWallet from "hooks/wallet/useWallet";
import { useCallback, useMemo } from "react";
import {
  createSwapEstimator,
  findAllPaths,
  getBestSwapPath,
  getMarketsGraph,
  getMaxSwapPathLiquidity,
  getSwapPathStats,
} from "./utils";

export function useSwapRoutes(marketsInfoData, fromTokenAddress, toTokenAddress) {
  const { chainId } = useWallet();

  const wrappedToken = getWrappedToken(chainId);

  const isWrap = fromTokenAddress === NATIVE_TOKEN_ADDRESS && toTokenAddress === wrappedToken.address;
  const isUnwrap = fromTokenAddress === wrappedToken.address && toTokenAddress === NATIVE_TOKEN_ADDRESS;
  const isSameToken = fromTokenAddress === toTokenAddress;

  const wrappedFromAddress = fromTokenAddress ? convertTokenAddress(chainId, fromTokenAddress, "wrapped") : undefined;
  const wrappedToAddress = toTokenAddress ? convertTokenAddress(chainId, toTokenAddress, "wrapped") : undefined;

  const { graph, estimator } = useMemo(() => {
    if (!marketsInfoData) {
      return {};
    }

    return {
      graph: getMarketsGraph(Object.values(marketsInfoData)),
      estimator: createSwapEstimator(marketsInfoData),
    };
  }, [marketsInfoData]);

  const allRoutes = useMemo(() => {
    if (!marketsInfoData || !graph || !wrappedFromAddress || !wrappedToAddress || isWrap || isUnwrap || isSameToken) {
      return undefined;
    }

    const paths = findAllPaths(marketsInfoData, graph, wrappedFromAddress, wrappedToAddress)
      ?.sort((a, b) => {
        return b.liquidity.sub(a.liquidity).gt(0) ? 1 : -1;
      })
      .slice(0, 5);

    return paths;
  }, [graph, isSameToken, isUnwrap, isWrap, marketsInfoData, wrappedFromAddress, wrappedToAddress]);

  const { maxLiquidity, maxLiquidityPath } = useMemo(() => {
    let maxLiquidity = BigNumber.from(0);
    let maxLiquidityPath = undefined;

    if (!allRoutes || !marketsInfoData || !wrappedFromAddress) {
      return { maxLiquidity, maxLiquidityPath };
    }

    for (const route of allRoutes) {
      const liquidity = getMaxSwapPathLiquidity({
        marketsInfoData,
        swapPath: route.path,
        initialCollateralAddress: wrappedFromAddress,
      });

      if (liquidity.gt(maxLiquidity)) {
        maxLiquidity = liquidity;
        maxLiquidityPath = route.path;
      }
    }

    return { maxLiquidity, maxLiquidityPath };
  }, [allRoutes, marketsInfoData, wrappedFromAddress]);

  const findSwapPath = useCallback(
    (usdIn, opts) => {
      if (!allRoutes?.length || !estimator || !marketsInfoData || !fromTokenAddress) {
        return undefined;
      }

      let swapPath = undefined;

      if (opts.byLiquidity) {
        swapPath = allRoutes[0].path;
      } else {
        swapPath = getBestSwapPath(allRoutes, usdIn, estimator);
      }

      if (!swapPath) {
        return undefined;
      }

      const swapPathStats = getSwapPathStats({
        marketsInfoData,
        swapPath,
        initialCollateralAddress: fromTokenAddress,
        wrappedNativeTokenAddress: wrappedToken.address,
        shouldUnwrapNativeToken: toTokenAddress === NATIVE_TOKEN_ADDRESS,
        shouldApplyPriceImpact: true,
        usdIn,
      });

      if (!swapPathStats) {
        return undefined;
      }

      return swapPathStats;
    },
    [allRoutes, estimator, fromTokenAddress, marketsInfoData, toTokenAddress, wrappedToken.address]
  );

  return {
    maxSwapLiquidity: maxLiquidity,
    maxLiquiditySwapPath: maxLiquidityPath,
    findSwapPath,
  };
}

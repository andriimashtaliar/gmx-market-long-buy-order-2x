import React, { useState, useEffect, useMemo } from 'react'

import { Input } from 'components/Input'
import { Divider } from 'components/Divider'
import { InfoRow } from 'components/InfoRow'
import { Button } from 'components/Button'

import { BigNumber } from 'ethers'

import { formatAddress, getByKey } from 'lib/objects'
import { formatTokenAmount, formatUsd, parseValue, applyFactor, BASIS_POINTS_DIVISOR, formatAmount } from 'lib/numbers'

import { useConnectModal } from '@rainbow-me/rainbowkit';

import { config } from 'config/app'
import { getContract } from 'config/contracts'

import { convertToUsd, useTokensAllowanceData, convertToTokenAmount, getNeedTokenApprove, approveTokens } from 'hooks/tokens'
import { createIncreaseOrderTxn } from 'hooks/orders/createIncreaseOrderTxn'
import useWallet from 'hooks/wallet/useWallet'
import { useGasPrice } from 'hooks/wallet/useGasPrice'
import { useGasLimits } from 'hooks/wallet/useGasLimits'
import { useMarketsInfo } from 'hooks/markets'
import { 
    getMarkPrice, 
    getSwapAmountsByFromValue, 
    getPriceImpactForPosition, 
    getPositionFee, 
    getTotalSwapVolumeFromSwapStats, 
    getAcceptablePriceInfo,
    estimateExecuteIncreaseOrderGasLimit,
    useSwapRoutes,
    useUiFeeFactor,
    getExecutionFee 
} from 'hooks/trade'

import './Trade.css'

export const Trade = () => {
    const { openConnectModal } = useConnectModal()
    const { account, chainId, active, signer } = useWallet()

    const { marketsInfoData, tokensData } = useMarketsInfo(chainId);

    const [fromToken, setFromToken] = useState();
    const [toToken, setToToken] = useState();
    const [collateralToken, setCollateralToken] = useState();

    const [fromAmount, setFromAmount] = useState('0.0');
    const leverage = BigNumber.from(parseInt(String(Number(config.leverage) * BASIS_POINTS_DIVISOR)));
    const { gasPrice } = useGasPrice(chainId);
    const { gasLimits } = useGasLimits(chainId);

    const marketInfo = marketsInfoData? getByKey(marketsInfoData, config.marketAddress) : null;

    const swapRoute = useSwapRoutes(
        marketsInfoData,
        config.fromTokenAddress,
        config.collateralTokenAddress,
    );

    const uiFeeFactor = useUiFeeFactor(chainId);

    useEffect(() => {
        if (!tokensData) return;

        setFromToken(tokensData[config.fromTokenAddress]);
        setToToken(tokensData[config.toTokenAddress]);
        setCollateralToken(tokensData[config.collateralTokenAddress]);
    }, [tokensData])

    const fromTokenAmount = fromToken ? parseValue(fromAmount || '0', fromToken.decimals) : BigNumber.from(0);
    const fromTokenPrice = fromToken? fromToken.prices.minPrice : 0;
    const fromUsd = fromToken? convertToUsd(fromTokenAmount, fromToken.decimals, fromTokenPrice) : null;

    const increaseAmounts = useMemo(() => {
        if (!fromToken || !toToken || !marketInfo || !collateralToken || !tokensData) return undefined;

        const values = {
            initialCollateralAmount: BigNumber.from(0),
            initialCollateralUsd: BigNumber.from(0),
            collateralDeltaAmount: BigNumber.from(0),
            swapPathStats: undefined,
            sizeDeltaUsd: BigNumber.from(0),
            sizeDeltaInTokens: BigNumber.from(0),
            acceptablePrice: BigNumber.from(0),
            indexPrice: BigNumber.from(0),
            indexTokenAmount: BigNumber.from(0),
            initialCollateralPrice: BigNumber.from(0),
            collateralPrice: BigNumber.from(0),
            estimatedLeverage: leverage,
            positionPriceImpactDeltaUsd: BigNumber.from(0),
            swapUiFeeUsd: BigNumber.from(0),
            positionFeeUsd: BigNumber.from(0),
            feeDiscountUsd: BigNumber.from(0),
            uiFeeUsd: BigNumber.from(0),
            collateralDeltaUsd: BigNumber.from(0),
            acceptablePriceDeltaBps: BigNumber.from(0),
        }

        values.indexPrice = getMarkPrice({ prices: toToken.prices, isIncrease: true, isLong: true});
        values.initialCollateralPrice = fromToken.prices.minPrice;
        values.collateralPrice = collateralToken.prices.minPrice;

        if (!values.indexPrice.gt(0) || !values.initialCollateralPrice.gt(0) || !values.collateralPrice.gt(0)) {
            return values;
        }

        values.initialCollateralAmount = fromTokenAmount;
        values.initialCollateralUsd = convertToUsd(
            fromTokenAmount,
            fromToken.decimals,
            values.initialCollateralPrice
        )

        const swapAmounts = getSwapAmountsByFromValue({
            tokenIn: fromToken,
            tokenOut: collateralToken,
            amountIn: fromTokenAmount,
            isLimit: false,
            findSwapPath: swapRoute.findSwapPath,
            uiFeeFactor: uiFeeFactor
        });

        values.swapPathStats = swapAmounts.swapPathStats;

        const baseCollateralUsd = convertToUsd(swapAmounts.amountOut, collateralToken.decimals, values.collateralPrice);
        const baseSizeDeltaUsd = baseCollateralUsd.mul(leverage).div(BASIS_POINTS_DIVISOR);
        const basePriceImpactDeltaUsd = getPriceImpactForPosition(marketInfo, baseSizeDeltaUsd, true);
        const basePositionFeeInfo = getPositionFee(
            marketInfo,
            baseSizeDeltaUsd,
            basePriceImpactDeltaUsd.gt(0),
            null
        );
        const baseUiFeeUsd = applyFactor(baseSizeDeltaUsd, uiFeeFactor);
        const totalSwapVolumeUsd = getTotalSwapVolumeFromSwapStats(values.swapPathStats?.swapSteps);
        values.swapUiFeeUsd = applyFactor(totalSwapVolumeUsd, uiFeeFactor);

        values.sizeDeltaUsd = baseCollateralUsd
        .sub(basePositionFeeInfo.positionFeeUsd)
        .sub(baseUiFeeUsd)
        .sub(values.swapUiFeeUsd)
        .mul(leverage)
        .div(BASIS_POINTS_DIVISOR);

        values.indexTokenAmount = convertToTokenAmount(values.sizeDeltaUsd, toToken.decimals, values.indexPrice);

        const positionFeeInfo = getPositionFee(
            marketInfo,
            values.sizeDeltaUsd,
            basePriceImpactDeltaUsd.gt(0),
            null
        );
        values.positionFeeUsd = positionFeeInfo.positionFeeUsd;
        values.feeDiscountUsd = positionFeeInfo.discountUsd;
        values.uiFeeUsd = applyFactor(values.sizeDeltaUsd, uiFeeFactor);

        values.collateralDeltaUsd = baseCollateralUsd
        .sub(values.positionFeeUsd)
        .sub(values.uiFeeUsd)
        .sub(values.swapUiFeeUsd);

        values.collateralDeltaAmount = convertToTokenAmount(
            values.collateralDeltaUsd,
            collateralToken.decimals,
            values.collateralPrice
        );

        const acceptablePriceInfo = getAcceptablePriceInfo({
            marketInfo,
            isIncrease: true,
            isLong: true,
            indexPrice: values.indexPrice,
            sizeDeltaUsd: values.sizeDeltaUsd,
          });
        
        values.positionPriceImpactDeltaUsd = acceptablePriceInfo.priceImpactDeltaUsd;
        values.acceptablePrice = acceptablePriceInfo.acceptablePrice;
        values.acceptablePriceDeltaBps = acceptablePriceInfo.acceptablePriceDeltaBps;

        let priceImpactAmount = BigNumber.from(0);

        if (values.positionPriceImpactDeltaUsd.gt(0)) {
            const price = toToken.prices.maxPrice;
            priceImpactAmount = convertToTokenAmount(values.positionPriceImpactDeltaUsd, toToken.decimals, price);
        } else {
            const price = toToken.prices.minPrice;
            priceImpactAmount = convertToTokenAmount(values.positionPriceImpactDeltaUsd, toToken.decimals, price);
        }

        values.sizeDeltaInTokens = convertToTokenAmount(values.sizeDeltaUsd, toToken.decimals, values.indexPrice);
        values.sizeDeltaInTokens = values.sizeDeltaInTokens.add(priceImpactAmount);

        return values;
    }, [
        collateralToken,
        fromTokenAmount,
        fromToken,
        leverage,
        tokensData,
        marketInfo,
        swapRoute.findSwapPath,
        toToken,
        uiFeeFactor
    ]);

    const executionFee = useMemo(() => {
        if (!increaseAmounts || !gasLimits || !gasPrice || !chainId || !tokensData) return undefined;

        const estimatedGas = estimateExecuteIncreaseOrderGasLimit(gasLimits, {
            swapsCount: increaseAmounts.swapPathStats?.swapPath.length,
        });

        return getExecutionFee(chainId, gasLimits, tokensData, estimatedGas, gasPrice);
    }, [chainId, gasLimits, increaseAmounts, gasPrice, tokensData])

    const { tokensAllowanceData } = useTokensAllowanceData(chainId, {
        spenderAddress: getContract(chainId, "SyntheticsRouter"),
        tokenAddresses: fromToken ? [fromToken.address] : [],
        skip: false,
    });

    const needPayTokenApproval =
        tokensAllowanceData &&
        fromToken &&
        increaseAmounts?.initialCollateralAmount &&
        getNeedTokenApprove(tokensAllowanceData, fromToken.address, increaseAmounts.initialCollateralAmount);

    const onConfirm = async () => {
        if (!tokensData || !marketInfo || !increaseAmounts || !signer || !collateralToken || !increaseAmounts.acceptablePrice || !executionFee) return;

        return createIncreaseOrderTxn(chainId, signer, {
            account,
            marketAddress: marketInfo.marketTokenAddress,
            initialCollateralAddress: fromToken?.address,
            initialCollateralAmount: increaseAmounts.initialCollateralAmount,
            targetCollateralAddress: collateralToken.address,
            collateralDeltaAmount: increaseAmounts.collateralDeltaAmount,
            swapPath: increaseAmounts.swapPathStats?.swapPath || [],
            sizeDeltaUsd: increaseAmounts.sizeDeltaUsd,
            sizeDeltaInTokens: increaseAmounts.sizeDeltaInTokens,
            acceptablePrice: increaseAmounts.acceptablePrice,
            isLong: true,
            orderType: 2,
            executionFee: executionFee.feeTokenAmount,
            allowedSlippage: config.allowedSlippage,
            indexToken: marketInfo.indexToken,
            tokensData
        })
    }

    const onApprove = async () => {
        if (!account || !signer || !fromToken) return;

        const exchangeRouter = getContract(chainId, "SyntheticsRouter");
        return approveTokens({signer, tokenAddress: fromToken.address, spender: exchangeRouter})
    }

    const onConnect = () => {
        openConnectModal();
    }
    return (
        <div className='trade-container'>
            <div className='trade-box'>
                <div className='title'>
                    GMX Long Buy Order
                </div>
                <Divider />
                <InfoRow label={'Wallet Address'} value={formatAddress(account)}></InfoRow>
                <Divider />
                <Input value={fromAmount} setValue={setFromAmount} priceText={'Pay'} priceValue={`${fromUsd ? formatUsd(fromUsd) : ""}`} balanceText={'Balance'} balanceValue={fromToken ? formatTokenAmount(fromToken.balance, fromToken.decimals, "", { useCommas: true}) : ""} coinText={fromToken ? fromToken.symbol : ''}></Input>
                <Input value={`${increaseAmounts? formatTokenAmount(increaseAmounts.sizeDeltaInTokens, toToken.decimals, '') : ''}`} setValue={()=>{}} priceText={'Long'} priceValue={`${increaseAmounts? formatUsd(increaseAmounts.sizeDeltaUsd, { fallbackToZero: true }) : ""}`} balanceText={'Leverage'} balanceValue={`${formatAmount(leverage, 4, 2)}x`} coinText={toToken ? toToken.symbol : ''} readOnly={true}></Input>
                <Divider />
                <InfoRow label={'Leverage'} value={`${formatAmount(leverage, 4, 2)}x`}></InfoRow>
                <Divider />
                <InfoRow label={'Entry Price'} value={`${toToken ? formatUsd(toToken.prices.minPrice) : ""}`}></InfoRow>
                <InfoRow label={'Accept. Price'} value={`${increaseAmounts? formatUsd(increaseAmounts.acceptablePrice, {fallbackToZero: true}) : ""}`}></InfoRow>
                <Divider />
                
                <Button onClick={onApprove} hidden={!active || !account || !needPayTokenApproval}>Approve</Button>
                <Button onClick={active && account? onConfirm : onConnect}>{active && account? 'Place Buy Order': 'Connect Wallet'}</Button>
            </div>
        </div>
    )
}
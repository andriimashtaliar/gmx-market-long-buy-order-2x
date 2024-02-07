import ExchangeRouter from "abis/ExchangeRouter.json";
import { getContract } from "config/contracts";
import { NATIVE_TOKEN_ADDRESS, convertTokenAddress } from "config/tokens";
import { convertToContractPrice } from "hooks/tokens";
import { BigNumber, ethers } from "ethers";
import { callContract } from "lib/callContract";
import { applySlippageToPrice } from "hooks/trade";

const { AddressZero } = ethers.constants;

export async function createIncreaseOrderTxn(chainId, signer, p) {
  const isNativePayment = p.initialCollateralAddress === NATIVE_TOKEN_ADDRESS;

  const exchangeRouter = new ethers.Contract(getContract(chainId, "ExchangeRouter"), ExchangeRouter.abi, signer);
  const router = exchangeRouter;
  const orderVaultAddress = getContract(chainId, "OrderVault");
  const wntCollateralAmount = isNativePayment ? p.initialCollateralAmount : BigNumber.from(0);
  const totalWntAmount = wntCollateralAmount.add(p.executionFee);
  const initialCollateralTokenAddress = convertTokenAddress(chainId, p.initialCollateralAddress, "wrapped");
  const shouldApplySlippage = true;
  const acceptablePrice = shouldApplySlippage
    ? applySlippageToPrice(p.allowedSlippage, p.acceptablePrice, true, p.isLong)
    : p.acceptablePrice;

  const encodedPayload = await createEncodedPayload({
    router,
    orderVaultAddress,
    totalWntAmount,
    p,
    acceptablePrice,
    subaccount: null,
    isNativePayment,
    initialCollateralTokenAddress,
    signer,
  });
 
  const primaryPriceOverrides = {};

  if (p.triggerPrice) {
    primaryPriceOverrides[p.indexToken.address] = {
      minPrice: p.triggerPrice,
      maxPrice: p.triggerPrice,
    };
  }

  const txn = await callContract(chainId, router, "multicall", [encodedPayload], {
    value: totalWntAmount,
    hideSentMsg: true,
    hideSuccessMsg: true,
    setPendingTxns: p.setPendingTxns,
  });

  return txn;
}

async function createEncodedPayload({
  router,
  orderVaultAddress,
  totalWntAmount,
  p,
  acceptablePrice,
  subaccount,
  isNativePayment,
  initialCollateralTokenAddress,
  signer,
}) {
  const orderParams = createOrderParams({
    p,
    acceptablePrice,
    initialCollateralTokenAddress,
    subaccount,
    isNativePayment,
  });

  console.log("Order Vault Address ----", orderVaultAddress);
  console.log("Total Wnt Amount -----", totalWntAmount);
  console.log("initial collateral Address -----", p.initialCollateralAddress);
  console.log("initial collateral amount -----", p.initialCollateralAmount);
  console.log("Order Params -----", orderParams);
  const multicall = [
    { method: "sendWnt", params: [orderVaultAddress, totalWntAmount] },

    !isNativePayment && !subaccount
      ? { method: "sendTokens", params: [p.initialCollateralAddress, orderVaultAddress, p.initialCollateralAmount] }
      : undefined,

    {
      method: "createOrder",
      params: subaccount ? [await signer.getAddress(), orderParams] : [orderParams],
    },
  ];
  return multicall.filter(Boolean).map((call) => router.interface.encodeFunctionData(call.method, call.params));
}

function createOrderParams({
  p,
  acceptablePrice,
  initialCollateralTokenAddress,
  subaccount,
  isNativePayment,
}) {
  return {
    addresses: {
      receiver: p.account,
      initialCollateralToken: initialCollateralTokenAddress,
      callbackContract: AddressZero,
      market: p.marketAddress,
      swapPath: p.swapPath,
      uiFeeReceiver: ethers.constants.AddressZero,
    },
    numbers: {
      sizeDeltaUsd: p.sizeDeltaUsd,
      initialCollateralDeltaAmount: subaccount ? p.initialCollateralAmount : BigNumber.from(0),
      triggerPrice: convertToContractPrice(p.triggerPrice || BigNumber.from(0), p.indexToken.decimals),
      acceptablePrice: convertToContractPrice(acceptablePrice, p.indexToken.decimals),
      executionFee: p.executionFee,
      callbackGasLimit: BigNumber.from(0),
      minOutputAmount: BigNumber.from(0),
    },
    orderType: p.orderType,
    decreasePositionSwapType: 0,
    isLong: p.isLong,
    shouldUnwrapNativeToken: isNativePayment,
    referralCode: ethers.constants.HashZero,
  };
}

import { EXECUTION_FEE_CONFIG_V2, GAS_PRICE_ADJUSTMENT_MAP } from "config/chains";
import { BASIS_POINTS_DIVISOR, bigNumberify } from "lib/numbers";
import { getProvider } from "lib/rpc";
import useWallet from "hooks/wallet/useWallet";
import useSWR from "swr";

export function useGasPrice(chainId) {
  const { signer } = useWallet();

  const executionFeeConfig = EXECUTION_FEE_CONFIG_V2[chainId];

  const { data: gasPrice } = useSWR(
    ["gasPrice", chainId, executionFeeConfig.shouldUseMaxPriorityFeePerGas],
    {
      fetcher: () => {
        return new Promise(async (resolve, reject) => {
          const provider = getProvider(signer, chainId);

          if (!provider) {
            resolve(undefined);
            return;
          }

          try {
            let gasPrice = await provider.getGasPrice();

            if (executionFeeConfig.shouldUseMaxPriorityFeePerGas) {
              const feeData = await provider.getFeeData();

              // the wallet provider might not return maxPriorityFeePerGas in feeData
              // in which case we should fallback to the usual getGasPrice flow handled below
              if (feeData && feeData.maxPriorityFeePerGas) {
                gasPrice = gasPrice.add(feeData.maxPriorityFeePerGas);
              }
            }

            const buffer = gasPrice.mul(1000).div(BASIS_POINTS_DIVISOR);
            gasPrice = gasPrice.add(buffer);
            const premium = GAS_PRICE_ADJUSTMENT_MAP[chainId] || bigNumberify(0);

            resolve(gasPrice.add(premium));
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error(e);
            reject(e);
          }
        });
      },
    }
  );

  return { gasPrice };
}

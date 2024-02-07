import { getContract } from "config/contracts";
import DataStore from "abis/DataStore.json";
import { useMulticall } from "hooks/multicall";
import { uiFeeFactorKey } from "config/dataStore";
import { BigNumber } from "ethers";

export function useUiFeeFactor(chainId, account = null) {
  const { data: uiFeeFactorForAccount } = useMulticall(chainId, "uiFeeFactorForAccount", {
    key: account ? [account] : null,
    refreshInterval: 60000,
    request: () => ({
      dataStore: {
        contractAddress: getContract(chainId, "DataStore"),
        abi: DataStore.abi,
        calls: {
          keys: {
            methodName: "getUint",
            params: [uiFeeFactorKey(account)],
          },
        },
      },
    }),
    parseResponse: (res) => {
      return BigNumber.from(res.data.dataStore.keys.returnValues[0]);
    },
  });

  return uiFeeFactorForAccount || BigNumber.from(0);
}

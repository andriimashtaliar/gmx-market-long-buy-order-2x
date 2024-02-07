import CustomErrors from "abis/CustomErrors.json";
import { ARBITRUM, ARBITRUM_GOERLI, AVALANCHE, AVALANCHE_FUJI, getFallbackRpcUrl, getRpcUrl } from "config/chains";
import { createPublicClient, http } from "viem";
import { arbitrum, arbitrumGoerli, avalanche, avalancheFuji } from "viem/chains";

import { sleep } from "lib/sleep";

export const MAX_TIMEOUT = 20000;

const CHAIN_BY_CHAIN_ID = {
  [AVALANCHE_FUJI]: avalancheFuji,
  [ARBITRUM_GOERLI]: arbitrumGoerli,
  [ARBITRUM]: arbitrum,
  [AVALANCHE]: avalanche,
};

const BATCH_CONFIGS = {
  [ARBITRUM]: {
    http: {
      batchSize: 0, // disable batches, here batchSize is the number of eth_calls in a batch
      wait: 0, // keep this setting in case batches are enabled in future
    },
    client: {
      multicall: {
        batchSize: 1024 * 1024, // here batchSize is the number of bytes in a multicall
        wait: 0, // zero delay means formation of a batch in the current macro-task, like setTimeout(fn, 0)
      },
    },
  },
  [AVALANCHE]: {
    http: {
      batchSize: 0,
      wait: 0,
    },
    client: {
      multicall: {
        batchSize: 1024 * 1024,
        wait: 0,
      },
    },
  },
  [AVALANCHE_FUJI]: {
    http: {
      batchSize: 40,
      wait: 0,
    },
    client: {
      multicall: {
        batchSize: 1024 * 1024,
        wait: 0,
      },
    },
  },
  [ARBITRUM_GOERLI]: {
    http: {
      batchSize: 0,
      wait: 0,
    },
    client: {
      multicall: {
        batchSize: 1024 * 1024,
        wait: 0,
      },
    },
  },
};

export async function executeMulticall(
  chainId,
  signer,
  request
) {
  const multicall = await Multicall.getInstance(chainId);

  return multicall?.call(request, MAX_TIMEOUT);
}

export class Multicall {
  static instances = {};

  static async getInstance(chainId) {
    let instance = Multicall.instances[chainId];

    if (!instance || instance.chainId !== chainId) {
      const rpcUrl = getRpcUrl(chainId);

      if (!rpcUrl) {
        return undefined;
      }

      instance = new Multicall(chainId, rpcUrl);

      Multicall.instances[chainId] = instance;
    }

    return instance;
  }

  static getViemClient(chainId, rpcUrl) {
    return createPublicClient({
      transport: http(rpcUrl, {
        // retries works strangely in viem, so we disable them
        retryCount: 0,
        retryDelay: 10000000,
        batch: BATCH_CONFIGS[chainId].http,
      }),
      pollingInterval: undefined,
      batch: BATCH_CONFIGS[chainId].client,
      chain: CHAIN_BY_CHAIN_ID[chainId],
    });
  }

  viemClient = null;

  constructor(chainId, rpcUrl) {
    this.viemClient = Multicall.getViemClient(chainId, rpcUrl);
  }

  async call(request, maxTimeout) {
    const originalKeys = [];

    const abis = {};

    const encodedPayload = [];

    const contractKeys = Object.keys(request);

    contractKeys.forEach((contractKey) => {
      const contractCallConfig = request[contractKey];

      if (!contractCallConfig) {
        return;
      }

      Object.keys(contractCallConfig.calls).forEach((callKey) => {
        const call = contractCallConfig.calls[callKey];

        if (!call) {
          return;
        }

        // Add Errors ABI to each contract ABI to correctly parse errors
        abis[contractCallConfig.contractAddress] =
          abis[contractCallConfig.contractAddress] || contractCallConfig.abi.concat(CustomErrors.abi);

        const abi = abis[contractCallConfig.contractAddress];

        originalKeys.push({
          contractKey,
          callKey,
        });

        encodedPayload.push({
          address: contractCallConfig.contractAddress,
          functionName: call.methodName,
          abi,
          args: call.params,
        });
      });
    });

    const response = await Promise.race([
      this.viemClient.multicall({ contracts: encodedPayload }),
      sleep(maxTimeout).then(() => Promise.reject(new Error("multicall timeout"))),
    ]).catch((_viemError) => {
      const e = new Error(_viemError.message.slice(0, 150));

      // eslint-disable-next-line no-console
      console.groupCollapsed("multicall error:");
      // eslint-disable-next-line no-console
      console.error(e);
      // eslint-disable-next-line no-console
      console.groupEnd();

      const rpcUrl = getFallbackRpcUrl(this.chainId);

      if (!rpcUrl) {
        throw e;
      }

      const fallbackClient = Multicall.getViemClient(this.chainId, rpcUrl);

      // eslint-disable-next-line no-console
      console.log(`using multicall fallback for chain ${this.chainId}`);

      return fallbackClient.multicall({ contracts: encodedPayload }).catch((_viemError) => {
        const e = new Error(_viemError.message.slice(0, 150));
        // eslint-disable-next-line no-console
        console.groupCollapsed("multicall fallback error:");
        // eslint-disable-next-line no-console
        console.error(e);
        // eslint-disable-next-line no-console
        console.groupEnd();

        throw e;
      });
    });

    const multicallResult = {
      success: true,
      errors: {},
      data: {},
    };

    response.forEach(({ result, status, error }, i) => {
      const { contractKey, callKey } = originalKeys[i];

      if (status === "success") {
        let values;

        if (Array.isArray(result) || typeof result === "object") {
          values = result;
        } else {
          values = [result];
        }

        multicallResult.data[contractKey] = multicallResult.data[contractKey] || {};
        multicallResult.data[contractKey][callKey] = {
          contractKey,
          callKey,
          returnValues: values,
          success: true,
        };
      } else {
        multicallResult.success = false;

        multicallResult.errors[contractKey] = multicallResult.errors[contractKey] || {};
        multicallResult.errors[contractKey][callKey] = error;

        multicallResult.data[contractKey] = multicallResult.data[contractKey] || {};
        multicallResult.data[contractKey][callKey] = {
          contractKey,
          callKey,
          returnValues: [],
          success: false,
          error: error,
        };
      }
    });

    return multicallResult;
  }
}

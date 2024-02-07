import {
  ARBITRUM,
  ARBITRUM_GOERLI,
  AVALANCHE,
  AVALANCHE_FUJI,
  FALLBACK_PROVIDERS,
  getAlchemyWsUrl,
  getFallbackRpcUrl,
  getRpcUrl,
} from "config/chains";
import { ethers } from "ethers";
import { useEffect, useState } from "react";

export function getProvider(signer, chainId) {
  let provider;

  if (signer) {
    return signer;
  }

  provider = getRpcUrl(chainId);

  return new ethers.providers.StaticJsonRpcProvider(
    provider,
    // @ts-ignore incorrect Network param types
    { chainId }
  );
}

export function getWsProvider(chainId) {
  if (chainId === ARBITRUM) {
    return new ethers.providers.WebSocketProvider(getAlchemyWsUrl());
  }

  if (chainId === AVALANCHE) {
    return new ethers.providers.WebSocketProvider("wss://api.avax.network/ext/bc/C/ws");
  }

  if (chainId === ARBITRUM_GOERLI) {
    return new ethers.providers.WebSocketProvider("wss://arb-goerli.g.alchemy.com/v2/cZfd99JyN42V9Clbs_gOvA3GSBZH1-1j");
  }

  if (chainId === AVALANCHE_FUJI) {
    const provider = new ethers.providers.JsonRpcProvider(getRpcUrl(AVALANCHE_FUJI));
    provider.pollingInterval = 2000;
    return provider;
  }
}

export function getFallbackProvider(chainId) {
  if (!FALLBACK_PROVIDERS[chainId]) {
    return;
  }

  const provider = getFallbackRpcUrl(chainId);

  return new ethers.providers.StaticJsonRpcProvider(
    provider,
    // @ts-ignore incorrect Network param types
    { chainId }
  );
}

export function useJsonRpcProvider(chainId) {
  const [provider, setProvider] = useState();

  useEffect(() => {
    async function initializeProvider() {
      const rpcUrl = getRpcUrl(chainId);

      if (!rpcUrl) return;

      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

      await provider.ready;

      setProvider(provider);
    }

    initializeProvider();
  }, [chainId]);

  return { provider };
}
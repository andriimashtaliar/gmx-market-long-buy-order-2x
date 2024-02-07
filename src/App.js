import React from 'react'
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { SWRConfig } from "swr";
import { swrGCMiddleware } from "lib/swrMiddlewares";

import { WagmiConfig, createClient, configureChains } from 'wagmi'
import { arbitrum } from 'wagmi/chains'
import { publicProvider } from "wagmi/providers/public";

import {
  safeWallet,
  rabbyWallet,
  injectedWallet,
  metaMaskWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";

import { RainbowKitProvider, connectorsForWallets } from '@rainbow-me/rainbowkit';

import { Trade } from './pages/Trade';
import './App.css';
import '@rainbow-me/rainbowkit/styles.css';

const WALLET_CONNECT_PROJECT_ID = "de24cddbaf2a68f027eae30d9bb5df58";

const { chains, provider } = configureChains(
  [arbitrum],
  [publicProvider()]
);

const recommendedWalletList = [
  {
    groupName: "Recommended",
    wallets: [
      injectedWallet({ chains }),
      safeWallet({ chains }),
      rabbyWallet({ chains }),
      metaMaskWallet({ chains, projectId: WALLET_CONNECT_PROJECT_ID }),
      walletConnectWallet({ chains, projectId: WALLET_CONNECT_PROJECT_ID }),
    ],
  },
];

const connectors = connectorsForWallets(recommendedWalletList);

const wagmiClient = createClient({
  autoConnect: true, 
  connectors,
  provider 
})

const App = () => {
  return (
    <div className="App">
      <SWRConfig value={{ refreshInterval: 5000, refreshWhenHidden: false, refreshWhenOffline: false, use: [swrGCMiddleware] }}>
        <WagmiConfig client={wagmiClient}>
          <RainbowKitProvider chains={chains} modalSize="compact">
            <Router>
              <Routes>
                <Route path="/" Component={Trade} />
              </Routes>
            </Router>
          </RainbowKitProvider>
        </WagmiConfig>
      </SWRConfig>
    </div>
  );
}

export default App;
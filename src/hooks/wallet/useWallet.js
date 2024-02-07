import { useAccount, useNetwork, useSigner } from "wagmi";

export default function useWallet() {
  const { address, isConnected, connector } = useAccount();
  const { chain } = useNetwork();
  const { data: signer } = useSigner();

  return {
    account: address,
    active: isConnected,
    connector,
    chainId: chain?chain.id : 42161,
    signer: signer ?? undefined,
  };
}

import { ethers } from "ethers";
import Token from "abis/Token.json";

export async function approveTokens({
  signer,
  tokenAddress,
  spender
}) {
  const contract = new ethers.Contract(tokenAddress, Token.abi, signer);
  try {
    await contract.approve(spender, ethers.constants.MaxUint256);
  } catch(e) {
    console.log(e);
  }
}

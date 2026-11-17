import { getAddress, isAddress, type Address } from "viem";
import { foundry, mainnet, sepolia } from "viem/chains";
import { MarketError } from "./errors";

export function readMarketConfig(env: NodeJS.ProcessEnv) {
  if (!env.MARKET_ADDRESS) return null;
  const chainId = Number(env.MARKET_CHAIN_ID);
  const chain = chainId === 1 ? mainnet : chainId === 11155111 ? sepolia
    : chainId === 31337 && env.NODE_ENV !== "production" ? foundry : null;
  if (!chain || !isAddress(env.MARKET_ADDRESS, { strict: false }) || !env.MARKET_RPC_URL ||
      (chainId !== 1 && !env.MARKET_INDEXER_URL)) {
    throw new MarketError("Trading is temporarily unavailable.");
  }
  const indexerUrl = env.MARKET_INDEXER_URL ?? "https://api.ethscriptions.com/v2";
  for (const raw of [env.MARKET_RPC_URL, indexerUrl]) {
    let url: URL;
    try { url = new URL(raw); } catch { throw new MarketError("Trading is temporarily unavailable."); }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local && env.NODE_ENV !== "production")) {
      throw new MarketError("Trading is temporarily unavailable.");
    }
  }
  return { address: getAddress(env.MARKET_ADDRESS) as Address, chain, rpcUrl: env.MARKET_RPC_URL, indexerUrl };
}

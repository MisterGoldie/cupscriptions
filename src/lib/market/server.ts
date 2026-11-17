import "server-only";
import { createPublicClient, http, type Hex, type PrivateKeyAccount, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readMarketConfig } from "./config";
import { createMarketIndexer } from "./indexer";
import { createMarketService } from "./service";

let service: ReturnType<typeof createMarketService> | null | undefined;

export function getMarketService() {
  if (service !== undefined) return service;
  const config = readMarketConfig(process.env);
  if (!config) return null;
  let signer: PrivateKeyAccount | null = null;
  const key = process.env.MARKET_VERIFIER_PRIVATE_KEY;
  if (key && /^0x[0-9a-fA-F]{64}$/.test(key)) {
    try { signer = privateKeyToAccount(key as Hex); } catch { /* Read/withdraw operations remain available. */ }
  }
  const client = createPublicClient({ chain: config.chain, transport: http(config.rpcUrl, { timeout: 12_000, retryCount: 1 }), cacheTime: 0 });
  service = createMarketService(config, client as PublicClient, createMarketIndexer(config.indexerUrl), signer);
  return service;
}

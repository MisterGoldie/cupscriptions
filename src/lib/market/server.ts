import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http, isAddress, type Hex, type PrivateKeyAccount, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readMarketConfig } from "./config";
import { createMarketIndexer } from "./indexer";
import { createMarketService } from "./service";

let service: ReturnType<typeof createMarketService> | null | undefined;
let serviceConfigKey: string | undefined;

export function getMarketService() {
  let env = process.env;
  // A verified public deployment record activates only the isolated local
  // Sepolia preview. Production configuration never reads this local file.
  if (env.NODE_ENV === "development" && env.CUPSCRIPTIONS_SEPOLIA_PREVIEW === "1") {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".sepolia/deployment.json"), "utf8"));
      if (record.chainId !== 11155111 || !isAddress(record.address, { strict: false })) throw new Error("Invalid local deployment");
      env = { ...env, MARKET_ADDRESS: record.address, MARKET_CHAIN_ID: "11155111" };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Local deployment configuration could not be verified"); }
  }
  const config = readMarketConfig(env);
  if (!config) return null;
  let signer: PrivateKeyAccount | null = null;
  const key = process.env.MARKET_VERIFIER_PRIVATE_KEY;
  if (key && /^0x[0-9a-fA-F]{64}$/.test(key)) {
    try { signer = privateKeyToAccount(key as Hex); } catch { /* Read/withdraw operations remain available. */ }
  }
  const configKey = JSON.stringify([config.chain.id, config.address, config.rpcUrl, config.indexerUrl, signer?.address ?? null]);
  if (service !== undefined && serviceConfigKey === configKey) return service;
  const client = createPublicClient({ chain: config.chain, transport: http(config.rpcUrl, { timeout: 12_000, retryCount: 1 }), cacheTime: 0 });
  service = createMarketService(config, client as PublicClient, createMarketIndexer(config.indexerUrl, fetch, config.chain.id), signer);
  serviceConfigKey = configKey;
  return service;
}

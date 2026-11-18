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
  // Verified public deployment records activate only isolated local previews.
  // Direct NODE_ENV guards let production builds eliminate these file reads.
  if (process.env.NODE_ENV === "development" && env.CUPSCRIPTIONS_MAINNET_PREVIEW === "1" && env.CUPSCRIPTIONS_SEPOLIA_PREVIEW === "1") throw new Error("Conflicting local trading networks");
  if (process.env.NODE_ENV === "development" && (env.CUPSCRIPTIONS_SEPOLIA_PREVIEW === "1" || env.CUPSCRIPTIONS_MAINNET_PREVIEW === "1")) {
    const mainnetPreview = env.CUPSCRIPTIONS_MAINNET_PREVIEW === "1";
    const expectedChain = mainnetPreview ? 1 : 11155111;
    try {
      const record = JSON.parse(mainnetPreview
        ? fs.readFileSync(path.join(process.cwd(), ".mainnet", "deployment.json"), "utf8")
        : fs.readFileSync(path.join(process.cwd(), ".sepolia", "deployment.json"), "utf8"));
      if (record.chainId !== expectedChain || !isAddress(record.address, { strict: false })) throw new Error("Invalid local deployment");
      env = { ...env, MARKET_ADDRESS: record.address, MARKET_CHAIN_ID: String(expectedChain) };
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

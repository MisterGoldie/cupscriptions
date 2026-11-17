import "./env.mjs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

// Dedicated preview variables keep an existing mainnet MARKET_ADDRESS/key from
// accidentally being reused when starting the test collection.
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", ...process.argv.slice(2)], {
  stdio: "inherit", windowsHide: true,
  env: { ...process.env, CUPSCRIPTIONS_SEPOLIA_PREVIEW: "1", MARKET_CHAIN_ID: "11155111", MARKET_ADDRESS: process.env.SEPOLIA_MARKET_ADDRESS ?? "",
    MARKET_VERIFIER_PRIVATE_KEY: process.env.SEPOLIA_VERIFIER_PRIVATE_KEY ?? "",
    MARKET_RPC_URL: process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
    MARKET_INDEXER_URL: process.env.SEPOLIA_INDEXER_URL ?? `http://127.0.0.1:${process.env.SEPOLIA_INDEXER_PORT ?? "3031"}` },
});
child.on("error", () => { console.error("Could not start the Sepolia preview."); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });

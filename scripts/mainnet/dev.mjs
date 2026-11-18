import "../sepolia/env.mjs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", ...process.argv.slice(2)], {
  stdio: "inherit", windowsHide: true,
  env: { ...process.env, CUPSCRIPTIONS_MAINNET_PREVIEW: "1", CUPSCRIPTIONS_SEPOLIA_PREVIEW: "0", MARKET_CHAIN_ID: "1",
    MARKET_ADDRESS: process.env.MAINNET_MARKET_ADDRESS ?? "", MARKET_VERIFIER_PRIVATE_KEY: process.env.MAINNET_VERIFIER_PRIVATE_KEY ?? "",
    MARKET_RPC_URL: process.env.MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com",
    MARKET_INDEXER_URL: process.env.MAINNET_INDEXER_URL ?? "https://api.ethscriptions.com/v2" },
});
child.on("error", () => { console.error("Could not start the mainnet deployment preview."); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });

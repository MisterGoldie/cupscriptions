import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";

// Explicit operator command. Never called by a web route or a build.
let stage = "check-git-ignore";
try {
  if (spawnSync("git", ["check-ignore", "--quiet", "--", ".env.local"], { stdio: "ignore" }).status !== 0 ||
      spawnSync("git", ["ls-files", "--error-unmatch", ".env.local"], { stdio: "ignore" }).status === 0) throw new Error("Unsafe environment path");
  stage = "read-protected-configuration";
  const original = await fs.readFile(".env.local", "utf8");
  const existing = original.match(/^MAINNET_VERIFIER_PRIVATE_KEY=(.*)$/m)?.[1]?.trim();
  if (existing !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(existing)) throw new Error("Existing mainnet key is invalid");
  const key = existing ?? generatePrivateKey();
  const account = privateKeyToAccount(key);
  const testKey = original.match(/^SEPOLIA_VERIFIER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m)?.[1];
  if (testKey && privateKeyToAccount(testKey).address === account.address) throw new Error("Mainnet needs a separate verifier");
  stage = "verify-signing";
  const message = "Cupscriptions mainnet verifier setup";
  const signature = await account.signMessage({ message });
  if ((await recoverMessageAddress({ message, signature })).toLowerCase() !== account.address.toLowerCase()) throw new Error("Signing failed");
  if (!existing) {
    stage = "append-mainnet-configuration";
    const values = { MAINNET_VERIFIER_PRIVATE_KEY: key, MAINNET_VERIFIER_ADDRESS: account.address, MAINNET_MARKET_ADDRESS: "",
      MAINNET_RPC_URL: "https://ethereum-rpc.publicnode.com", MAINNET_INDEXER_URL: "https://api.ethscriptions.com/v2" };
    const lines = Object.entries(values).filter(([name]) => !new RegExp(`^${name}=`, "m").test(original)).map(([name, value]) => `${name}=${value}`);
    await fs.appendFile(".env.local", `${original.endsWith("\n") ? "" : "\n"}\n# Dedicated Ethereum mainnet configuration. Server-only.\n${lines.join("\n")}\n`);
  }
  stage = "verify-saved-key";
  const saved = await fs.readFile(".env.local", "utf8");
  const savedKey = saved.match(/^MAINNET_VERIFIER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m)?.[1];
  if (!saved.startsWith(original) || !savedKey || privateKeyToAccount(savedKey).address !== account.address) throw new Error("Saved key mismatch");
  await fs.mkdir(".mainnet", { recursive: true });
  await fs.writeFile(".mainnet/verifier.json", JSON.stringify({ chainId: 1, address: account.address, purpose: "Cupscriptions mainnet ownership verifier",
    secretFile: ".env.local", secretVariable: "MAINNET_VERIFIER_PRIVATE_KEY" }, null, 2) + "\n");
  console.log(JSON.stringify({ created: !existing, address: account.address, savedTo: ".env.local", signingVerified: true, sepoliaPreserved: true }));
} catch (error) {
  console.error(JSON.stringify({ complete: false, stage, errorName: error.name, errorCode: error.code ?? null }));
  process.exitCode = 1;
}

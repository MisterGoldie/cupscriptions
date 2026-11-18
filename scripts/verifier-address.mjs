import { privateKeyToAccount } from "viem/accounts";

// Print only the public signer address. Never print the key or a library error
// that may include its input. This script does not generate keys or transact.
const variable = process.argv.includes("--mainnet") ? "MAINNET_VERIFIER_PRIVATE_KEY"
  : process.argv.includes("--sepolia") ? "SEPOLIA_VERIFIER_PRIVATE_KEY" : "MARKET_VERIFIER_PRIVATE_KEY";
try {
  const key = process.env[variable];
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error();
  console.log(privateKeyToAccount(key).address);
} catch {
  console.error(`${variable} is missing or invalid.`);
  process.exitCode = 1;
}

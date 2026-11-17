import "./env.mjs";
import path from "node:path";
import { stringToHex } from "viem";
import { atomicJson, owner, preparePlan, stateDir, testnetClient, requireSepolia } from "./setup.mjs";

try {
  const plan = await preparePlan();
  const client = testnetClient();
  await requireSepolia(client);
  const balance = await client.getBalance({ address: owner });
  const file = path.join(stateDir, "unsigned-transactions.json");
  await atomicJson(file, { chainId: 11155111, owner, transactions: plan.items.map((item) => ({
    number: item.number, from: owner, to: owner, value: "0", data: stringToHex(item.contentUri), chainId: 11155111,
  })) });
  console.log(`Prepared 3 unsigned Sepolia inscription transactions for ${owner}.`);
  console.log(`Test ETH balance: ${balance} wei. No transactions were signed or submitted.`);
  console.log(`Payloads: ${file}`);
} catch {
  console.error("Could not prepare the Sepolia plan. Check the Sepolia RPC and local setup files.");
  process.exitCode = 1;
}

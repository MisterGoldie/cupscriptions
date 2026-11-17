import "./env.mjs";
import { manifestTree, readManifest, registerCreation, testnetClient } from "./setup.mjs";

try {
  const number = Number(process.argv[2]), hash = process.argv[3];
  if (![1,2,3].includes(number) || !/^0x[0-9a-fA-F]{64}$/.test(hash ?? "")) throw new Error();
  await registerCreation(testnetClient(), number, hash);
  const tree = manifestTree(await readManifest());
  console.log(tree ? `Sepolia collection complete. Root: ${tree.root}` : `Registered test cup ${number}. Confirm the remaining creation transactions.`);
} catch {
  console.error("Creation was not registered. Check the cup number, exact prepared transaction, network and confirmations.");
  process.exitCode = 1;
}

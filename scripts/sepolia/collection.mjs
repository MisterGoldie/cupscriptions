import "./env.mjs";
import { manifestTree, readManifest, testnetClient, verifyCreation } from "./setup.mjs";

try {
  const manifest = await readManifest();
  const tree = manifestTree(manifest);
  if (!tree) throw new Error("Test creations are not complete");
  const plan = { owner: manifest.initialOwner, items: manifest.items };
  const client = testnetClient();
  await Promise.all(manifest.items.map((item) => verifyCreation(client, plan, item.number, item.ethscriptionId)));
  console.log(JSON.stringify({ chainId: 11155111, root: tree.root, count: 3,
    cups: manifest.items.map((item) => ({ number: item.number, ethscriptionId: item.ethscriptionId, proof: tree.proofFor(item.ethscriptionId) })),
  }, null, 2));
} catch {
  console.error("The Sepolia root is not ready. Create and confirm all three test cups in the local /sepolia page, then retry with a working Ethereum Sepolia RPC.");
  process.exitCode = 1;
}

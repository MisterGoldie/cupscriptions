import { createHash } from "node:crypto";
import { decodeEventLog, parseAbiItem, stringToHex, toEventSelector } from "viem";

export const transferEvents = [
  parseAbiItem("event ethscriptions_protocol_TransferEthscription(address indexed recipient, bytes32 indexed ethscriptionId)"),
  parseAbiItem("event ethscriptions_protocol_TransferEthscriptionForPreviousOwner(address indexed previousOwner, address indexed recipient, bytes32 indexed ethscriptionId)"),
];
const topics = transferEvents.map(toEventSelector);
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const quantity = (number) => `0x${number.toString(16)}`;

/** A collection-scoped Sepolia indexer, not a full-network inscription registry.
 * Seeds are newly-created, independently verified ESIP-6 image inscriptions.
 * Every block after the earliest creation is examined, including transfers
 * through arbitrary contracts, failed receipts, raw/bulk transfers and ESIP-2.
 * Readers see only committed complete blocks. No wallet/signing key is used.
 */
export function createSepoliaEngine({ client, loadManifest, saveState = async () => {}, initialState = null, maxBlocks = 64 }) {
  let state = null;
  let manifestFingerprint = null;
  let healthy = false;
  let lastChecked = 0;
  let inFlight = null;
  let waiting = true;

  async function validate(manifest) {
    if (manifest.version !== 1 || manifest.chainId !== 11155111 || manifest.items.length !== 3 ||
        new Set(manifest.items.map((item) => item.ethscriptionId.toLowerCase())).size !== 3) throw new Error("Invalid test collection");
    const head = await client.getBlockNumber({ cacheTime: 0 });
    for (const item of manifest.items) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(item.ethscriptionId) ||
          !item.contentUri.startsWith("data:image/svg+xml;rule=esip6;base64,") || Buffer.byteLength(item.contentUri) > 90_000) throw new Error("Invalid test inscription");
      const [tx, receipt, block] = await Promise.all([
        client.getTransaction({ hash: item.ethscriptionId }), client.getTransactionReceipt({ hash: item.ethscriptionId }),
        client.getBlock({ blockNumber: BigInt(item.creationBlock) }),
      ]);
      if (receipt.status !== "success" || !same(tx.hash, item.ethscriptionId) || !same(receipt.transactionHash, item.ethscriptionId) ||
          tx.input !== stringToHex(item.contentUri) || tx.value !== 0n ||
          !same(tx.from, manifest.initialOwner) || !same(tx.to, manifest.initialOwner) ||
          receipt.blockNumber !== BigInt(item.creationBlock) || tx.blockNumber !== receipt.blockNumber ||
          block.hash !== item.creationBlockHash || receipt.blockHash !== block.hash || tx.blockHash !== block.hash ||
          head < receipt.blockNumber + 1n) throw new Error("Unconfirmed or reorged test creation");
    }
  }

  function blank(manifest) {
    const first = manifest.items.reduce((min, item) => BigInt(item.creationBlock) < min ? BigInt(item.creationBlock) : min, BigInt(manifest.items[0].creationBlock));
    return { version: 1, chainId: 11155111, fingerprint: manifestFingerprint,
      lastBlock: (first - 1n).toString(), lastHash: null, records: {} };
  }

  function move(next, id, from, to, tx, block, transferIndex, logIndex = null, enforcedPreviousOwner = null) {
    const record = next.records[id.toLowerCase()];
    if (!record || !same(record.current_owner, from) ||
        (enforcedPreviousOwner && !same(record.previous_owner, enforcedPreviousOwner))) return;
    record.previous_owner = from.toLowerCase();
    record.current_owner = to.toLowerCase();
    record.ethscription_transfers.push({
      ethscription_transaction_hash: id.toLowerCase(), transaction_hash: tx.hash,
      from_address: from.toLowerCase(), to_address: to.toLowerCase(), block_number: block.number.toString(),
      block_timestamp: block.timestamp.toString(), block_blockhash: block.hash,
      transaction_index: String(tx.transactionIndex), transfer_index: String(transferIndex),
      event_log_index: logIndex, enforced_previous_owner: enforcedPreviousOwner,
    });
  }

  async function applyBlock(manifest, number) {
    const [block, logs] = await Promise.all([
      client.getBlock({ blockNumber: number, includeTransactions: true }),
      client.request({ method: "eth_getLogs", params: [{ fromBlock: quantity(number), toBlock: quantity(number), topics: [topics] }] }),
    ]);
    if (!block.hash || (state.lastHash && block.parentHash !== state.lastHash)) throw new Error("Chain changed during indexing");
    for (const item of manifest.items.filter((item) => BigInt(item.creationBlock) === number)) {
      if (block.hash !== item.creationBlockHash || !block.transactions.some((tx) => same(tx.hash, item.ethscriptionId))) {
        throw new Error("Test creation changed during indexing");
      }
    }
    const next = structuredClone(state);
    const seeds = new Map(manifest.items.map((item) => [item.ethscriptionId.toLowerCase(), item]));
    const grouped = new Map();
    for (const log of logs) {
      if (log.removed || log.blockHash !== block.hash) throw new Error("Unstable event block");
      const key = log.transactionHash.toLowerCase();
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(log);
    }
    for (const tx of block.transactions) {
      if (typeof tx === "string") throw new Error("Full transactions required");
      const seed = seeds.get(tx.hash.toLowerCase());
      if (seed && BigInt(seed.creationBlock) === number) {
        next.records[seed.ethscriptionId.toLowerCase()] = {
          transaction_hash: seed.ethscriptionId.toLowerCase(), block_number: number.toString(),
          transaction_index: String(tx.transactionIndex), block_timestamp: block.timestamp.toString(), block_blockhash: block.hash,
          creator: tx.from.toLowerCase(), initial_owner: tx.to.toLowerCase(), current_owner: tx.to.toLowerCase(), previous_owner: tx.from.toLowerCase(),
          content_uri: seed.contentUri, mimetype: "image/svg+xml", ethscription_number: null,
          ethscription_transfers: [{ ethscription_transaction_hash: seed.ethscriptionId.toLowerCase(), transaction_hash: tx.hash,
            from_address: tx.from.toLowerCase(), to_address: tx.to.toLowerCase(), block_number: number.toString(),
            block_timestamp: block.timestamp.toString(), block_blockhash: block.hash, transaction_index: String(tx.transactionIndex),
            transfer_index: "0", event_log_index: null, enforced_previous_owner: null }],
        };
      }
      let transferIndex = seed ? 1 : 0;
      const raw = tx.input.slice(2);
      const rawIds = raw.length > 0 && raw.length % 64 === 0 ? raw.match(/.{64}/g).map((part) => `0x${part.toLowerCase()}`) : [];
      if (tx.to && rawIds.some((id) => same(next.records[id]?.current_owner, tx.from))) {
        const receipt = await client.getTransactionReceipt({ hash: tx.hash });
        if (receipt.blockHash !== block.hash) throw new Error("Unstable transaction block");
        if (receipt.status === "success") for (const id of rawIds) move(next, id, tx.from, tx.to, tx, block, transferIndex++);
      }
      const transactionLogs = (grouped.get(tx.hash.toLowerCase()) ?? []).sort((a, b) => Number(BigInt(a.logIndex) - BigInt(b.logIndex)));
      for (const log of transactionLogs) {
        let event;
        try { event = decodeEventLog({ abi: transferEvents, data: log.data, topics: log.topics, strict: true }); }
        catch { continue; } // A malformed signature-shaped log is not a transfer.
        const { ethscriptionId, recipient, previousOwner } = event.args;
        move(next, ethscriptionId, log.address, recipient, tx, block, transferIndex++, Number(BigInt(log.logIndex)), previousOwner ?? null);
      }
    }
    if ((await client.getBlock({ blockNumber: number })).hash !== block.hash) throw new Error("Reorg during indexing");
    next.lastBlock = number.toString(); next.lastHash = block.hash;
    await saveState(next);
    state = next;
  }

  async function run() {
    if (await client.getChainId() !== 11155111) throw new Error("This indexer only accepts Ethereum Sepolia");
    const manifest = await loadManifest();
    if (manifest.chainId !== 11155111 || !Array.isArray(manifest.items)) throw new Error("Wrong manifest network");
    if (manifest.items.length === 0) { waiting = true; lastChecked = Date.now(); healthy = true; return; }
    waiting = false;
    const fingerprint = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
    if (fingerprint !== manifestFingerprint) {
      await validate(manifest);
      manifestFingerprint = fingerprint;
      state = initialState?.fingerprint === fingerprint ? structuredClone(initialState) : blank(manifest);
    }
    const head = await client.getBlockNumber({ cacheTime: 0 });
    if (state.lastHash && (BigInt(state.lastBlock) > head || (await client.getBlock({ blockNumber: BigInt(state.lastBlock) })).hash !== state.lastHash)) {
      await validate(manifest);
      state = blank(manifest);
    }
    for (let processed = 0; BigInt(state.lastBlock) < head && processed < maxBlocks; processed++) {
      await applyBlock(manifest, BigInt(state.lastBlock) + 1n);
    }
    lastChecked = Date.now(); healthy = true;
  }

  return {
    sync() {
      if (!inFlight) inFlight = run().catch((error) => { healthy = false; throw error; }).finally(() => { inFlight = null; });
      return inFlight;
    },
    async status() {
      if (!healthy || Date.now() - lastChecked > 30_000) throw new Error("Indexer is not healthy");
      if (await client.getChainId() !== 11155111) throw new Error("Wrong RPC network");
      const current = await client.getBlockNumber({ cacheTime: 0 });
      const imported = waiting ? 0n : BigInt(state.lastBlock);
      if (!waiting && (imported > current || (state.lastHash &&
          (await client.getBlock({ blockNumber: imported })).hash !== state.lastHash))) throw new Error("Chain changed; wait for replay");
      return { chain_id: 11155111, scope: "cupscriptions-sepolia-test-only", tracked_count: Object.keys(state?.records ?? {}).length,
        ready: !waiting && imported === current && Object.keys(state.records).length === 3, waiting_for_creations: waiting,
        current_block_number: current.toString(), last_imported_block: imported.toString(), blocks_behind: (current > imported ? current - imported : 0n).toString() };
    },
    async records() {
      const status = await this.status();
      if (!status.ready) throw new Error("Indexer is still syncing or waiting for test creations");
      return Object.values(state.records).sort((a, b) => Number(BigInt(b.block_number) - BigInt(a.block_number)) || Number(b.transaction_index) - Number(a.transaction_index));
    },
  };
}

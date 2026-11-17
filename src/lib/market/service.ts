import {
  getAddress, hexToBytes, isAddress, keccak256, type Address, type Hex,
  type PrivateKeyAccount, type PublicClient,
} from "viem";
import { marketAbi } from "./abi.generated";
import runtime from "./runtime.generated.json";
import { marketCollection } from "./collection";
import type { readMarketConfig } from "./config";
import { MarketError } from "./errors";
import { isHash, unsignedInteger, type IndexedCup, type MarketIndexer } from "./indexer";
import {
  COOLDOWN_BLOCKS, FEE_RECIPIENT, SALE_FEE, purchaseTypedData,
  type MarketCup, type MarketInfo, type MarketResponse, type PurchaseAuthorization, type SignedPurchase,
} from "./types";

type Config = NonNullable<ReturnType<typeof readMarketConfig>>;
type Snapshot = { number: bigint; hash: Hex; timestamp: bigint; market: MarketInfo };

const sameAddress = (a: string | null | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();

export function createMarketService(
  config: Config, client: PublicClient, indexer: MarketIndexer,
  signer: PrivateKeyAccount | null, clock: () => number = Date.now,
  collection = marketCollection(config.chain.id),
) {
  async function snapshot(): Promise<Snapshot> {
    if (await client.getChainId() !== config.chain.id) throw new MarketError("Trading network could not be verified.");
    const block = await client.getBlock();
    if (!block.number || !block.hash || Math.abs(clock() / 1000 - Number(block.timestamp)) > 120) {
      throw new MarketError("Trading network is still updating. Please try again.");
    }
    const read = <T extends "collectionRoot" | "ownershipVerifier" | "MARKETPLACE_FEE" | "feeRecipient">(functionName: T) =>
      client.readContract({ address: config.address, abi: marketAbi, functionName, blockNumber: block.number! });
    const [code, root, verifier, fee, recipient] = await Promise.all([
      client.getCode({ address: config.address, blockNumber: block.number }),
      read("collectionRoot"), read("ownershipVerifier"), read("MARKETPLACE_FEE"), read("feeRecipient"),
    ]);
    if (!code) throw new MarketError("Trading contract could not be verified.");
    const bytes = hexToBytes(code);
    for (const { start, length } of runtime.immutableReferences) bytes.fill(0, start, start + length);
    if (keccak256(bytes) !== runtime.runtimeHash || root !== collection.root ||
        (!collection.testnet && root !== runtime.collectionRoot) || fee !== SALE_FEE || !sameAddress(recipient, FEE_RECIPIENT)) {
      throw new MarketError("Trading contract could not be verified.");
    }
    return {
      number: block.number, hash: block.hash, timestamp: block.timestamp,
      market: {
        address: config.address, chainId: config.chain.id as MarketInfo["chainId"], chainName: config.chain.name,
        explorerUrl: config.chain.blockExplorers?.default.url ?? null,
        feeWei: SALE_FEE.toString(), feeRecipient: FEE_RECIPIENT,
        canTrade: !!signer && sameAddress(verifier, signer.address),
      },
    };
  }

  function cupId(number: number): Hex {
    if (!Number.isInteger(number) || number < 1 || number > 5000) throw new MarketError("Invalid cup number.", 400);
    const cup = collection.byId.get(number);
    if (!cup || !collection.proofs.has(cup.ethscriptionId.toLowerCase())) throw new MarketError("Cup is not in this collection.", 400);
    return cup.ethscriptionId as Hex;
  }

  async function verifyDeposit(record: IndexedCup, depositBlock: bigint) {
    if (depositBlock === 0n || !Array.isArray(record.ethscription_transfers) || !record.ethscription_transfers.length) return false;
    const transfers = [...record.ethscription_transfers];
    // Ordering is established by protocol coordinates, never by response order.
    for (const transfer of transfers) {
      if (!transfer || !isHash(transfer.transaction_hash) || !isHash(transfer.block_blockhash) ||
          !sameAddress(transfer.ethscription_transaction_hash, record.transaction_hash) ||
          !isAddress(transfer.from_address, { strict: false }) || !isAddress(transfer.to_address, { strict: false })) return false;
      unsignedInteger(transfer.block_number);
      unsignedInteger(transfer.transaction_index);
      unsignedInteger(transfer.transfer_index);
    }
    transfers.sort((a, b) => {
      for (const key of ["block_number", "transaction_index", "transfer_index"] as const) {
        const av = unsignedInteger(a[key]), bv = unsignedInteger(b[key]);
        if (av !== bv) return av < bv ? -1 : 1;
      }
      return 0;
    });
    const transfer = transfers.at(-1)!;
    if (unsignedInteger(transfer.block_number) !== depositBlock || transfer.event_log_index !== null ||
        !sameAddress(transfer.from_address, record.previous_owner) || !sameAddress(transfer.to_address, config.address)) return false;
    const [transaction, receipt, block] = await Promise.all([
      client.getTransaction({ hash: transfer.transaction_hash }),
      client.getTransactionReceipt({ hash: transfer.transaction_hash }),
      client.getBlock({ blockNumber: depositBlock }),
    ]);
    return receipt.status === "success" && receipt.blockNumber === depositBlock && transaction.blockNumber === depositBlock &&
      sameAddress(transaction.from, record.previous_owner) && sameAddress(transaction.to, config.address) &&
      sameAddress(receipt.from, record.previous_owner) && sameAddress(receipt.to, config.address) &&
      transaction.input.toLowerCase() === record.transaction_hash.toLowerCase() && transaction.value === 0n &&
      block.hash === receipt.blockHash && transaction.blockHash === block.hash && block.hash === transfer.block_blockhash &&
      BigInt(transaction.transactionIndex) === unsignedInteger(transfer.transaction_index);
  }

  async function cupState(number: number, snap: Snapshot): Promise<MarketCup> {
    const id = cupId(number);
    const record = await indexer.cup(id);
    const inEscrow = sameAddress(record.current_owner, config.address);
    const seller = inEscrow ? getAddress(record.previous_owner) : null;
    const [depositBlock, listing] = seller ? await Promise.all([
      client.readContract({ address: config.address, abi: marketAbi, functionName: "potentialDeposits", args: [seller, id], blockNumber: snap.number }),
      client.readContract({ address: config.address, abi: marketAbi, functionName: "listings", args: [seller, id], blockNumber: snap.number }),
    ]) : [0n, [0n, 0n]] as const;
    const readyAt = depositBlock ? depositBlock + COOLDOWN_BLOCKS : 0n;
    const verified = !inEscrow || await verifyDeposit(record, depositBlock);
    return {
      id: number, ethscriptionId: id, owner: getAddress(record.current_owner), seller, inEscrow, testnet: collection.testnet,
      depositBlock: depositBlock.toString(), readyAtBlock: readyAt.toString(),
      remainingBlocks: Number(readyAt > snap.number ? readyAt - snap.number : 0n),
      priceWei: listing[0].toString(), nonce: listing[1].toString(), verified,
      proof: collection.proofs.get(id.toLowerCase())!,
    };
  }

  async function claimState(wallet: Address, id: Hex, snap: Snapshot) {
    const [block, listing] = await Promise.all([
      client.readContract({ address: config.address, abi: marketAbi, functionName: "potentialDeposits", args: [wallet, id], blockNumber: snap.number }),
      client.readContract({ address: config.address, abi: marketAbi, functionName: "listings", args: [wallet, id], blockNumber: snap.number }),
    ]);
    return block ? {
      depositBlock: block.toString(), priceWei: listing[0].toString(),
      remainingBlocks: Number(block + COOLDOWN_BLOCKS > snap.number ? block + COOLDOWN_BLOCKS - snap.number : 0n),
    } : null;
  }

  return {
    async list(wallet?: Address, cursor?: string): Promise<MarketResponse> {
      const snap = await snapshot();
      const proceeds = wallet ? await client.readContract({ address: config.address, abi: marketAbi, functionName: "proceeds", args: [wallet] }) : undefined;
      try {
        await indexer.assertFresh(snap.number);
        const page = await indexer.escrowPage(config.address, wallet, cursor);
        const ids = [...new Set(page.cups.map((entry) => collection.byHash.get(entry.transaction_hash.toLowerCase())?.id).filter((id): id is number => !!id))];
        const cups: MarketCup[] = [];
        // Bound provider concurrency while inspecting this page of escrow.
        for (let i = 0; i < ids.length; i += 6) {
          cups.push(...await Promise.all(ids.slice(i, i + 6).map((id) => cupState(id, snap))));
        }
        await indexer.assertFresh(snap.number);
        return {
          market: snap.market, cups: cups.filter((cup) => cup.inEscrow &&
            (wallet ? sameAddress(cup.seller, wallet) : cup.verified && BigInt(cup.priceWei) > SALE_FEE && cup.remainingBlocks === 0)),
          nextCursor: page.nextCursor, ...(proceeds !== undefined ? { proceedsWei: proceeds.toString() } : {}),
        };
      } catch (error) {
        // ETH recovery remains available during indexer/verifier downtime.
        if (!wallet) throw error;
        return { market: snap.market, cups: [], proceedsWei: proceeds!.toString(), nextCursor: null,
          error: "Escrow ownership is temporarily unavailable. Your proceeds can still be withdrawn." };
      }
    },

    async cup(number: number, wallet?: Address): Promise<MarketResponse> {
      const id = cupId(number);
      const snap = await snapshot();
      const claim = wallet ? await claimState(wallet, id, snap) : null;
      try {
        await indexer.assertFresh(snap.number);
        const cup = await cupState(number, snap);
        return { market: snap.market, cups: [cup], claim };
      } catch {
        return { market: snap.market, cups: [], claim,
          error: "Ownership is still being confirmed. New trades are unavailable; existing deposits can still be returned." };
      }
    },

    async authorize(number: number, buyer: Address, expected: { seller: Address; priceWei: string; nonce: string }): Promise<SignedPurchase> {
      const snap = await snapshot();
      if (!snap.market.canTrade || !signer) throw new MarketError("Buying is temporarily unavailable.");
      if (!isAddress(buyer, { strict: false }) || /^0x0{40}$/i.test(buyer) || sameAddress(buyer, config.address)) throw new MarketError("Invalid buyer address.", 400);
      await indexer.assertFresh(snap.number);
      const cup = await cupState(number, snap);
      if (!cup.inEscrow || !cup.verified || !cup.seller || cup.remainingBlocks || BigInt(cup.priceWei) <= SALE_FEE ||
          sameAddress(cup.seller, buyer) || !sameAddress(expected.seller, cup.seller) ||
          expected.priceWei !== cup.priceWei || expected.nonce !== cup.nonce) {
        throw new MarketError("This listing changed or its deposit is not confirmed. Refresh before buying.", 409);
      }
      // Recheck indexer progress and the canonical snapshot hash immediately
      // before signing. The contract nonce invalidates subsequent state changes.
      await indexer.assertFresh(snap.number);
      const canonicalBlock = await client.getBlock({ blockNumber: snap.number });
      if (canonicalBlock.hash !== snap.hash) throw new MarketError("The network changed. Please refresh before buying.", 409);
      const authorization: PurchaseAuthorization = {
        ethscriptionId: cup.ethscriptionId, seller: cup.seller, buyer: getAddress(buyer),
        price: BigInt(cup.priceWei), listingNonce: BigInt(cup.nonce), depositBlock: BigInt(cup.depositBlock),
        issuedAt: snap.timestamp, deadline: snap.timestamp + 60n,
      };
      const signature = await signer.signTypedData(purchaseTypedData(config.chain.id, config.address, authorization));
      await client.simulateContract({ address: config.address, abi: marketAbi, functionName: "buy",
        account: buyer, args: [authorization, signature], value: authorization.price });
      return {
        authorization: { ...authorization, price: authorization.price.toString(), listingNonce: authorization.listingNonce.toString(),
          depositBlock: authorization.depositBlock.toString(), issuedAt: authorization.issuedAt.toString(), deadline: authorization.deadline.toString() },
        signature,
      };
    },
  };
}

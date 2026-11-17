import type { Address, Hex } from "viem";

export const SALE_FEE = 1_000_000_000_000n;
export const FEE_RECIPIENT = "0xcbBcf40247425932d728585dA2678567e7F8E42f" as const;
export const COOLDOWN_BLOCKS = 5n;

export type MarketInfo = {
  address: Address;
  chainId: 1 | 11155111 | 31337;
  chainName: string;
  explorerUrl: string | null;
  feeWei: string;
  feeRecipient: Address;
  canTrade: boolean;
};

export type MarketCup = {
  id: number;
  ethscriptionId: Hex;
  owner: Address;
  seller: Address | null;
  inEscrow: boolean;
  depositBlock: string;
  readyAtBlock: string;
  remainingBlocks: number;
  priceWei: string;
  nonce: string;
  verified: boolean;
  proof: Hex[];
};

export type MarketResponse = {
  market: MarketInfo | null;
  cups: MarketCup[];
  proceedsWei?: string;
  nextCursor?: string | null;
  claim?: { depositBlock: string; priceWei: string; remainingBlocks: number } | null;
  error?: string;
};

export type PurchaseAuthorization = {
  ethscriptionId: Hex;
  seller: Address;
  buyer: Address;
  price: bigint;
  listingNonce: bigint;
  depositBlock: bigint;
  issuedAt: bigint;
  deadline: bigint;
};

export type SignedPurchase = {
  authorization: Omit<PurchaseAuthorization, "price" | "listingNonce" | "depositBlock" | "issuedAt" | "deadline"> & {
    price: string; listingNonce: string; depositBlock: string; issuedAt: string; deadline: string;
  };
  signature: Hex;
};

export const purchaseTypes = {
  PurchaseAuthorization: [
    { name: "ethscriptionId", type: "bytes32" },
    { name: "seller", type: "address" },
    { name: "buyer", type: "address" },
    { name: "price", type: "uint256" },
    { name: "listingNonce", type: "uint256" },
    { name: "depositBlock", type: "uint256" },
    { name: "issuedAt", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function purchaseTypedData(chainId: number, market: Address, message: PurchaseAuthorization) {
  return {
    domain: { name: "CupscriptionsMarket", version: "1", chainId, verifyingContract: market },
    types: purchaseTypes, primaryType: "PurchaseAuthorization" as const, message,
  };
}

export function decodePurchase(data: SignedPurchase["authorization"]): PurchaseAuthorization {
  return {
    ...data, price: BigInt(data.price), listingNonce: BigInt(data.listingNonce),
    depositBlock: BigInt(data.depositBlock), issuedAt: BigInt(data.issuedAt), deadline: BigInt(data.deadline),
  };
}

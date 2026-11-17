// Shared by the verifier and wallet client. Do not sign caller-provided fields
// directly: verify escrow ownership, the deposit transaction, and listing state.
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
};

export function purchaseTypedData(chainId, market, authorization) {
  return {
    domain: { name: "CupscriptionsMarket", version: "1", chainId, verifyingContract: market },
    types: purchaseTypes,
    primaryType: "PurchaseAuthorization",
    message: authorization,
  };
}

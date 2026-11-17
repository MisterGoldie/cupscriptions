# Cupscriptions marketplace contract

An Ethereum L1, fixed-price ETH marketplace for the 5,000 inscription IDs in
`src/data/cupscriptions.json`. This package is separate from the Next.js app and
does not add runtime dependencies to the website.

## Fee requested by the collection owner

- Fixed fee per completed sale: **0.000001 ETH** (1,000,000,000,000 wei).
- Recipient: **0xcbBcf40247425932d728585dA2678567e7F8E42f**.
- The fee is deducted from the listed price. For a 0.01 ETH sale, the seller is
  credited 0.009999 ETH and the recipient is credited 0.000001 ETH.
- A listing's price must exceed the fee. The buyer pays the listed price plus
  Ethereum gas, with no additional platform charge.
- The rate and recipient are constants. There is no owner, proxy, upgrade,
  configurable fee, admin withdrawal, or privileged way to move a cup.
- Seller proceeds and fees accumulate in `proceeds(account)`. Each account calls
  `withdrawProceeds(recipient)` to collect its own balance. Crediting a balance
  does not automatically send ETH to that account's wallet.

## Build and test locally

Requires Node.js 20 and npm. All transactions in the tests run on an in-memory
local chain, using test accounts. No RPC endpoint, real wallet, or funds are used.

```powershell
npm --prefix contracts ci --no-audit --no-fund
npm run contracts:build
npm run contracts:test
npm --prefix contracts run collection -- 6
```

The build emits the ABI, bytecode, Solidity compiler input, and collection root
into `contracts/artifacts/` (gitignored). It also checks the actual 5,000 IDs for
collisions with named function selectors, since deposits use raw calldata.

The compiler is pinned to Solidity 0.8.30, optimizer 200 runs, Shanghai EVM target.
OpenZeppelin 5.4.0 supplies EIP-712, ECDSA, Merkle proofs, and reentrancy protection.
The lockfile pins the standalone compiler/test dependencies; they are not used
by Vercel's normal root install or application build.

## Collection membership

`scripts/collection.mjs` validates the 5,000 unique cup numbers and inscription
hashes, sorts double-hashed leaves, and builds a Merkle tree with sorted pairs.
An odd unpaired node is promoted unchanged. A proof contains each existing sibling
from leaf to root. The leaf is:

```solidity
keccak256(bytes.concat(keccak256(abi.encode(ethscriptionId))))
```

The root is an immutable constructor parameter. Use the exact metadata snapshot
and generated root from this package, and preserve its reported SHA-256 for the
deployment record. Changing metadata later does not change a deployed contract.

### Distinction from AppChain collection registration

This marketplace's Merkle root is an allowlist of existing inscription IDs. It is
not the AppChain Collections protocol's root, which binds content hashes and item
metadata. The proofs and roots are not interchangeable. This contract neither
creates nor edits an AppChain collection, re-inscribes artwork, or changes any
existing cup's inscription ID. AppChain collection management is a separate L2
feature and does not make that state directly readable by this Ethereum L1 market.

Before adding collection registration tooling, verify whether Cupscriptions is
already registered and how its original inscriptions are represented there. The
guide's create/add examples create inscriptions with collection protocol data;
do not treat them as a migration recipe for the existing 5,000 IDs.

Reference: https://docs.ethscriptions.com/ethscriptions-appchain/collections

## Important ownership and verifier boundary

An Ethereum L1 contract cannot directly read canonical Ethscription ownership.
Anyone can send an arbitrary 32-byte ID to the fallback, even without owning it.
These entries are deliberately called **potential deposits**, not ownership.
Listings must likewise be treated as potential offers until the indexer verifies
them. A successful receipt or transaction simulation alone does not establish a
valid Ethscription deposit or transfer.

The contract requires an EIP-712 signature from an immutable `ownershipVerifier`
for every purchase. This is an explicit trust dependency, not a trustless proof of
ownership. A compromised or incorrect verifier can authorize payment for an
invalid offer. Verifier unavailability stops purchases, but does not stop cup
withdrawals, listing cancellations, or withdrawal of credited ETH. Replacing a
lost or compromised verifier requires deploying a new market.

The website verifier is implemented in `src/lib/market/service.ts`, with its
server-only signer setup in `server.ts`. It remains inactive without a deployed
market and matching configured signer. See [trading setup](../docs/trading.md).
Its responsibilities are:

1. Validate the configured network and exact deployed market, and confirm that
   the ID belongs to the immutable collection.
2. Check an up-to-date canonical Ethscriptions indexer. The inscription's current
   owner must be the market and its previous owner must be the proposed seller.
   Reject stale, unavailable, or inconsistent indexer responses.
3. Confirm the latest valid deposit's transaction/receipt, sender, recipient,
   inscription ID, block number, and required confirmations. Support only deposit
   paths the verifier can validate; raw calldata sent internally by a contract
   is not automatically an EOA transfer. The indexer must have processed that
   deposit and subsequent relevant transactions.
4. Read the exact current listing, seller-specific nonce, and potential deposit
   block from the market. Reject withdrawn, replaced, or mismatched deposits and
   listings. Enforce the five-block cooldown before signing.
5. Bind the authorization to the requesting buyer, exact price, listing nonce,
   deposit block, current Ethereum timestamp (`issuedAt`), and short deadline
   (recommend 60 seconds; contract maximum 300 seconds). The EIP-712 domain binds
   chain ID and deployed market. `scripts/purchase-authorization.mjs` defines the
   shared typed data and does not sign unverified requests.
6. Keep the verifier signing key exclusively on the server, never in frontend
   code or a `NEXT_PUBLIC_` environment variable. Sign only data reconstructed
   from verified state, never an arbitrary typed-data object supplied by a client.

Withdrawal uses the exact ESIP-2 event, binding the claimed previous owner to
`msg.sender` and returning the inscription to that same address. A fake claimant
cannot overwrite another claimant's deposit/listing. Indexers ignore a false
claimant's withdrawal, while the genuine depositor retains a withdrawal path.
No signature or collection proof is required for this recovery path.

## Integration sequence

1. **Deposit:** Send 0 ETH to the market with the inscription ID as the entire
   32-byte transaction calldata. Do not ABI-encode a named deposit function.
   Wait for the canonical indexer and five Ethereum blocks. The fallback does not
   accept ETH or malformed lengths. Ordinary ETH sends to the market revert.
2. **List or reprice:** Call `list(id, priceWei, proof)`. Index all `Listed` events,
   but publish only ownership-verified offers. Store prices as integer wei.
3. **Buy:** Obtain a verified, buyer-bound authorization and call
   `buy(authorization, signature)` with exactly the current listed ETH price.
   A reprice, cancellation, sale, or withdrawal invalidates the previous listing
   nonce. A withdrawal/redeposit also changes the deposit epoch. Expired and
   cross-chain/contract/buyer signatures are rejected.
4. **Cancel:** `cancelListing(id)` stops a listing and leaves the cup in escrow.
5. **Return cup:** `withdrawEthscription(id)` cancels any listing and requests an
   ESIP-2 transfer to the depositor. It requires the five-block cooldown, but no
   verifier, admin, or external service call.
6. **Collect ETH:** Each seller and the fee recipient withdraw their own credited
   proceeds. A recipient that rejects ETH cannot block purchases; a failed
   withdrawal rolls back and preserves credit. Reentrancy is guarded.

My Cups must show both wallet-held cups and verified seller-owned escrowed cups.
After a buy or withdrawal, distinguish Ethereum confirmation from the indexer's
confirmation of the actual protocol transfer. Events named `PotentialDeposit`
and `PotentialWithdrawal` must never be presented as verified ownership on their
own. Do not advertise a working market before the verifier and indexer exist.

## Deployment handoff

Nothing in the build or test scripts deploys to a public network. Constructor
arguments are `(collectionRoot, ownershipVerifier)`. There is intentionally no
default verifier address or private key. The specified fee and recipient are
already in the bytecode; verify them, the collection snapshot/root, the signer
address, and the chain before deployment.

This is a new, unaudited implementation. Local EVM tests and a protocol event
model are not independent security review or live Ethscriptions indexer tests.
Complete an independent contract review and a testnet lifecycle against a real
indexer, including false deposits and verifier downtime, before using real funds.

Sources:

- https://docs.ethscriptions.com/esips/accepted-esips/esip-2-safe-trustless-smart-contract-ethscription-escrow
- https://docs.ethscriptions.com/overview/protocol-specification
- https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography

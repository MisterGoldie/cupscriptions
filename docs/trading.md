# Trading integration

The app integrates with `CupscriptionsMarket` on Ethereum L1. The contract is not
yet deployed and no production signer has been configured. With `MARKET_ADDRESS`
empty, the site serves its gallery and wallet views, shows a preparation message,
and cannot issue purchase authorizations or offer transaction controls.

## Configure after a reviewed testnet deployment

1. Install root dependencies and the separate contract development dependencies.
   Run `npm run contracts:build`. This generates the app's checked-in ABI and
   runtime fingerprint from the same Solidity implementation, plus deployment
   artifacts under `contracts/artifacts/`.
2. Create a **dedicated verifier signing key** using your secret-management
   process. It signs ownership attestations; it is not the fee recipient's wallet
   and does not need ETH to sign. Do not use the treasury or a holder's wallet key.
3. Copy `market.env.example` to `.env.local` and enter the verifier key there.
   `.env.local` is gitignored. To derive only its public address locally:

   ```powershell
   node --env-file=.env.local scripts/verifier-address.mjs
   ```

   The script never generates a key, prints it, writes files, or submits a
   transaction. Do not paste private keys in chat or command arguments.
4. Deploy the reviewed contract through your wallet with constructor arguments
   `(collectionRoot, ownershipVerifier)`, using the generated root and the public
   verifier address. Neither the build nor the integration deploys a contract.
   Record the chain, address, deployment transaction and source snapshot.
5. Set these **server-only** variables in `.env.local`, and later in Vercel:

   - `MARKET_ADDRESS`: the deployed market address.
   - `MARKET_CHAIN_ID`: `1` (Ethereum) or `11155111` (Sepolia). Local chain `31337`
     is supported only outside production.
   - `MARKET_RPC_URL`: a reliable HTTPS RPC on that exact chain.
   - `MARKET_INDEXER_URL`: an Ethscriptions v2 API on the same chain. Ethereum
     defaults to `https://api.ethscriptions.com/v2`; other chains require an
     explicitly supplied indexer. Never use mainnet ownership for testnet.
   - `MARKET_VERIFIER_PRIVATE_KEY`: the dedicated signer's key. Its address must
     match the contract's immutable verifier. Never prefix it with `NEXT_PUBLIC_`.

6. Restart the app after changing configuration. Open Trade, My Cups and an
   individual cup. A missing or mismatched signer keeps new trading disabled,
   while existing cup and proceeds recovery remains available.

For local wallet testing, run the local chain at `http://127.0.0.1:8545`, provide
a matching local indexer, and use only local test accounts. The automated tests
instead use an in-memory chain and injected indexer responses; no public funds
or production secrets are needed.

## Implemented website flows

- `/trade`: paginated, ownership-verified listings, with sorting of loaded cups.
  Select a listing to buy on its cup page.
- `/cup/[id]`: deposit to sell, list/reprice, cancel a listing, buy, and return the
  cup to the depositor's wallet. The page shows the escrow address, chain, exact
  price, fee, seller proceeds and remaining cooldown blocks.
- `/my-cups`: wallet-held cups plus a separate marketplace escrow section. Listed
  cups do not disappear from the owner's management view after deposit.
- My Cups and Trade show withdrawable proceeds when the connected account has
  a balance, including the fee recipient's accumulated sale fees.
- Wallet actions check/switch network, check the active account again, simulate
  the contract operation, and wait for the Ethereum receipt. Pending transaction
  hashes are remembered in session storage per market, network and account, with
  a status check control to avoid submitting a duplicate after a timeout/reload.
- A successful Ethereum receipt is distinguished from indexer confirmation of
  the actual Ethscription transfer. Queries refresh after transactions and poll
  for subsequent ownership updates.

The sale fee remains **0.000001 ETH**, deducted from the seller's listed price
and credited to **0xcbBcf40247425932d728585dA2678567e7F8E42f**. This balance must be
withdrawn by that wallet. Gas is separate from the marketplace fee.

## Verifier and listing discovery

`src/lib/market/server.ts` is a server-only entry point. The core service in
`service.ts` receives the RPC, indexer and signer as dependencies so it can be
tested against the actual contract on a local EVM.

Before authorizing a purchase, the service verifies:

1. The RPC chain and a fresh head block; the deployed runtime fingerprint after
   masking Solidity immutable slots; the collection root; the exact fixed fee
   and recipient; and the configured signer against the immutable verifier.
2. An indexer that has processed at least the RPC snapshot block. Requests bypass
   HTTP/Next caches, time out, validate schemas, and fail closed on stale data.
3. That the inscription is in the collection, the market is its current owner,
   and the seller is its previous owner.
4. The last canonical deposit transfer, ordered by protocol coordinates. It must
   match a successful RPC transaction and receipt: hash, block hash, block number,
   transaction index, sender, destination, zero ETH and exact raw inscription ID
   calldata. This verifier currently supports **direct EOA deposits**. ESIP-1
   deposits from smart contracts are not advertised or purchase-authorized.
5. Current listing price, nonce, deposit epoch, and five-block cooldown. The
   buyer's quoted seller/price/nonce must still match; changes produce HTTP 409
   rather than silently buying at a different price.
6. A still-canonical snapshot block and fresh indexer status, then an EIP-712
   signature bound to this buyer, chain, contract, price, nonce, deposit block,
   issuance time and a 60-second deadline. The signed purchase is simulated before
   its signature is returned. Only reconstructed fields are signed.

The public POST accepts only `cup`, `buyer`, `seller`, `priceWei` and `nonce`.
It rejects other keys, invalid addresses, cross-origin browser calls, oversized
bodies and invalid prices. A bounded per-instance concurrency/rate limiter limits
abuse; it is not global authentication or a distributed rate limiter. No provider
error bodies, RPC credentials or private keys are returned to clients.

Listing discovery queries canonical escrow holdings, then reads the matching
seller's current contract state. It uses 24-item indexer pages and bounded RPC
concurrency instead of an ever-growing historical log scan or a new database.
Empty filtered pages can have a next-page cursor. Sorting covers loaded pages,
not the entire market or an authoritative collection floor price.

During signer or indexer downtime, cup pages can still read the connected
account's deposit record from RPC and offer its permissionless ESIP-2 withdrawal.
Proceeds are also read independently of the indexer. An RPC/contract verification
failure disables the website's transaction controls; the deployed contract itself
does not require this website or signer to withdraw cups or credited ETH.

## Validation and remaining deployment work

```powershell
npm --prefix contracts ci --no-audit --no-fund
npm run contracts:build
npm run contracts:test
npm test
npm run lint
npm run build
```

The root tests exercise real EIP-712 signing and a purchase on the compiled
contract, fee/proceeds accounting, API validation and safe error responses,
incorrect/stale indexer data, wrong runtime/network/signer, reorg handling and
recovery during verifier downtime. They also compare all 5,000 app proofs against
the contract package. They do not constitute independent security review or a
live indexer/wallet-browser test.

Before public trading, complete independent review and a testnet lifecycle with
the actual configured indexer and wallet, then configure the deployed contract,
dedicated verifier secret and server RPC in hosting. No public deployment,
production key generation, commit, or push is performed by this integration.

# Cupscriptions

Next.js gallery for the Cupscriptions Ethscriptions collection (5,000 cups).

Images are loaded from public IPFS gateways for CID:

`QmcL3Yswr6dDuQWnA5nmbqoB9ZSTQ2r34pLKskfLiwftPi`

## Develop

```bash
yarn install
yarn dev
```

Open [http://localhost:3000](http://localhost:3000).

## Routes

- `/` — landing
- `/collection` — paginated grid
- `/cup/[id]` — single cup (1–5000) with traits
- `/my-cups` — connect wallet and view owned cups
- `/trade` — marketplace listings and escrow/proceeds management

## Wallet

Connect via browser extension (MetaMask, etc.). Ownership is loaded from the Ethscriptions indexer:

`https://api.ethscriptions.com/v2/ethscriptions?current_owner={wallet}&max_results=50`

The lookup follows all ownership pages and matches each `transaction_hash` against
the collection's `ethscription_id` metadata to determine its cup number. Ownership
requests bypass the server cache so Refresh performs a fresh lookup.

## Traits

Collection metadata lives in `src/data/cupscriptions.json`.
Item `id` fields in that file are all `0`; cups are keyed by the `#N` in each `name`.

## Marketplace contract

The standalone Solidity implementation and local EVM tests live in
[`contracts/`](contracts/README.md). It uses the collection's inscription IDs,
ESIP-2 escrow withdrawals, verified purchase authorizations, and a fixed
0.000001 ETH fee credited to the configured collection owner's address.

```bash
npm --prefix contracts ci --no-audit --no-fund
npm run contracts:build
npm run contracts:test
```

The verifier and website transaction controls are implemented. Trading stays
inactive until a deployed contract and matching server signer are configured.
See [trading setup](docs/trading.md) and `market.env.example` for deployment
configuration, supported deposit paths, recovery behavior, and validation.

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
- `/trade` — marketplace placeholder

## Wallet

Connect via browser extension (MetaMask, etc.). Ownership is loaded from the Ethscriptions explorer:

`/api/v2/tokens/0x4fC9…/instances?holder_address_hash={wallet}`

Token ids are 0-indexed on-chain; the site displays Cupscription `#N` as `tokenId + 1`.

## Traits

Collection metadata lives in `src/data/cupscriptions.json`.
Item `id` fields in that file are all `0`; cups are keyed by the `#N` in each `name`.

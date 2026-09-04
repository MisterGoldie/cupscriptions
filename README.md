# Cupscriptions

Next.js gallery for the Cupscriptions Ethscriptions collection (5,000 cups).

Images are served from the public Pinata IPFS gateway:

`https://gateway.pinata.cloud/ipfs/QmcL3Yswr6dDuQWnA5nmbqoB9ZSTQ2r34pLKskfLiwftPi/Cupscription_{n}.jpg`

## Develop

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Routes

- `/` — landing
- `/collection` — paginated grid
- `/cup/[id]` — single cup (1–5000)
- `/trade` — marketplace placeholder

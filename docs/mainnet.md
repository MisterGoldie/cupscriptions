# Mainnet deployment and public launch

Sepolia remains isolated from Ethereum mainnet. Its contract, three test cups,
verifier and local indexer are not mainnet configuration. Live Sepolia checks
completed deployment, deposit, listing, purchase from a different wallet,
proceeds withdrawal, listing cancellation and cup return.

## Reviewed implementation

The mainnet deployment uses the same Solidity implementation tested on Sepolia.
Its immutable constructor parameters change to the original collection root and
a dedicated mainnet verifier. Runtime checks bind deployment calldata, chain ID,
deployer, canonical receipt, bytecode, collection root, verifier, fixed fee and
recipient. The fixed fee remains 0.000001 ETH per completed sale, deducted from
seller proceeds and credited to `0xcbBcf40247425932d728585dA2678567e7F8E42f`.

The source review covered signature domain/buyer/price/nonce/epoch binding,
conditional Ethscription transfers, false deposits, fee accounting, recovery
without the verifier, reentrancy and failed ETH withdrawals. The verifier was
hardened to bind both RPC transaction/receipt hashes and transaction indices to
the indexed deposit. Regression tests exercise mismatches. This is source review
and automated testing, not a commissioned third-party audit.
Production output tracing explicitly excludes local environment files and both
operator directories; development-only deployment record reads are statically
scoped and eliminated from production trading configuration.

Ownership verification trusts the configured Ethscriptions indexer and the
server signer. The website supports direct EOA deposits. Losing or compromising
the immutable verifier requires a new market for future purchases; existing cup
and proceeds withdrawals remain independent of that signer. A deployed contract
has no upgrade or administrator withdrawal mechanism.

## Local mainnet setup

The dedicated key is stored as `MAINNET_VERIFIER_PRIVATE_KEY` in the protected,
gitignored `.env.local`. The explicit `npm run mainnet:verifier` command generates
it only when absent, verifies signing, preserves Sepolia configuration and never
prints either key. It writes only the public address to `.mainnet/verifier.json`.
To display the address later:

```powershell
node --env-file=.env.local scripts/verifier-address.mjs --mainnet
npm run contracts:build
npm run dev:mainnet -- --hostname 127.0.0.1 --port 3014
```

Open **http://127.0.0.1:3014/mainnet**. The operator page and API are enabled only
in this isolated local mainnet preview. The original 5,000-cup root is
`0xf41a0c0b48998aa4264d72b1d2e35fb1992a29b0d50e21e3432a13ad37d98e90`.
Mainnet uses chain 1 and real ETH. The funded deployer is the existing fee wallet.
The page shows its current balance, current gas budget, verifier and fee settings.

Gas estimation uses a temporary balance override in an RPC simulation so that
an underfunded wallet can still see its funding requirement. That simulation
does not fund the wallet or submit a transaction. The displayed wallet balance
is the actual mainnet balance. Estimates include a 20 percent gas limit buffer;
the wallet shows the final fee. A new deployment is disabled until the wallet
covers the current estimate and the indexer readiness check succeeds.

The wallet must approve the creation transaction. After twelve confirmations,
the server independently verifies it and saves public deployment data to
`.mainnet/deployment.json`. Only the local mainnet preview reads that record to
connect trading. Pending deployment hashes are saved in browser storage; retry
checks the submitted hash. Neither the key nor `.env.local` is modified by web
activation. Production never reads local deployment records.

## Controlled mainnet check, then public configuration

After deployment, use the local mainnet preview to complete a controlled trade
with wallets you own and inspect the actual mainnet indexer's ownership change,
fee/proceeds accounting and withdrawal. Mainnet transaction gas is real ETH.

For the public Vercel project, configure the server variables in
`mainnet.env.example`: chain 1, the verified deployed address, the mainnet RPC,
the mainnet indexer and the dedicated mainnet verifier key under
`MARKET_VERIFIER_PRIVATE_KEY`. Never put a signer key in `NEXT_PUBLIC_*`, source
files, transaction arguments, chat, or Git. Use the hosting provider's secret
environment input; `.env.local` stays local. A verifier mismatch disables buys.

The project is linked locally as `cupscriptions`, but changing local source or
configuration does not update the hosted site. Public deployment is a separate
step after the mainnet contract and controlled trade are verified. No command in
this guide commits or pushes to GitHub automatically.

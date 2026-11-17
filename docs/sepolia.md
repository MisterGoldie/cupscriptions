# Ethereum Sepolia test collection

The wallet is `0xcbBcf40247425932d728585dA2678567e7F8E42f`. The target network is
**Ethereum Sepolia, chain 11155111**. Base Sepolia (84532) is a separate network;
its ETH and USDC cannot pay for Ethereum Sepolia transactions. This marketplace
uses ETH. The fixed sale fee is 0.000001 ETH, deducted from the listed price.

The 5,000 mainnet records in `src/data/cupscriptions.json` are unchanged.
`src/data/sepolia-cupscriptions.json` starts empty. It will contain exactly three
new test inscriptions after their real creation receipts have been verified.
No placeholder inscription IDs, global inscription numbers or deployable fake
roots are supplied.

## Create three test inscriptions

Run from the project root, using Node 20.12 or later:

```powershell
npm run sepolia:prepare
npm run sepolia:indexer
```

Leave the indexer terminal running. In a second terminal:

```powershell
npm run dev:sepolia -- --hostname 127.0.0.1 --port 3012
```

Open **http://127.0.0.1:3012/sepolia**, connect the wallet above, and choose
**Create or check test cup #1**, then repeat for #2 and #3 after each confirmation.
Approve each transaction in your wallet. Each is a 0 ETH self-transfer with an SVG data URI as calldata;
only gas is spent. The page switches to Ethereum Sepolia and checks the active
account/network before every signature. The server checks two confirmations;
already registered cups are skipped. Each cup has its own status and explorer
link. A status check stops after 90 seconds and can be resumed without rebroadcast.
"Stop checking" stops the status request, not the submitted transaction.
The preview uses `.next-sepolia/` for its build cache, so it can run alongside
your existing development server without sharing its lock or generated output.

The test art is visibly labelled "SEPOLIA TEST ONLY". A random batch comment
makes each prepared payload unique. The ESIP-6 data URI allows duplicate content
under that protocol rule. The inscription ID is the successful transaction hash.

The preparation command writes the exact unsigned payloads to
`.sepolia/unsigned-transactions.json` and the stable plan to `.sepolia/plan.json`.
It never signs or broadcasts. Browser local storage remembers submitted hashes;
continuing checks confirmations and imports those hashes before sending another
creation. Keep this browser's stored state if a transaction is still pending.
Use one setup tab at a time. Wallet-replaced transactions can instead be imported
by their final confirmed hash:

```powershell
npm run sepolia:import -- 1 0xYOUR_CONFIRMED_CREATION_HASH
```

The importer verifies chain, sender, recipient, zero value, exact prepared
content, canonical block hash, successful receipt and two confirmations. Only
after all three receipts pass does it publish the test manifest. It refuses to
replace an existing test collection with different IDs. `.sepolia/` is ignored
by git; the final public manifest is reviewable source. No commit is made.

The setup API can write files only in local development through loopback hosts.
It rejects cross-origin mutations and is disabled in production. Creation is a
local setup task, not an endpoint for public users to modify the collection.

## Verify the indexer and root

```powershell
curl.exe http://127.0.0.1:3031/health
npm run sepolia:collection
```

The root command rechecks the real creation receipts and prints the test root
and all three membership proofs. It fails until all test cups exist. Contract
compilation still generates the mainnet manifest; it does not overwrite this
test root.

The local indexer is **collection-scoped**, not a full Ethereum Sepolia
Ethscriptions registry. It independently validates the three ESIP-6 creations,
then scans every subsequent block and relevant protocol logs. It follows raw
single/bulk transfers, ESIP-1 contract transfers and ESIP-2 previous-owner
conditional transfers through arbitrary addresses, ignoring failed transactions
and false ownership claims. It does not assign global inscription ordinals.
Canonical block checks detect reorgs and trigger replay; an invalidated creation
or unavailable RPC disables reads. State is saved in `.sepolia/indexer-state.json`.

Read-only endpoints, bound to `127.0.0.1:3031`:

- `/health` and `/status`: chain, collection scope, head, imported block,
  `tracked_count`, `ready`, and `waiting_for_creations`.
- `/ethscriptions/:transactionHash`: a tracked cup with its ownership history.
- `/ethscriptions?current_owner=...&previous_owner=...&max_results=24`:
  filtered, paginated holdings, compatible with the verifier adapter.

Before creation, health explicitly reports `waiting_for_creations: true` and
`ready: false`. Data endpoints fail closed while waiting or catching up. There
is no hosted Sepolia indexer dependency. A public RPC may throttle long replays;
set `SEPOLIA_RPC_URL` to a reliable **Ethereum Sepolia** RPC if needed. This
small indexer is intended for this three-cup test lifecycle.

## Deploy and connect the test marketplace

After all three test cups are confirmed:

The local `/sepolia` page includes **Deploy the test marketplace**. It prepares
the compiled contract with the real test root and the configured verifier's
public address, estimates gas, and asks the funded setup wallet to approve a
0 ETH contract-creation transaction on Ethereum Sepolia. Its submitted hash is
saved before confirmation checking, so a retry checks the existing deployment.

After two confirmations, the server verifies the exact creation calldata,
deployer, successful canonical receipt, deployed runtime, root, verifier, fixed
fee and recipient. It writes only public deployment data to
`.sepolia/deployment.json`. The isolated local preview reads that verified
record and activates trading immediately, including after restarts. It does
not edit or duplicate the private key in `.env.local`. These deployment endpoints
are disabled in production. A hosted deployment still uses `MARKET_*` settings.

For manual deployment:

1. Run `npm run contracts:build` and `npm run sepolia:collection`.
2. Configure a dedicated server-only verifier signing key locally, separate
   from your wallet. Derive its public address using
   `node --env-file=.env.local scripts/verifier-address.mjs --sepolia` (that helper
   reads `SEPOLIA_VERIFIER_PRIVATE_KEY` and prints only its public address).
   Do not paste private keys into chat.
3. Deploy `CupscriptionsMarket` on **Ethereum Sepolia** through your wallet.
   Constructor arguments are `(the test root, the verifier public address)`.
4. For `npm run dev:sepolia`, set these dedicated values in your gitignored
   `.env.local` and restart:

   ```dotenv
   SEPOLIA_MARKET_ADDRESS=0xYOUR_DEPLOYED_TEST_MARKET
   SEPOLIA_VERIFIER_PRIVATE_KEY=YOUR_DEDICATED_TEST_VERIFIER_KEY
   SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
   SEPOLIA_INDEXER_URL=http://127.0.0.1:3031
   ```

The Sepolia preview overrides the generic marketplace variables and will not
reuse a mainnet address or verifier key. For a separately hosted test preview,
use the corresponding `MARKET_*` variables in `sepolia.env.example` and an HTTPS
deployment of this indexer on a persistent Node host; localhost will not work
from Vercel. Keep the creation API disabled there.

Open a confirmed cup from `/sepolia`, deposit, list it, wait five blocks, then
buy using a second test wallet. Check the buyer's indexed ownership, seller's
proceeds, fee recipient's proceeds, cancellation and return-to-wallet. The
verifier checks the deployed bytecode, this test root and canonical deposit
before signing. Mainnet gallery and My Cups still read mainnet ownership.

## Validation

`npm test` includes a local EVM with chain ID 11155111. Tests create actual
calldata inscriptions on that in-memory chain and feed its real blocks/logs
through the indexer and verifier into a signed purchase. They cover ESIP-2
ownership and recovery, failed transfers, false claims, bulk transfers, network
separation and setup API access checks. They use no real wallet secrets or
public funds. This is separate from a live wallet-signed Sepolia lifecycle.

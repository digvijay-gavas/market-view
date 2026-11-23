# Progressive family collector

The worker lives in this repository and runs locally on Windows with Node 22+
and Google Chrome. GitHub Pages only hosts the viewer; it cannot run Chrome or
hold an unattended Google refresh token.

## Data and recovery

| Shared market-data path | Contents | Frequency |
| --- | --- | --- |
| `portfolio.positions/<account>/<timestamp>__<hash>.json` | Complete quantity/cost reconciliation, with reference prices | First successful run each market day |
| `market.prices/shared/<timestamp>__<hash>.json` | One quote per held instrument, shared across accounts | About 10 minutes, randomized by up to 60 seconds |
| `portfolio.position_changes/<account>/<timestamp>__<hash>.json` | Net quantity/cost changes between reconciliations | Only when a difference is observed |
| `groww.live_holdings/<account>/...` | Daily compatibility capture for existing readers | After a successful position reconciliation |
| `_market-view-dashboard-cache.json` | Calculated family dashboard, keyed by source metadata | Rebuild when source inputs change |
| `_market-view-collector-status.json` | Run checkpoint, per-account capture time/status, quote/cache status | Each completed run |

The reader combines the newest account basis with newer shared quotes. It displays
position and price timestamps separately. Failed quote requests retain their old
observation times, and missing prices fall back to the daily reconciliation price.
An observation time means fetched from the provider, not the exchange tick time.
Quotes more than 20 minutes old and positions more than 36 hours old produce
warnings when the store is read. Existing BM history, P&L lots and dividends remain
inputs from the original collection process; this worker does not fetch those reports.
Once progressive data is present, an open signed-in viewer checks Drive every
five minutes and preserves the current account/filter selection while updating.
Legacy-only stores keep the existing four-hour interval. Google authorization
must remain valid for these browser checks.

Daily reconciliation is a complete account baseline, not a delta-only chain.
The next run compares the latest shared baseline with the current account after a
missed day or a machine change. It fetches current positions once, rather than
replaying every missed ten-minute run. It cannot reconstruct missed trades, an
intraday buy/sell round trip, or historical prices. Net differences may also mean
transfers, splits or corrections, so the journal deliberately calls them observed
position changes. Exact historical trading activity requires transaction/report
ingestion. Changes made after the first daily reconciliation appear the next market
day; use `run --force --positions-now` for an immediate reconciliation.

Snapshots use the existing v1 envelope and deterministic content hashes; schemas
are registered in `_schema/catalog.json`. New immutable files are uploaded under
temporary names before becoming visible as snapshots. Existing snapshots are not
edited. Cached source bodies on the worker avoid repeat downloads; the shared
dashboard cache benefits every authorized family account. Folder permissions are
inherited and never modified. Designate one active worker to avoid duplicate work;
the local process lock does not coordinate separate machines.

## One-time Windows setup

Run these in a normal PowerShell terminal from the repository. Never enter PINs,
OAuth secrets or tokens into chat or command-line arguments.

```powershell
npm ci
npm run collector -- init --accounts swati,anna,aai,bunny,teju
npm run collector -- google-login C:\private\google-desktop-client.json
```

Use a Google **Desktop app** OAuth client JSON and an account with editor access
to the shared market-data folder. The command opens ordinary Google consent in
your browser using a loopback redirect and PKCE, then encrypts the offline refresh
token locally. It requests the broad Drive scope to write collector sources and
the shared cache. No secrets go to GitHub Pages. If offline credentials from the
original collector already exist outside this repository, use
`import-google C:\private\google_token.json` instead. Google may expire or revoke
refresh tokens; consent in an external OAuth app's Testing status can also limit
their lifetime. Reauthorize with `google-login` when required.

Enroll each account separately (replace `swati` for each account):

```powershell
npm run collector -- pin swati
npm run collector -- login swati
```

The PIN prompt is hidden. The headed, dedicated Chrome profile lets you complete
sign-in, OTP and account checks yourself. Confirm the account alias at the terminal.
The scheduler later uses that profile headlessly. A changed PIN form, wrong PIN,
sign-out or security challenge stops automatic login. A persisted pending PIN flag
prevents repeated PIN attempts after a crash. Use `login ACCOUNT` to inspect the
account and clear its block; use `pin ACCOUNT` first if the PIN changed. This is
collection only; no trading commands are provided.

```powershell
npm run collector -- enable
npm run collector -- run --dry-run
npm run collector -- run --force
npm run collector -- install
npm run collector -- status
```

`enable` automatically selects a single accessible folder named market-data. If
several exist, set `rootId` explicitly in the private config before enabling. A
quote-only run can reuse existing legacy snapshots before Groww profiles are
enrolled; the status file identifies accounts still needing setup. Review a forced
run before installing. `--force` intentionally bypasses market-hours/disabled
gates for manual checks. Regular scheduled runs honor both.

Private state defaults to `%LOCALAPPDATA%\MarketViewCollector`, outside Git. The
config contains account aliases, provider, schedule and root ID; secrets are in an
AES-256-GCM vault whose random key is in Windows Credential Manager for the current
user. Dedicated Chrome profiles use Chrome's own local security and the private
directory ACL. Source-body caches and checkpoint files contain financial data;
keep the entire directory private. Do not sync it into market-data. Every command
supports `--home C:\private\collector` for a separate installation.

The task named **MarketView Progressive Collector** polls locally each minute.
Only due runs use the network: normally every 9-11 minutes during 09:15-15:30 IST,
Monday-Friday excluding the bundled NSE holidays. The computer must be awake and
this Windows user logged in; the task does not store a Windows password. Disable
collection with `npm run collector -- disable`, or remove the named task in Task
Scheduler. Keep this checkout and the installed Node path available.

`automation/calendar.json` currently covers 2026, using the
[NSE holiday circular](https://archives.nseindia.com/content/circulars/CMTR71775.pdf).
Unknown years stop with CALENDAR_REQUIRED. Update the verified year/holiday list
before the next year; optional `specialSessions` maps dates to `[open, close]` IST
times for explicitly verified special sessions. The bundled list does not enable
Muhurat sessions automatically.

## Quote providers

Default `groww-public` reuses the original collector's public company-resolution
and price endpoints, with requests spaced 300ms apart and symbol mappings cached.
No Groww account session is required for this lane. These website endpoints are
not a guaranteed public API. Access blocks/rate limits stop requests and retain
dated values; the worker does not evade them. It cannot guarantee that Groww will
permit the cadence indefinitely.

If you have official Groww API access, enter a token through
`npm run collector -- api-token`, and set `priceProvider` to `groww-api` in the
private config. The official LTP lane batches up to 50 instruments per request:
[Groww LTP API](https://groww.in/trade-api/docs/curl/live-data).
Instrument mapping still uses cached Groww company metadata. Renew API tokens as
required by Groww. Screener is not implemented as a quote provider.

## Moving to another computer

```powershell
npm run collector -- export C:\private\family.transfer.json
# On the new machine, after npm ci and collector init:
npm run collector -- import C:\private\family.transfer.json
```

The transfer uses a separate 12+ character master passphrase with scrypt and
AES-GCM. It includes encrypted PINs, offline Google credentials and Groww-only
cookies/localStorage/IndexedDB captured during enrollment or collection. It
excludes Google browser cookies. Treat the bundle like account access: keep it
private, transfer it securely and do not put it in Git or the shared data folder.
The new machine re-encrypts it under its own Credential Manager key and leaves
scheduling disabled. Browser sessions can expire or be bound to the original
machine; full Chrome profile folders are not reliably portable. Fresh Groww login
may be necessary. Disable the old machine before enabling the new worker.

## Verification

```powershell
npm test
$env:COLLECTOR_BROWSER_TESTS='1'; npm test
npm run build
```

The opt-in browser test uses synthetic HTML in headless Chrome, never a real
account. Unit tests cover daily versus quote cadence, missed-day recovery,
incomplete rows, PIN blocks, authenticated vaults, shared prices, quote failures,
timestamp provenance and upload visibility. Live end-to-end collection requires
the account enrollments and Google offline consent above.

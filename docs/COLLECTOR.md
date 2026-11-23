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

## Chrome extension setup

The recommended holdings lane uses your existing, ordinary Chrome profiles.
Google sign-in is manual in normal Chrome. Playwright does not control sign-in.
No browser cookies are copied or exported by the extension.

1. Open **Market Collector Admin** from the desktop shortcut or repository launcher.
2. For an account, click **Open account Chrome profile**. This opens its original
   profile's `chrome://extensions` page without automation/debugging flags. If no
   profile suggestion exists, open the correct profile yourself.
3. In that Chrome profile enable Developer mode, choose **Load unpacked**, and
   select the `extension` folder in this checkout. Keep the folder in place.
4. In Collector Admin, click **Pair Chrome extension** for the account. Copy its
   one-time code into **Market Family Collector** in that Chrome profile. Codes
   expire after ten minutes and are consumed once.
5. The extension displays the account nickname. Check the profile/account yourself
   and explicitly confirm. It then attempts one initial holdings capture.
6. If Groww asks for sign-in or OTP, click **Open Groww to sign in** in the
   extension and complete it manually in ordinary Chrome, then capture again.
   No Google page is scripted. Enter a Groww PIN in the admin page if unattended
   PIN unlock is wanted; manual Groww unlock also works.
7. Connect Google Drive in Collector Admin and start automatic collection. Repeat
   installation/pairing for the other account profiles. One profile is paired
   with one account; a replacement pairing invalidates its previous token.

The extension requests `storage`, `alarms`, `scripting`, and host access only to
`https://groww.in/*` and IPv4 loopback. Chrome may ask you to allow Groww or local
network access. The code performs no order placement, transfers or withdrawals.
It reads holdings from an inactive tab that it creates and closes, including on
failure; it does not close an existing user tab. PIN filling runs only in a
recognised Groww PIN form on the exact HTTPS groww.in origin.

The local bridge is part of the admin server on `127.0.0.1:5186`. Scheduled worker
ticks ensure it is running without opening an admin tab. Pairing tokens are
restricted to an account, Chrome extension ID and per-profile client ID; the
server stores their hashes in the encrypted Windows vault. The extension keeps
its token in private Chrome local extension storage, never its PIN. Groww or
Google pages cannot call the privileged runtime message handler. Pairing can be
revoked from the local admin page.

After confirmation, alarms check the bridge once a minute. Automatic holdings
capture happens once per market day when the account's Chrome profile is running,
the collector is enabled and the verified NSE calendar permits it. The computer
must be awake. The extension cannot run in a closed/unloaded Chrome profile and
does not promise a headless browser. Missed days capture the latest state on the
next eligible run. **Reconcile positions** queues a manual capture for the
next poll; **Capture holdings now** in the extension can run while paused or
outside market hours. These actions still respect PIN attempt protection.

PIN release requires an authenticated, confirmed pairing and an unexpired capture
nonce. The pending-attempt guard is persisted before the PIN is returned once
to the extension's memory. A failure/crash blocks further PIN releases. Unlock
Groww manually, then capture successfully to clear the guard, or explicitly
re-pair and confirm the account after correcting its PIN. Login challenges stop
capture and back off; no challenge is bypassed.

Accepted holdings are validated and stored as an encrypted inbox in the same
private vault. Capture times are preserved. If Google/root setup is ready, the
bridge starts a worker run to publish the observations and update the shared
cache; otherwise the next configured worker run can consume them. The worker
never opens Playwright for accounts using the extension lane. Prices continue to
refresh for all accounts using the last known positions even when Chrome is closed.

The previous isolated-profile/browser commands below remain for compatibility;
extension pairing switches the local collector to the extension holdings lane.
Machine transfer requires installing and pairing the extension again. Runtime
tokens, codes, inbox data and PINs are never included in the extension source or
the public Pages build.

### Reconciliation progress

Every account has a **Reconcile positions** button and an explicit **Positions
reconciled** timestamp. Unpaired accounts show the button disabled with a pairing
hint. Paired accounts queue a fresh Groww capture for the extension; the action
does not require a terminal or opening the extension popup.

The button shows a small spinner with **Waiting for Chrome** or **Reconciling**
while that request is active. Its status line distinguishes capture received
locally, waiting for Drive/cache publication, full success, and failure. Success
is recorded only after the matching capture is published and the shared cache
finishes. If Google is unconfigured or the worker is busy, the local capture is
retained and the status says it is awaiting sync. Publication failure keeps that
capture and offers Fetch now as the retry path.

Queued requests time out after five minutes without a response; active capture
uses its three-minute request deadline. Missing or closed Chrome therefore does
not leave an endless spinner. Duplicate requests reuse the active operation.
Status is kept with the encrypted extension record and survives an admin reload.
Private request nonces and tokens are excluded from public admin status.

**Fetch now** updates available saved positions, shared prices and the cache. Its
own button and inline status show working, succeeded, failed, or partly updated
with pending-account/price counts. Partial runs are not presented as full success.
The worker also persists a summary so a page/server restart retains the last run's
partial outcome. PIN, pairing, folder and scheduling actions have local button
feedback. Animation honors the reduced-motion preference.

## Admin page (recommended)

Double-click **Collector Admin.vbs** in the repository to open the local admin
page. On this installation it is also available from the desktop shortcut.
An existing running admin instance is reused. Node 22+ and `npm ci` are one-time
prerequisites; routine setup and operation do not need a terminal. A startup
message explains missing prerequisites or a local port conflict.

The page provides:

- Hidden PIN entry and encrypted save for each account; saved PINs are never returned.
- A separate Groww Chrome window per account, with manual OTP/login as needed.
- An explicit account-nickname confirmation after holdings load. Enrollment is
  incomplete until confirmed; cancel closes the window and releases the worker lock.
- Google Drive offline consent using a Desktop OAuth client file selected once.
  Subsequent connections reuse the encrypted client registration.
- Shared-folder selection, account addition, start/pause scheduling, Fetch now,
  and account/checkpoint status.

The server listens only on `127.0.0.1:5186`. The launcher opens a private session
using a random bootstrap key, exchanged for an HttpOnly SameSite cookie. API
requests require the local Host, same-origin POSTs and an explicit request header.
The bootstrap key is removed from browser history. PINs never go into browser
storage, URLs or API responses. The ephemeral admin key lives in the private
collector directory and changes on server restart. This page and its server are
excluded from the GitHub Pages build. Use it on the Windows collector computer;
the public portfolio page cannot enroll local Chrome accounts or unlock the vault.

Setup jobs and PIN/config changes share the collector's process lock so scheduled
runs cannot overwrite their saved credentials. Account enrollment can be cancelled
from the page. An in-progress Fetch now is allowed to finish. Closing the admin tab
does not stop the scheduled collector; pause it from the page when required.

The equivalent optional launch commands are `npm run admin` or
`npm run collector -- admin`. The command-line setup below remains available.

### Reusing existing Chrome sessions

Each account has a **Chrome session** selector. Existing isolated profiles from
the original sibling `market/data/cache/chrome` store are discovered by directory
metadata and offered as **Saved collector** sessions. Choose one and enroll; the
actual session directory is reused without copying cookies or changing your
normal Chrome profile. Its account association is saved only after you confirm
the visible account nickname. Cancel leaves the previous association unchanged.

On this installation the original mapping is swati=Profile 2, anna=Profile 4,
aai=Profile 5, bunny=Bunny, teju=Profile 1. These are local setup suggestions,
not automatic enrollment or proof that a session is still signed in. A valid
Groww session can avoid another Google login; an expired/revoked session still
requires Groww authentication. If another collector/browser holds the saved
profile, close that collector window and retry. No process is killed and no
profile lock file is removed automatically.

Normal Chrome's default user-data tree is rejected for automated profile access.
Chrome 136+ restricts debugging that directory; this implementation neither
disables that protection nor tries to decrypt or extract the main profile's
cookies. The separate private collector profile remains available as a fallback.
Cross-machine imports clear machine-specific profile paths and restore only the
encrypted Groww session state, which may require fresh authentication.

### Private file locations

- Encrypted PINs, Google offline credentials and Groww session exports:
  `%LOCALAPPDATA%\MarketViewCollector\secrets.enc.json`.
- AES key: the current Windows user's Credential Manager, under a
  `MarketView/Collector/...` entry; no key file is committed.
- Private collector Chrome directories:
  `%LOCALAPPDATA%\MarketViewCollector\profiles\<account>`.
- Reused original collector directories: the existing ignored
  `market/data/cache/chrome/<profile>` locations; no new copy is made.
- Ordinary Chrome profiles remain in
  `%LOCALAPPDATA%\Google\Chrome\User Data`.

Collector state stays outside market-view. Git ignore rules also cover encrypted
vaults, transfer bundles, profiles and Chrome credential databases if accidentally
copied into the checkout. The static build copies neither automation nor private
runtime files. Browser profiles use Chrome's own local storage protections; they
are not encrypted by the collector PIN vault.

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

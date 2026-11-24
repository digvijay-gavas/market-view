# Market Dashboard

An independent static investment dashboard with read-only portfolio sources and a family-shared Drive dashboard cache. It reads a Market v1 store directly from Google Drive with Google Identity Services, calculates in the browser, and works on GitHub Pages. The original Python server is not used.

Repository: [digvijay-gavas/market-view](https://github.com/digvijay-gavas/market-view). After Pages is enabled and deployed, the site address is `https://digvijay-gavas.github.io/market-view/`. Its Google OAuth JavaScript origin is `https://digvijay-gavas.github.io` (no repository path).

## Run locally

Node.js 22+ is needed only for development and checks. There are no package dependencies.

```sh
npm test
npm run build
npm run dev
```

Open http://127.0.0.1:5174. Use a Google **Web application** OAuth client with that exact Authorized JavaScript origin. Enable Drive API, configure consent/test users, and paste the public client ID into the page. Never use the original desktop client secret. Full browser instructions are in [SETUP.html](SETUP.html).

## Data and permissions

Choose the existing `market-data` folder, or any root folder with this layout:

```text
_schema/catalog.json
groww.live_holdings/<account>/YYYYMMDDTHHMMSSZ__<12 lowercase hex>.json
groww.dividend_report/<account>/YYYYMMDDTHHMMSSZ__<12 lowercase hex>.json  # optional
_log/<writer>.jsonl                                                  # optional
```

The store catalog and envelope must be v1. Account partitions are discovered from Drive, not bundled in code. Duplicate Drive folders are merged. Snapshots accept only exact filenames; incomplete/conflict files are ignored. Latest valid captures win per holdings account, including empty captures. Cumulative dividend reports are deduplicated. Unsupported or malformed snapshots are warned about; missing cost/value inputs make affected totals unavailable. Known P&L-only accounts are excluded with a warning.

No real data is bundled. `examples/` has a **synthetic compatible store template**, schema and preparation script. You do not need it if your existing Market store has holdings captures. To populate a new store, follow [examples/README.md](examples/README.md). This frontend never writes source captures: placing/updating real files in Drive is a separate user/writer action.

The source-reading scope is `https://www.googleapis.com/auth/drive.readonly`: read access to all Drive files accessible to the signed-in user, **not folder-scoped permission**. `drive.file` does not provide read access to an arbitrary pre-existing store created by another app. Requests are limited by this app to the selected root and the supported store files. Viewer access is sufficient. Each active user token is used only for that user's Drive requests. Users with access to the same shared folder intentionally see the same data; account dropdowns are not security boundaries.

The user-requested refresh restoration stores only the short-lived Google access token, its expiry, matching public client ID and selected folder ID in tab-scoped sessionStorage. An unexpired session automatically reloads its folder from Drive after refresh; cached portfolio data is shown immediately while Drive metadata is checked for changes. Disconnect, account selection, expiry or an HTTP 401 clears the stored session and displayed data; pending requests are aborted and stale responses ignored. Malformed or client-mismatched sessions are discarded. The public web client ID and per-folder account-selection preferences use localStorage. Storage-blocked browsers still work for the current page but cannot restore it after reload. IndexedDB holds session-scoped portfolio data, but never credentials. No analytics, refresh token, credential file or service worker is used. Disconnect does not revoke Google's consent or sign out of Google globally. The static build is an allowlist: only `index.html`, `SETUP.html`, `privacy.html`, `terms.html`, `.nojekyll`, and `src/` are deployed.

## Refresh and long-running displays

Refresh restores the same tab's unexpired Google access token and reopens its selected Drive folder without a new Google popup. The token is not put in localStorage, source files or the repository. Disconnect clears tab storage; reconnecting/account selection begins a fresh session. A rejected/expired token returns to the connection screen. Browser session restoration may preserve sessionStorage, but the token expiry is always checked before use.

This does not make Google access perpetual. GIS access tokens are short-lived; after expiry or revocation, Google may require a user-driven reconnect even when the user remains signed in to Google. A fully unattended 24/7 refresh-token service would require a separate backend authorization-code flow and is not claimed here.

## Dashboard views

The loaded portfolio uses viewport-sized tabs: **Overview**, **Holdings**, **Allocation**, **Data**, and **About**. The page itself does not scroll. Holdings has an independently scrollable table with sticky column headings and a keyboard-focusable list region. Account selection remains available above every view.

Capture details and warnings are paginated instead of extending the page. Narrow screens show one allocation chart at a time with Accounts / Largest holdings controls, and fewer account-source entries per page. Tab navigation supports Left/Right arrows, Home and End. The large introduction is removed after loading data; setup instructions remain a separate help page.

The synthetic dense preview (`http://127.0.0.1:5175/?dense=1`) has 40 invented holdings and five accounts for layout checks. All five views were checked at desktop and narrow-screen sizes for page overflow and clipped panel content; only the holdings list has internal scrolling. No real portfolio data is part of that fixture.

## Calculations and limits

- Value: source `current_value`, otherwise `qty × ltp`; cost: `invested`, otherwise `qty × avg_price`. Zero is a real number; null/absent is missing.
- Unrealised P&L: value minus cost. Return: P&L / cost. Group positions by exact Groww slug, never fuzzy names.
- Allocation and top-five concentration use captured market value. Combined capture dates can differ and are shown per account.
- Dividend credits are deduplicated by `(account, isin, ex_date, shares, amount)` across all report dates; shown separately and with partial-coverage warnings.
- Captured prices are **not live**. Refresh rereads Drive. No daily price change, balance history, realised-return reconstruction, tax estimates or total net worth is fabricated.
- Confirmation logs identify rechecks of the same content hash; capture/as-of timestamps remain distinct. Data freshness reflects snapshots and logs, not quote freshness.

## GitHub Pages

The repository should remain private if the account plan supports Pages from private repositories. Otherwise a public **frontend-only** repository can host the same code. A private source repository usually does **not** make the Pages site private. This repository contains no private investment data either way.

1. In repository Settings → Pages, choose **GitHub Actions** as the source. Private-repository Pages generally requires GitHub Pro/Team or Enterprise; verify the actual account entitlement.
2. Run **Validate static dashboard** or let it run on push.
3. When ready to publish, run **Deploy Pages (explicit manual approval)** and set `publish_site` to true. The workflow is intentionally manual; pushes do not publish a site. The `github-pages` environment can require a reviewer.
4. For the resulting `https://OWNER.github.io/REPOSITORY/` URL, register `https://OWNER.github.io` as the Google OAuth JavaScript origin. Relative paths support a repository subpath. No OAuth secret or token is needed in GitHub Actions or repository settings.

The app supports an encrypted public client ID in `src/config.js`, unlocked with a PIN. When no encrypted configuration is set, it asks for the public client ID at runtime. The client ID is not a secret. Never upload portfolio files or OAuth desktop JSON into this repository. Production changes require a new manual deployment.

## Validation

`npm test` covers aggregation, partial inputs, empty accounts, dividend overlap/account separation, snapshot validation/fallback, confirmation hash matching, Drive pagination, and read-only authenticated requests. CI runs tests and the allowlisted static build. Browser validation can cover the disconnected and synthetic mocked-data interface; real Google authorization requires the user's web OAuth client and consent. Synthetic fixtures are never shown in the production app automatically.

For development against your real data without Google sign-in, run `npm run dev:local` and open `http://127.0.0.1:5174/`. It serves `src/` directly (no build step; reload to see edits), skips the PIN and OAuth popup, and reads Drive through the local server using the collector's saved Google credentials (connect Google in the collector admin first). The production site (GitHub Pages) is unaffected: this mode lives only in `scripts/dev-local.mjs` and is never copied into `dist/`. It is read-only by default, so dev code cannot overwrite the shared dashboard cache that production reads. Set `MV_DEV_CACHE_WRITE=1` to allow cache writes and `MV_DEV_LATENCY=600` to add delay per Drive call so it feels like production speed.

For an explicit local synthetic UI check, run `npm run test:preview` and open `http://127.0.0.1:5175/`. This separate test server mocks Google and Drive using invented data; use `synthetic.apps.googleusercontent.com` as the client ID and `synthetic-root` as the folder ID. It is never copied into `dist/`. Disconnect should remove all portfolio values and account options. The production preview remains `http://127.0.0.1:5174/` and always uses real Google authorization.

## Primary references

- [Google Identity Services token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Drive files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)
- [GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages)
- [Pages site visibility](https://docs.github.com/en/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site)

## Incremental browser cache

IndexedDB caches the last loaded portfolio and downloaded file contents within a random sign-in scope. Refresh shows the cached portfolio immediately, clearly marks the Drive check as pending, then lists current Drive metadata. File version (or checksum/modification metadata) determines whether content needs downloading. Missing revision metadata forces a download. Folder listings still run to discover additions, changes and removals; unchanged file bodies are reused. Totals are rebuilt from the current listing so deleted captures do not remain in the portfolio.

Credentials are never written to IndexedDB. Disconnect/account switching clears the active scope. Cache records expire with the Google token and expired records are removed when the database next opens. Browser storage can also be cleared manually. Blocked storage falls back to ordinary Drive reads. A failed network check retains explicitly dated cached data; authentication failure clears it, and access-denied/deleted-source failures hide it. This improves refresh speed without claiming that a cached capture is a live market quote.

## Cash equivalent on Overview

The user-designated LIQUIDCASE reserve is shown separately as Cash equivalent, using its captured current value and the selected account filter. The exact known Groww slug is `zerodha-nifty-d-rate-liquid-etf`; an exact LIQUIDCASE symbol/name is also recognized. Other liquid funds are not guessed. It remains a holding and is included once in total portfolio value, invested cost and return. Other holdings excludes this reserve. This is a display classification, not a bank balance. Missing values remain unavailable; no matching holding yields zero.

## Open holdings XIRR

Overview shows annualised money-weighted return for the selected current holdings, including LIQUIDCASE. The newest available P&L report period on or before the holdings valuation date supplies open purchase lots. Matching uses the original Market public Groww/NSE identifier registry to join by exact ISIN; otherwise it requires an exact company name (case and whitespace normalized), unambiguous ISIN, matching quantities and matching invested cost (within report rounding tolerance). Missing accounts, dates, values, mismatches or mixed valuation dates yield Unavailable with a reason. No buy dates are invented. Captured value is the terminal positive cash flow; dated purchases are negative. Day counts use 365 days per year. Closed positions and dividends are excluded, so this is explicitly not a lifetime account return. Lot files participate in the same versioned browser cache.

Calculation convention: [Microsoft XIRR reference](https://learn.microsoft.com/en-us/office/vba/api/excel.worksheetfunction.xirr). This implementation restricts supported flows to dated open purchases and one terminal captured value.

## Gold on Overview

GOLDCASE (`zerodha-gold-etf`, or an exact GOLDCASE symbol/name) is shown as Gold with a portfolio percentage and a gold highlight. Other holdings excludes both GOLDCASE and LIQUIDCASE. Both remain included once in portfolio totals and XIRR. The account filter applies. Saved dividend credits have a dedicated Overview card. Current value and unrealised P&L share one card, keeping six summary cards and avoiding page scrolling.

## Account selection and automatic refresh

Choose any combination in the account checkbox menu, or use Select all / Clear. Selection is saved per OAuth client and Drive folder in localStorage and reapplied after reload and data updates, across every view and calculation. The preference contains only account partition names, not tokens or portfolio amounts. Accounts absent from the current Drive result never contribute values. A blocked-storage message explains when a choice cannot be saved.

The dashboard checks Drive every four hours after the last successful read. Focus, visibility, page restoration and connectivity events check the elapsed wall-clock time so overdue work starts immediately after a missed interval. Concurrent events do not create overlapping reads. Failed checks retry after five minutes without advancing the success timestamp. This is an in-page timer, not an operating-system background job: it requires an open tab, connectivity and a valid Google token. Google tokens generally expire before four hours in this static token flow; reconnecting remains necessary. It cannot guarantee unattended refresh after authorization expiry. Opening/restoring a signed-in dashboard already performs a Drive check, while keeping cached values visible.

## Public OAuth branding links and PIN configuration

Google consent-screen links for this deployment:
- Home: https://digvijay-gavas.github.io/market-view/
- Privacy: https://digvijay-gavas.github.io/market-view/privacy.html
- Terms: https://digvijay-gavas.github.io/market-view/terms.html

These pages are public and accessible without Google sign-in or the app PIN. Google branding/domain/scope verification is a separate process; deployment does not complete that process.

The public OAuth client ID can be stored as encrypted configuration in `src/config.js`. A user-chosen PIN derives an AES-256-GCM key with PBKDF2-SHA-256 (600,000 iterations). A random 16-byte salt and 12-byte IV are committed with the ciphertext; no hardcoded PIN or encryption key is committed. The PIN is entered on each page load and is not remembered. This is a convenience lock for a public identifier, not access control for a public static site. Google authorization and Drive permissions remain the data-access controls. Short PINs can be guessed offline by someone who downloads the configuration. Google tokens still use tab-scoped sessionStorage after authorization.

After Google authorization, a single accessible folder named `market-data` opens automatically. Multiple matching folders require selection; no matching folder shows the existing folder-link entry. A restored session reloads its previously selected folder. Change folder remains available.

## BM on mobile and historical membership

Holdings offers All holdings, BM, Not held and Removed filters. BM includes current constituents not held in the selected accounts as labelled placeholders; placeholders never affect portfolio totals. Mobile uses compact holding cards and one page scroll: the header, tabs and filters scroll away, leaving the screen for the holdings. Desktop keeps its bounded scrolling table. Removed badges require a matching member in an older validated `smallcase.constituents/bamimo_0002` capture and absence from the latest capture. Missing history is stated explicitly; other holdings are not guessed to be former members.

BM target weights now cover the full current lineup, including missing members, and sum to 100%. BM current uses only selected BM holdings. This replaces the earlier held-only renormalisation so missing positions have comparable target/current percentages. Targets use the latest saved capture; dates remain visible. Membership resolves by explicit slug/ISIN or unique normalized full company name/Groww slug; ambiguous entries are marked unresolved.

## Family-shared Drive dashboard cache

Every account reads the same `market-data/_market-view-dashboard-cache.json` in the selected source folder. The file inherits the folder’s existing sharing; the app does not create or modify permissions. A reader needs only `drive.readonly`. Selecting an account within the portfolio remains a local display preference; only the all-accounts computed view is published alongside sanitized source inputs. Tokens, PINs and client secrets are never cached. Cache files inherit the existing folder permissions, so family Editors can update or remove them without individual cache permission changes. Google write consent is per user/app, not per cache generation.

An editor can select **Allow shared cache updates (folder editors)** before Google login. This is enabled by default for family use (uncheck for a read-only login), requests `https://www.googleapis.com/auth/drive` in addition to source-reading access, and allows cache creation/updates only when Drive reports the necessary folder/file editor capabilities. Google’s scope is broad; application code restricts mutations to the exact named JSON cache directly inside the selected root. No original source captures or permissions are modified. Viewers never attempt writes. Previous `drive.appdata` consent does not become editor permission.

The cache is keyed by a SHA-256 manifest of source snapshot filenames, file revisions, partitions and schema catalog. Logins check this metadata in the background without downloading snapshot bodies. Unchanged inputs reuse the same calculations regardless of cache age; confirmation logs and cache writes do not invalidate them. New or changed snapshot inputs trigger a rebuild by a permitted editor. The open tab checks metadata every four hours. Reader logins reuse the shared cache with its visible age; **Refresh snapshots** checks metadata immediately and only rebuilds if inputs changed. Read-only users can request a local rebuild for new inputs; only an editor publishes it for everyone. An editor’s manual refresh also publishes the updated shared file. Background updates preserve current filters/search/account selection. Failed updates retain explicitly dated cached data; lost source access or expired Google auth hides it. Wrong-root, invalid, future and old calculation-version caches are ignored. Age alone does not invalidate a cache when its source manifest still matches.

To initialize, one family member with folder editor access reconnects with shared-cache updates enabled and grants the Drive write scope. After the dashboard finishes, it creates the named file in `market-data`. Other family accounts benefit with read-only logins and do not create separate cache files. The cache can be deleted from the shared folder like an ordinary file; an opted-in editor recreates it on the next refresh. Previous private app-data caches are no longer used and can be removed through Drive’s Manage apps settings if desired. Existing source/browser storage rules remain as documented above.

The Google Cloud OAuth consent configuration must include the `drive` scope for optional editor logins. A reader does not need that scope. Automatic updates require an open tab and valid Google access. Synthetic fixture options `?bm=1&history=1&dense=1` demonstrate BM states; an editor can opt in to shared updates, then a new read-only fixture login reuses the same synthetic cache. No synthetic data is deployed.


## Progressive Windows collector

The optional local worker separates daily account position reconciliation from
shared price observations about every ten minutes during NSE market hours. One
instrument universe serves all family accounts, and calculated results go into
the same shared market-data dashboard cache. The viewer shows separate position
and price timestamps and checks progressive stores every five minutes while
signed in. Legacy stores keep the four-hour browser check interval.

See [collector setup and recovery](docs/COLLECTOR.md) for encrypted Windows
Credential Manager setup, account enrollment, scheduling, provider choices,
machine transfer and missed-day behavior. See [ARC-0001](docs/ARC-0001.md) for the
implemented architecture. This worker runs on an awake Windows machine; GitHub
Pages does not run it. Real account authentication is a separate setup step.

Double-click **Collector Admin.vbs** for local PIN entry, Groww enrollment, Google
Drive connection, scheduling controls and status. The admin page runs only on the
collector computer and is excluded from GitHub Pages. See the [admin setup guide](docs/COLLECTOR.md#admin-page-recommended).

The Chrome extension now collects holdings inside existing signed-in profiles.
See [extension setup](docs/COLLECTOR.md#chrome-extension-setup). Pair it from the
local admin UI; Google login remains manual in regular Chrome. The background
worker publishes validated captures, prices and the family-shared Drive cache.


### Collection controls

Collector Admin includes per-account **Reconcile positions**, global **Reconcile
all**, and **Fetch now**. Manual collection opens a temporary window in each paired
account's existing normal Chrome profile, collects holdings, closes its window,
then updates shared prices and the family cache once. Other open Chrome tabs and
windows are preserved. Expired logins/OTP still require manual sign-in.

Set the price interval (5-240 minutes) and holdings cadence (once per market day
or every update), then use **Start automatic collection**. The Windows task checks
NSE hours/holidays and adds up to one minute of timing jitter. This PC must be awake
and the Windows user signed in; the admin panel may be closed. **Recent syncs**
shows the last eight of twelve saved attempts, including account failures.

After updating an existing unpacked installation, reload **Market Family
Collector** once in `chrome://extensions` in each paired profile. Login and pairing
remain saved. The local runner has no credentials; authenticated account-specific
tokens are still required. PINs, session data and runtime history remain outside
Git under the private collector home. Collection does not submit buy/sell orders.

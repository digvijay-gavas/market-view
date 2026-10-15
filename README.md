# Market Dashboard

An independent, read-only static investment dashboard. It reads a Market v1 store directly from Google Drive with Google Identity Services, calculates in the browser, and works on GitHub Pages. The original Python server is not used.

Repository: [digvijay-gavas/market-view](https://github.com/digvijay-gavas/market-view). After Pages is enabled and deployed, the site address is `https://digvijay-gavas.github.io/market-view/`. Its Google OAuth JavaScript origin is `https://digvijay-gavas.github.io` (no repository path).

## Run locally

Node.js 22+ is needed only for development and checks. There are no package dependencies.

```sh
npm test
npm run build
npm run dev
```

Open http://127.0.0.1:5173. Use a Google **Web application** OAuth client with that exact Authorized JavaScript origin. Enable Drive API, configure consent/test users, and paste the public client ID into the page. Never use the original desktop client secret. Full browser instructions are in [SETUP.html](SETUP.html).

## Data and permissions

Choose the existing `market-data` folder, or any root folder with this layout:

```text
_schema/catalog.json
groww.live_holdings/<account>/YYYYMMDDTHHMMSSZ__<12 lowercase hex>.json
groww.dividend_report/<account>/YYYYMMDDTHHMMSSZ__<12 lowercase hex>.json  # optional
_log/<writer>.jsonl                                                  # optional
```

The store catalog and envelope must be v1. Account partitions are discovered from Drive, not bundled in code. Duplicate Drive folders are merged. Snapshots accept only exact filenames; incomplete/conflict files are ignored. Latest valid captures win per holdings account, including empty captures. Cumulative dividend reports are deduplicated. Unsupported or malformed snapshots are warned about; missing cost/value inputs make affected totals unavailable. Known P&L-only accounts are excluded with a warning.

No real data is bundled. `examples/` has a **synthetic compatible store template**, schema and preparation script. You do not need it if your existing Market store has holdings captures. To populate a new store, follow [examples/README.md](examples/README.md). This frontend has no writer: placing/updating real files in Drive is a separate user/writer action.

The requested scope is `https://www.googleapis.com/auth/drive.readonly`: read access to all Drive files accessible to the signed-in user, **not folder-scoped permission**. `drive.file` does not provide read access to an arbitrary pre-existing store created by another app. Requests are limited by this app to the selected root and the supported store files. Viewer access is sufficient. Each active user token is used only for that user's Drive requests. Users with access to the same shared folder intentionally see the same data; account dropdowns are not security boundaries.

The user-requested refresh restoration stores only the short-lived Google access token, its expiry, matching public client ID and selected folder ID in tab-scoped sessionStorage. An unexpired session automatically reloads its folder from Drive after refresh; cached portfolio data is shown immediately while Drive metadata is checked for changes. Disconnect, account selection, expiry or an HTTP 401 clears the stored session and displayed data; pending requests are aborted and stale responses ignored. Malformed or client-mismatched sessions are discarded. Only the public web client ID uses localStorage. Storage-blocked browsers still work for the current page but cannot restore it after reload. IndexedDB holds session-scoped portfolio data, but never credentials. No analytics, refresh token, credential file or service worker is used. Disconnect does not revoke Google's consent or sign out of Google globally. The static build is an allowlist: only `index.html`, `SETUP.html`, `.nojekyll`, and `src/` are deployed.

## Refresh and long-running displays

Refresh restores the same tab's unexpired Google access token and reopens its selected Drive folder without a new Google popup. The token is not put in localStorage, source files or the repository. Disconnect clears tab storage; reconnecting/account selection begins a fresh session. A rejected/expired token returns to the connection screen. Browser session restoration may preserve sessionStorage, but the token expiry is always checked before use.

This does not make Google access perpetual. GIS access tokens are short-lived; after expiry or revocation, Google may require a user-driven reconnect even when the user remains signed in to Google. A fully unattended 24/7 refresh-token service would require a separate backend authorization-code flow and is not claimed here.

## Dashboard views

The loaded portfolio uses viewport-sized tabs: **Overview**, **Holdings**, **Allocation**, **Data**, and **About**. The page itself does not scroll. Holdings has an independently scrollable table with sticky column headings and a keyboard-focusable list region. Account selection remains available above every view.

Capture details and warnings are paginated instead of extending the page. Narrow screens show one allocation chart at a time with Accounts / Largest holdings controls, and fewer account-source entries per page. Tab navigation supports Left/Right arrows, Home and End. The large introduction is removed after loading data; setup instructions remain a separate help page.

The synthetic dense preview (`http://127.0.0.1:5174/?dense=1`) has 40 invented holdings and five accounts for layout checks. All five views were checked at desktop and narrow-screen sizes for page overflow and clipped panel content; only the holdings list has internal scrolling. No real portfolio data is part of that fixture.

## Calculations and limits

- Value: source `current_value`, otherwise `qty × ltp`; cost: `invested`, otherwise `qty × avg_price`. Zero is a real number; null/absent is missing.
- Unrealised P&L: value minus cost. Return: P&L / cost. Group positions by exact Groww slug, never fuzzy names.
- Allocation and top-five concentration use captured market value. Combined capture dates can differ and are shown per account.
- Dividend credits are deduplicated by `(account, isin, ex_date, shares, amount)` across all report dates; shown separately and with partial-coverage warnings.
- Captured prices are **not live**. Refresh rereads Drive. No daily price change, balance history, XIRR, realised-return reconstruction, tax estimates, cash, or total net worth is fabricated.
- Confirmation logs identify rechecks of the same content hash; capture/as-of timestamps remain distinct. Data freshness reflects snapshots and logs, not quote freshness.

## GitHub Pages

The repository should remain private if the account plan supports Pages from private repositories. Otherwise a public **frontend-only** repository can host the same code. A private source repository usually does **not** make the Pages site private. This repository contains no private investment data either way.

1. In repository Settings → Pages, choose **GitHub Actions** as the source. Private-repository Pages generally requires GitHub Pro/Team or Enterprise; verify the actual account entitlement.
2. Run **Validate static dashboard** or let it run on push.
3. When ready to publish, run **Deploy Pages (explicit manual approval)** and set `publish_site` to true. The workflow is intentionally manual; pushes do not publish a site. The `github-pages` environment can require a reviewer.
4. For the resulting `https://OWNER.github.io/REPOSITORY/` URL, register `https://OWNER.github.io` as the Google OAuth JavaScript origin. Relative paths support a repository subpath. No OAuth secret or token is needed in GitHub Actions or repository settings.

The app asks for the public client ID at runtime, so the hosted source contains no user-specific OAuth configuration. The client ID is not a secret. Never upload portfolio files or OAuth desktop JSON into this repository. Production changes require a new manual deployment.

## Validation

`npm test` covers aggregation, partial inputs, empty accounts, dividend overlap/account separation, snapshot validation/fallback, confirmation hash matching, Drive pagination, and read-only authenticated requests. CI runs tests and the allowlisted static build. Browser validation can cover the disconnected and synthetic mocked-data interface; real Google authorization requires the user's web OAuth client and consent. Synthetic fixtures are never shown in the production app automatically.

For an explicit local synthetic UI check, run `npm run test:preview` and open `http://127.0.0.1:5174/`. This separate test server mocks Google and Drive using invented data; use `synthetic.apps.googleusercontent.com` as the client ID and `synthetic-root` as the folder ID. It is never copied into `dist/`. Disconnect should remove all portfolio values and account options. The production preview remains `http://127.0.0.1:5173/` and always uses real Google authorization.

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

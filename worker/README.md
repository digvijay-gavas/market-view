# Price relay Worker

Groww's public price URLs work from a server but send no CORS header, so browsers block them.
This Cloudflare Worker relays read-only quotes to the GitHub Pages viewer.

- `GET /quotes?slugs=a,b,c` (up to 150 Groww stock slugs) returns `{quotes, failures, retryAfter}`.
- Only origins in `ALLOWED_ORIGINS` get a CORS header; anyone else gets `403`.
- Edge cache: stock → symbol lookups for 7 days, prices for 10 seconds, shared by every viewer.
- At most 4 upstream calls at a time. The first `429`/`403` from Groww stops the batch and returns `retryAfter`; the viewer then switches to on-demand.

## Deploy (one time)

```powershell
cd worker
npx wrangler login
npx wrangler deploy
```

Wrangler prints the URL, e.g. `https://market-view-prices.<your-subdomain>.workers.dev`.

1. Put that URL in `src/config.js` as `PRICE_PROXY_URL`.
2. In `index.html`, add that exact URL to `connect-src` (currently `https://market-view-prices.digvijay-gavas-v1.workers.dev`).
3. Commit and push; the Pages workflow publishes the viewer.

The free Workers plan (100k requests/day) is far more than this needs.

## Local testing

```powershell
node scripts/price-relay-dev.mjs
```

This runs the same handler on `http://127.0.0.1:5175` (without the edge cache). To try it with the site, build it,
then in `dist/` only, set `PRICE_PROXY_URL` to that URL and add it to the CSP `connect-src`.

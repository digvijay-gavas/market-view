# Synthetic store template

All values and identifiers in this folder are invented. Production never auto-loads them.

The existing Market v1 store is supported directly. If you prefer to prepare new JSON manually, use `holdings.template.json` as the versioned contract: one capture per account, `tables.holdings` containing source stock slugs, names, quantities and invested amounts. `avg_price`, `ltp`, `current_value` can be missing/null. Never substitute zero for unknown inputs. An empty holdings list explicitly means the account was checked and has no holdings.

1. Copy the template **outside this repository**. Replace its synthetic rows/account, as-of date, timezone-aware capture time and metadata with real source data. Remove `meta.synthetic` for real captures. Keep schema/store version 1.
2. Run `node scripts/prepare-snapshot.mjs /absolute/path/to/private-input.json /absolute/path/to/private-output` from this repo. The script validates inputs, computes the source-content SHA-256 and writes the correct immutable filename. Output must be outside the source repository. Never commit the input/output. Errors name malformed or missing fields.
3. In Google Drive, create a store root, then `_schema` and `groww.live_holdings/<partition>` subfolders. Upload `examples/catalog.json` as `_schema/catalog.json`. Upload the generated JSON into the matching partition folder. Retain historical filenames; the newest valid one is selected.
4. Open the dashboard, authorize your Google account, and paste the root folder link. Only people with Drive permission can read the data; Viewer is enough. The frontend never creates or updates the store.

Use an exact stable slug for each security across accounts. This reader deliberately does not guess ISINs from names. Optional dividend files use Market v1 `groww.dividend_report` envelopes with `tables.credits` rows: `isin`, `ex_date`, `shares`, `amount` (plus optional `name`, `per_share`). Repeated credits are deduplicated per account. The original Market writer already produces these files.

Snapshot filenames are `YYYYMMDDTHHMMSSZ__<first 12 content-hash hex digits>.json`; capture time must match the envelope in UTC. Hashes identify content for deduplication/confirmation, not signatures or authenticity guarantees. There is no daily-change field or live feed in this format.

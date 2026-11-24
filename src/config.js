// Price relay Worker (see worker/README.md). Empty disables live prices in the viewer.
export const PRICE_PROXY_URL='https://market-view-prices.digvijay-gavas-v1.workers.dev';
// Encrypted public OAuth client ID. The PIN is entered by the user, never committed.
export const oauthConfig=Object.freeze({
  "version": 1,
  "iterations": 600000,
  "salt": "JT+MY1xzP+bSA2et0QhulA==",
  "iv": "mta9ifD+bEKv8JMr",
  "ciphertext": "/Mqsi5GBlJYQQndJD32nvCIvk3qk5N1nrNK5PFOiIuH2t3lHthV7dn40f6uJZ8GpmEM3TN29K1SpbG3BF9gk+5BSfq8Ol6YuDmMDpC/78GThnK9gksZr"
});

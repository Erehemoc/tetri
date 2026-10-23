# ₾ Tetri

**A free, open-source USDC till for shops in Georgia.** Type a price in lari, show the QR, and the customer pays in USDC from any Solana Pay wallet, straight into the shop's own wallet.

**Live:** https://erehemoc.github.io/tetri/

- **No sign-up, no server, no custody.** The page is static. The shop's address lives in its own browser and in a bookmarkable link. Tetri never holds funds or keys.
- **Lari first.** Prices are entered in ₾ and converted at the live USDC/GEL rate. The rate is rounded *up* to the cent, so the shop never receives less than it asked for.
- **Three languages:** Georgian, Russian, English.
- **Checks the payment itself.** Each sale gets a unique Solana Pay `reference`. The page watches the chain for it and confirms the shop's USDC balance actually went up by the amount due. It doesn't just wait for "a transaction". Underpayments are shown as underpayments.
- **Records for the accountant.** Confirmed sales are kept in the browser and export to CSV: time, ₾, USDC, rate, transaction signature, note.

## How a sale works

1. Once: enter the shop name and the Solana address where USDC should arrive.
2. Type the amount in lari and tap **Show QR**.
3. The customer scans it with Phantom, Solflare or any Solana Pay wallet and approves.
4. Usually within seconds the till shows **Paid ✓** with the amount received, and the sale lands in the list.

## How it's built

| File | What it does |
|---|---|
| `core.js` | Pure functions: base58, address check, GEL→USDC rounding, the [Solana Pay](https://docs.solanapay.com/spec) URL, payment verification from balance deltas, CSV |
| `app.js` | The page: settings, rate fetch (CoinGecko), QR, polling `getSignaturesForAddress(reference)`, backing off when the public RPC rate-limits |
| `i18n.js` | UI strings in KA / RU / EN |
| `index.html` | Layout and styles. One third-party script: `qrcode-generator` from cdnjs, pinned with SRI |

By default the page uses PublicNode's free Solana RPC, which accepts requests from web pages; `api.mainnet-beta.solana.com` is a fallback, since it refuses browser requests for `getSignaturesForAddress`. That's enough for a few sales an hour. A busy till can paste its own endpoint (for example a free Helius key) under **Advanced**.

## Tests

```bash
node --test test/core.test.js      # logic, including verification against a real mainnet USDC transfer
python3 -m http.server 8765 &      # then, with Playwright and OpenCV installed:
python3 test/e2e.py                # sets up a till, charges 25.90 ₾, decodes the QR and checks the Solana Pay URL
```

## Status and limits

- Pilot software, MIT licensed. No real shop has used it yet.
- The Georgian text was written with machine help and needs a native speaker's review. Fixes are welcome.
- Supports USDC only. SOL and other tokens are planned.
- History lives in one browser. Export CSV regularly.

Built with Claude as the coding agent.

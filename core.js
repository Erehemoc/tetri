// Tetri core: pure functions shared by the page and the tests. No network, no DOM.
(function (root) {
  "use strict";

  const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  function base58Encode(bytes) {
    let digits = [0];
    for (const byte of bytes) {
      let carry = byte;
      for (let i = 0; i < digits.length; i++) {
        carry += digits[i] << 8;
        digits[i] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    let out = "";
    for (const byte of bytes) { if (byte === 0) out += "1"; else break; }
    for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
    return out;
  }

  function base58Decode(str) {
    const bytes = [0];
    for (const ch of str) {
      const v = B58.indexOf(ch);
      if (v < 0) throw new Error("invalid base58 character");
      let carry = v;
      for (let i = 0; i < bytes.length; i++) {
        carry += bytes[i] * 58;
        bytes[i] = carry & 0xff;
        carry >>= 8;
      }
      while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    for (const ch of str) { if (ch === "1") bytes.push(0); else break; }
    return Uint8Array.from(bytes.reverse());
  }

  // A Solana address is any base58 string that decodes to exactly 32 bytes.
  function isAddress(s) {
    if (typeof s !== "string" || s.length < 32 || s.length > 44) return false;
    try { return base58Decode(s).length === 32; } catch (e) { return false; }
  }

  function newReference(randomBytes) {
    return base58Encode(randomBytes(32));
  }

  // GEL amount -> USDC amount, rounded UP to the cent so the merchant never receives less.
  function gelToUsdc(gel, usdcPriceInGel) {
    if (!(gel > 0) || !(usdcPriceInGel > 0)) throw new Error("amount and rate must be positive");
    return Math.ceil((gel / usdcPriceInGel) * 100) / 100;
  }

  // Solana Pay transfer request: https://docs.solanapay.com/spec
  function buildPayUrl({ recipient, amount, reference, label, message, mint = USDC_MINT }) {
    if (!isAddress(recipient)) throw new Error("bad recipient");
    const q = new URLSearchParams();
    q.set("amount", amount.toFixed(2));
    q.set("spl-token", mint);
    q.set("reference", reference);
    if (label) q.set("label", label);
    if (message) q.set("message", message);
    return `solana:${recipient}?${q.toString().replace(/\+/g, "%20")}`;
  }

  // Did this confirmed transaction pay `recipient` at least `expected` of `mint`?
  // Works on getTransaction(..., {encoding: "jsonParsed"}) results. Uses balance deltas,
  // so it is correct whether the wallet used transfer or transferChecked, and even if
  // the recipient's token account was created in the same transaction.
  function verifyPayment(tx, recipient, expected, mint = USDC_MINT) {
    if (!tx || !tx.meta) return { paid: false, reason: "no transaction" };
    if (tx.meta.err) return { paid: false, reason: "transaction failed" };
    const sum = (list) => (list || [])
      .filter((b) => b.owner === recipient && b.mint === mint)
      .reduce((s, b) => s + Number(b.uiTokenAmount.amount) / 10 ** b.uiTokenAmount.decimals, 0);
    const received = Math.round((sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances)) * 1e6) / 1e6;
    if (received + 1e-9 >= expected) return { paid: true, received };
    return { paid: false, received, reason: received > 0 ? "underpaid" : "nothing received" };
  }

  function receiptsToCsv(rows) {
    const esc = (v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const head = ["time", "gel", "usdc", "rate_usdc_in_gel", "signature", "note"];
    return [head.join(",")].concat(rows.map((r) => head.map((k) => esc(r[k] ?? "")).join(","))).join("\n") + "\n";
  }

  const api = { USDC_MINT, base58Encode, base58Decode, isAddress, newReference, gelToUsdc, buildPayUrl, verifyPayment, receiptsToCsv };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Tetri = api;
})(typeof self !== "undefined" ? self : this);

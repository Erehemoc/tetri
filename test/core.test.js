// node --test test/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const T = require("../core.js");

test("base58 round trip and address check", () => {
  const usdc = T.USDC_MINT;
  assert.strictEqual(T.base58Encode(T.base58Decode(usdc)), usdc);
  assert.ok(T.isAddress(usdc));
  assert.ok(!T.isAddress("not-an-address"));
  assert.ok(!T.isAddress("1111"));
});

test("reference is a valid 32-byte address", () => {
  const ref = T.newReference((n) => require("node:crypto").randomBytes(n));
  assert.ok(T.isAddress(ref));
});

test("GEL to USDC rounds up to the cent", () => {
  assert.strictEqual(T.gelToUsdc(10, 2.59), 3.87); // 3.861 -> 3.87
  assert.strictEqual(T.gelToUsdc(25.9, 2.59), 10);
  assert.throws(() => T.gelToUsdc(0, 2.59));
});

test("Solana Pay URL follows the spec", () => {
  const url = T.buildPayUrl({
    recipient: "4swqbcj9YQs9xTMqWMDunuxcBCfaUAHwx4E87iTuSRqL", amount: 3.87,
    reference: T.USDC_MINT, label: "Café Vake", message: "Order 12",
  });
  assert.ok(url.startsWith("solana:4swqbcj9YQs9xTMqWMDunuxcBCfaUAHwx4E87iTuSRqL?amount=3.87&spl-token=EPjF"));
  assert.ok(url.includes("label=Caf%C3%A9%20Vake"));
  assert.ok(!url.includes("+"));
});

test("verifyPayment on a real mainnet USDC transfer", () => {
  const { tx } = JSON.parse(fs.readFileSync(path.join(__dirname, "fixture_tx.json")));
  const winner = "4swqbcj9YQs9xTMqWMDunuxcBCfaUAHwx4E87iTuSRqL"; // received 1.064286 USDC
  assert.deepStrictEqual(T.verifyPayment(tx, winner, 1.06).paid, true);
  assert.strictEqual(T.verifyPayment(tx, winner, 2).reason, "underpaid");
  const sender = "8ekCy2jHHUbW2yeNGFWYJT9Hm9FW7SvZcZK66dSZCDiF"; // sent USDC
  assert.strictEqual(T.verifyPayment(tx, sender, 0.01).paid, false);
  const failed = { meta: { ...tx.meta, err: { InstructionError: [0, "Custom"] } } };
  assert.strictEqual(T.verifyPayment(failed, winner, 1).reason, "transaction failed");
});

test("CSV export escapes fields", () => {
  const csv = T.receiptsToCsv([{ time: "2026-10-23T10:00:00Z", gel: 10, usdc: 3.87, rate_usdc_in_gel: 2.59, signature: "abc", note: 'Table 4, "VIP"' }]);
  assert.ok(csv.includes('"Table 4, ""VIP"""'));
});

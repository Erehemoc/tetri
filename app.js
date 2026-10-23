// Tetri page logic. All state lives in this browser (localStorage) and in the URL hash.
(function () {
  "use strict";
  const T = self.Tetri, I18N = self.TETRI_I18N;
  const $ = (id) => document.getElementById(id);
  // Public endpoints that accept requests from web pages. api.mainnet-beta.solana.com answers
  // "403 Access forbidden" to browser origins for getSignaturesForAddress, so it is only a fallback.
  const DEFAULT_RPCS = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"];
  const RATE_URL = "https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=gel";

  const store = {
    get(k, d) { try { const v = localStorage.getItem("tetri." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("tetri." + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  // Settings come from the URL hash first (so a bookmarked till link works anywhere), then storage.
  const hash = new URLSearchParams(location.hash.slice(1));
  const cfg = {
    shop: hash.get("shop") || store.get("shop", ""),
    wallet: hash.get("to") || store.get("wallet", ""),
    rpc: hash.get("rpc") || store.get("rpc", ""),
  };
  let lang = hash.get("lang") || store.get("lang", (navigator.language || "ka").slice(0, 2));
  if (!I18N[lang]) lang = "ka";
  let rate = null, rateAt = null, current = null, poll = null;
  const tr = (k, ...a) => { const v = I18N[lang][k] ?? I18N.en[k]; return typeof v === "function" ? v(...a) : v; };

  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = tr(el.dataset.i18n); });
    document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    renderRate(); renderHistory();
  }

  function show(which) {
    $("setup").classList.toggle("hidden", which !== "setup");
    $("charge").classList.toggle("hidden", which !== "charge");
    $("pay").classList.toggle("hidden", which !== "pay");
  }

  function saveHash() {
    const h = new URLSearchParams({ to: cfg.wallet, shop: cfg.shop, lang });
    if (cfg.rpc) h.set("rpc", cfg.rpc);
    history.replaceState(null, "", "#" + h.toString());
  }

  // ---------- setup ----------
  $("saveSetup").onclick = () => {
    const w = $("wallet").value.trim();
    if (!T.isAddress(w)) { $("setupErr").textContent = tr("badWallet"); return; }
    cfg.wallet = w; cfg.shop = $("shop").value.trim(); cfg.rpc = $("rpc").value.trim();
    store.set("wallet", cfg.wallet); store.set("shop", cfg.shop); store.set("rpc", cfg.rpc);
    $("setupErr").textContent = ""; saveHash(); startCharge();
  };
  $("editSetup").onclick = () => {
    $("shop").value = cfg.shop; $("wallet").value = cfg.wallet; $("rpc").value = cfg.rpc; show("setup");
  };

  // ---------- rate ----------
  async function loadRate() {
    try {
      const r = await fetch(RATE_URL, { cache: "no-store" });
      const j = await r.json();
      const v = j["usd-coin"] && j["usd-coin"].gel;
      if (!(v > 0)) throw new Error("no rate");
      rate = v; rateAt = new Date();
    } catch (e) { rate = null; }
    renderRate();
  }
  function renderRate() {
    if (!$("rateLine")) return;
    $("rateLine").textContent = rate ? tr("rate", rate.toFixed(3), rateAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) : "";
  }

  function startCharge() {
    $("shopTitle").textContent = cfg.shop || "₾ Tetri";
    $("gel").value = ""; $("note").value = ""; $("chargeErr").textContent = "";
    show("charge"); loadRate(); $("gel").focus();
  }

  // ---------- payment ----------
  $("makeQr").onclick = async () => {
    const gel = parseFloat(($("gel").value || "").replace(",", "."));
    if (!(gel > 0)) { $("chargeErr").textContent = tr("badAmount"); return; }
    if (!rate || Date.now() - rateAt > 5 * 60 * 1000) await loadRate();
    if (!rate) { $("chargeErr").textContent = tr("rateFail"); return; }
    const usdc = T.gelToUsdc(gel, rate);
    const reference = T.newReference((n) => crypto.getRandomValues(new Uint8Array(n)));
    const url = T.buildPayUrl({ recipient: cfg.wallet, amount: usdc, reference, label: cfg.shop || "Tetri", message: $("note").value.trim() || undefined });
    current = { gel, usdc, rate, reference, url, note: $("note").value.trim(), started: Date.now() };
    $("payUsdc").textContent = `${usdc.toFixed(2)} USDC`;
    $("payGel").textContent = `${gel.toFixed(2)} ₾`;
    const qr = qrcode(0, "M"); qr.addData(url); qr.make();
    $("qr").innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    setStatus("wait", tr("waiting"));
    show("pay"); startPolling();
  };

  function setStatus(kind, text) { const s = $("payStatus"); s.className = "status " + kind; s.textContent = text; }

  async function rpc(method, params) {
    let last;
    for (const url of cfg.rpc ? [cfg.rpc] : DEFAULT_RPCS) {
      try {
        const r = await fetch(url, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        const j = await r.json();
        if (j.error) throw new Error(j.error.message);
        return j.result;
      } catch (e) { last = e; }
    }
    throw last;
  }

  function startPolling() {
    stopPolling();
    const sale = current;
    let delay = 2500;
    const tick = async () => {
      if (current !== sale) return;
      try {
        const sigs = await rpc("getSignaturesForAddress", [sale.reference, { limit: 5, commitment: "confirmed" }]);
        for (const s of sigs || []) {
          if (s.err) continue;
          const tx = await rpc("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
          const v = T.verifyPayment(tx, cfg.wallet, sale.usdc);
          if (v.paid) { onPaid(sale, s.signature, v.received); return; }
          if (v.reason === "underpaid") setStatus("bad", tr("under", v.received.toFixed(2), sale.usdc.toFixed(2)));
        }
        delay = 2500;
      } catch (e) {
        setStatus("wait", tr("rpcErr"));
        delay = Math.min(delay * 2, 20000); // back off when the public RPC rate-limits us
      }
      poll = setTimeout(tick, delay);
    };
    poll = setTimeout(tick, delay);
  }
  function stopPolling() { if (poll) clearTimeout(poll); poll = null; }

  function onPaid(sale, signature, received) {
    stopPolling();
    setStatus("ok", tr("paid", received.toFixed(2)));
    const rows = store.get("sales", []);
    rows.unshift({ time: new Date().toISOString(), gel: sale.gel, usdc: received, rate_usdc_in_gel: sale.rate, signature, note: sale.note });
    store.set("sales", rows.slice(0, 500));
    renderHistory();
    if (navigator.vibrate) navigator.vibrate(150);
  }

  $("cancelPay").onclick = () => { stopPolling(); current = null; startCharge(); };
  $("copyLink").onclick = async () => {
    try { await navigator.clipboard.writeText(current.url); $("copyLink").textContent = tr("copied"); setTimeout(applyLang, 1200); } catch (e) { /* ignore */ }
  };

  // ---------- history ----------
  function renderHistory() {
    const rows = store.get("sales", []);
    $("emptyHist").classList.toggle("hidden", rows.length > 0);
    $("rows").innerHTML = "";
    for (const r of rows.slice(0, 50)) {
      const tr_ = document.createElement("tr");
      const t = new Date(r.time);
      tr_.innerHTML = `<td></td><td class="num"></td><td class="num"></td><td><a target="_blank" rel="noopener"></a></td>`;
      tr_.children[0].textContent = t.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      tr_.children[1].textContent = Number(r.gel).toFixed(2);
      tr_.children[2].textContent = Number(r.usdc).toFixed(2);
      const a = tr_.querySelector("a"); a.href = "https://solscan.io/tx/" + r.signature; a.textContent = r.signature.slice(0, 8) + "…";
      $("rows").appendChild(tr_);
    }
  }
  $("exportCsv").onclick = () => {
    const blob = new Blob([T.receiptsToCsv(store.get("sales", []))], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "tetri-sales.csv"; a.click();
  };

  // ---------- language ----------
  document.querySelectorAll("[data-lang]").forEach((b) => b.onclick = () => { lang = b.dataset.lang; store.set("lang", lang); if (cfg.wallet) saveHash(); applyLang(); });

  applyLang();
  if (T.isAddress(cfg.wallet)) startCharge(); else show("setup");
})();

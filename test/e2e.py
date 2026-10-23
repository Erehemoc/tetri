"""Browser test: set up a till, charge 25.90 GEL, decode the QR, check the Solana Pay URL.

    python3 -m http.server 8765 &   (from the repo root)
    python3 test/e2e.py
"""
import sys
import urllib.parse

import cv2
import numpy as np
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765/"
WALLET = "4swqbcj9YQs9xTMqWMDunuxcBCfaUAHwx4E87iTuSRqL"
RATE = 2.59

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 390, "height": 844}, locale="en-US")
    # Fixed rate so the test is deterministic; no real network needed for the price.
    page.route("**/api.coingecko.com/**", lambda r: r.fulfill(json={"usd-coin": {"gel": RATE}}))
    page.goto(BASE)
    page.click("[data-lang=en]")
    page.fill("#wallet", "not an address")
    page.click("#saveSetup")
    assert "doesn't look like" in page.inner_text("#setupErr")
    page.fill("#shop", "Café Vake")
    page.fill("#wallet", WALLET)
    page.click("#saveSetup")
    assert page.is_visible("#charge")
    assert "to=" + WALLET in page.url
    page.fill("#gel", "25,90")
    page.fill("#note", "Table 4")
    page.click("#makeQr")
    page.wait_for_selector("#qr svg")
    assert page.inner_text("#payUsdc") == "10.00 USDC", page.inner_text("#payUsdc")
    page.screenshot(path="test/screenshot_pay.png", full_page=True)
    png = page.locator("#qr svg").screenshot()
    img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)
    data, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
    assert data.startswith("solana:" + WALLET + "?"), data
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(data).query)
    assert q["amount"] == ["10.00"], q
    assert q["spl-token"] == ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"]
    assert q["label"] == ["Café Vake"] and q["message"] == ["Table 4"]
    assert 32 <= len(q["reference"][0]) <= 44
    # Reload from the bookmarked link: the till must come back without setup.
    page2 = b.new_page()
    page2.route("**/api.coingecko.com/**", lambda r: r.fulfill(json={"usd-coin": {"gel": RATE}}))
    page2.goto(page.url)
    assert page2.is_visible("#charge")
    page2.click("[data-lang=ka]")
    assert "ლარში" in page2.inner_text("#charge")
    page2.screenshot(path="test/screenshot_ka.png", full_page=True)
    print("e2e OK:", data[:90], "…")
    b.close()

"""Phase 1 browser test (radiation). Opens web/index.html over file://, without a server.

Requirements (outside requirements.txt, only for this test):
    pip install playwright        # uses the installed Edge/Chrome: it does not download browsers
Usage:
    python tests/web_fase1.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

INDEX = (Path(__file__).resolve().parent.parent / "web" / "index.html").as_uri()
ERRORS: list[str] = []
CHECKS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    CHECKS.append((name, bool(ok), detail))
    print(("OK   " if ok else "FAIL "), name, detail)


def visible(pg, sel: str) -> bool:
    return pg.evaluate("s => { const e = document.querySelector(s); return !!e && !e.hidden && e.offsetParent !== null }", sel)


def drain(pg, stop_on_radiation=True) -> str | None:
    """Handles the non-radiation notices so the simulation continues. Returns 'rad' if the alert appears."""
    modal_text = pg.evaluate("() => { const m = document.getElementById('modal'); return m && !m.hidden ? m.innerText : '' }")
    if modal_text:
        if "radiation" in modal_text.lower() and "Critical" in modal_text:
            return "rad" if stop_on_radiation else None
        for sel in ("[data-ignore]", "[data-s]"):  # storm: keep course · slope: proceed with caution
            if pg.query_selector("#modal " + sel):
                pg.click("#modal " + sel)
                return None
        return None
    if visible(pg, "#stageCard"):
        pg.evaluate("() => { const b = document.querySelector('#stageCard .btn.primary'); b && b.click() }")
    return None


def run_until(pg, cond_js: str, timeout_ms=60000) -> bool:
    waited = 0
    while waited < timeout_ms:
        if pg.evaluate(cond_js):
            return True
        drain(pg)
        pg.wait_for_timeout(150)
        waited += 150
    return False


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # the Windows console uses cp1252 by default
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        ctx.add_init_script("localStorage.setItem('mr_tourDone', 'true'); localStorage.removeItem('mr_radThr');")
        pg = ctx.new_page()
        pg.on("console", lambda m: ERRORS.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: ERRORS.append("PAGEERROR " + str(e)))
        pg.goto(INDEX)
        pg.wait_for_selector("#modal:not([hidden]) [data-a]", timeout=8000)

        # --- Radiation layer in the selector
        pg.evaluate("() => document.querySelector('.layer-opt[data-key=radiation]').click()")
        check("Radiation layer selectable", pg.evaluate("() => document.querySelector('.layer-opt[data-key=radiation]').getAttribute('aria-checked') === 'true'"))
        check("radiation legend with simplified-model notice", "SIMPLIFIED" in pg.inner_text("#legend"))
        rng = pg.evaluate("() => MR.radiation.range")
        check("radiation index in a reasonable range", 0.7 < rng[0] < 1.0 < rng[1] < 1.5, str(rng))

        # --- mission: accept, choose EVA on foot, accept route
        pg.click("#modal [data-a]")
        pg.wait_for_selector("#dockPlan [data-acc]", timeout=5000)
        pg.evaluate("() => document.querySelector('[data-mobility=astronaut]').click()")
        pg.click("#dockPlan [data-acc]")
        check("traverse started", pg.evaluate("() => MR.state().mode") == "walk")
        pg.evaluate("() => document.querySelector('.speed [data-speed=\"50\"]').click()")
        pg.evaluate("() => { MR.cfg.radThr = 1; }")  # low threshold so the test is short

        # --- conditions bar: 5 readings, with "?" and radiation among them
        pg.evaluate("() => document.getElementById('btnPlay').click()")
        pg.wait_for_timeout(600)
        tiles = pg.evaluate("() => [...document.querySelectorAll('#live .tile')].map(t => ({k: t.querySelector('.k span').innerText, info: !!t.querySelector('.info')}))")
        check("at most 5 live readings", len(tiles) == 5, str([t['k'] for t in tiles]))
        check("each reading has its ?", all(t["info"] for t in tiles))
        check("radiation indicator present", any(t["k"] == "Radiation" for t in tiles))

        # --- walk a stretch, then solar event from Conditions → Radiation
        check("walks before the event", run_until(pg, "() => MR.state().km > 2.0"))
        pg.evaluate("() => { if (MR.state().playing) document.getElementById('btnPlay').click(); }")
        pg.evaluate("() => document.getElementById('btnConditions').click()")
        pg.click(".dash-tab-btn[data-tab=rad]")
        check("Radiation tab with simplified-model label", "SIMPLIFIED MODEL" in pg.inner_text("#dashBody"))
        check("assumptions are labeled", pg.inner_text("#dashBody").count("ASSUMPTION") >= 4)
        pg.click("#btnSpeOn")
        pg.wait_for_timeout(300)
        check("solar event notice", pg.evaluate("() => MR.radiation.speActive(MR.state().rad.spe, MR.state().simMin)"))
        pg.evaluate("() => document.getElementById('btnPlay').click()")

        # --- critical alert (1st): Pause
        check("critical radiation alert", run_until(pg, "() => { const m = document.getElementById('modal'); return !m.hidden && m.innerText.includes('Critical radiation alert') }", 60000))
        text = pg.inner_text("#modal")
        check("alert offers pause, abort and return to shelter", all(w in text for w in ("Pause", "Abort", "Return to shelter")))
        check("the simulation stays paused", pg.evaluate("() => MR.state().playing") is False)
        dose1 = pg.evaluate("() => MR.state().rad.bySol[1] || MR.state().rad.total")
        pg.click("#modal [data-p]")
        check("Pause closes the alert and keeps the pause", pg.evaluate("() => document.getElementById('modal').hidden && !MR.state().playing"))
        pg.evaluate("() => document.getElementById('btnPlay').click()")

        # --- 2nd alert (2 × threshold): Return to shelter
        check("second alert when the threshold is doubled", run_until(pg, "() => { const m = document.getElementById('modal'); return !m.hidden && m.innerText.includes('Critical radiation alert') }", 60000))
        dose2 = pg.evaluate("() => MR.state().rad.total")
        check("the dose keeps accumulating", dose2 > dose1, f"{dose1:.2f} → {dose2:.2f} mSv")
        pg.click("#modal [data-b]")
        check("return to shelter started", pg.evaluate("() => !!MR.state().returning"), pg.evaluate("() => (MR.state().returning || {}).name || ''"))
        check("reaches the shelter and opens the summary", run_until(pg, "() => !document.getElementById('summary').hidden", 120000))
        summ = pg.inner_text("#summary")
        check("summary shows the EVA dose", "EVA dose" in summ and "Return to shelter" in summ)

        # --- 2D → 3D without errors
        pg.evaluate("() => document.querySelector('#summary [data-back]').click()")
        pg.evaluate("() => document.querySelector('[data-view=\"3d\"]').click()")
        pg.wait_for_timeout(1500)
        pg.evaluate("() => document.querySelector('[data-view=\"2d\"]').click()")
        pg.wait_for_timeout(300)

        ignorable = ("GPU stall", "GL Driver Message")
        errs = [e for e in ERRORS if not any(i in e for i in ignorable)]
        check("no console errors", not errs, "; ".join(errs)[:400])
        browser.close()

    failed = [c for c in CHECKS if not c[1]]
    print(f"\n{len(CHECKS) - len(failed)}/{len(CHECKS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

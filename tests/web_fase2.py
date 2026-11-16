"""Phase 2 browser test (model confidence and limitations). Opens web/index.html over file://.

Requirements: pip install playwright (uses the installed Edge/Chrome).  Usage: python tests/web_fase2.py [screenshot.png]
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


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    shot = sys.argv[1] if len(sys.argv) > 1 else None
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        ctx.add_init_script("localStorage.setItem('mr_tourDone', 'true')")
        pg = ctx.new_page()
        pg.on("console", lambda m: ERRORS.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: ERRORS.append("PAGEERROR " + str(e)))
        pg.goto(INDEX + "?modal=none")
        pg.wait_for_timeout(1200)

        info = pg.evaluate("() => { const f = MR.F.confidence; if (!f) return null; let lo = 9, hi = -9; for (const v of f) { if (v < lo) lo = v; if (v > hi) hi = v; } return { n: f.length, lo, hi }; }")
        check("confidence layer loaded as a script (file://)", info and info["n"] == 300 * 300, str(info))
        check("confidence values between 0 and 1", info and -0.01 <= info["lo"] and info["hi"] <= 1.01)

        pg.evaluate("() => document.querySelector('.layer-opt[data-key=confidence]').click()")
        check("Confidence layer selectable", pg.evaluate("() => document.querySelector('.layer-opt[data-key=confidence]').getAttribute('aria-checked') === 'true'"))
        check("Low/High legend", "Low" in pg.inner_text("#legend") and "High" in pg.inner_text("#legend"))

        # model panel: confidence + limitations
        pg.evaluate("() => { document.getElementById('btnConditions').click(); }")
        pg.click(".dash-tab-btn[data-tab=mod]")
        pg.wait_for_timeout(300)
        txt = pg.inner_text("#dashBody")
        check("«Limitations and assumptions» section", "Limitations and assumptions" in txt)
        check("each limitation states its origin (source/data/assumption)", all(w in txt for w in ("ASSUMPTION", "SOURCE · Bennett 2023", "REPO DATA")))
        check("mentions the rover versus the astronaut", "The rover does not walk like an astronaut" in txt)
        check("confidence card with a warning", "Model confidence" in txt and "does not mean they are right" in txt)
        if shot:
            pg.screenshot(path=shot)

        # route table with the mean confidence
        pg.click(".dash-tab-btn[data-tab=ter]")
        pg.wait_for_timeout(200)
        check("route comparison includes mean confidence", "Model confidence (mean)" in pg.inner_text("#dashBody"))

        # "View on the map" button activates the layer
        pg.click(".dash-tab-btn[data-tab=mod]")
        pg.evaluate("() => { document.querySelector('.layer-opt[data-key=none]').click(); }")
        pg.click("#btnConfLayer")
        pg.wait_for_timeout(300)
        check("«View on the map» activates the layer", pg.evaluate("() => document.querySelector('.layer-opt[data-key=confidence]').getAttribute('aria-checked') === 'true'"))

        # Jezero: the layer does not exist there → marked «Gale only»
        pg.evaluate("() => { const s = document.getElementById('regionSelect'); s.value = 'jezero'; s.dispatchEvent(new Event('change', { bubbles: true })); }")
        pg.wait_for_timeout(500)
        na = pg.evaluate("() => document.querySelector('.layer-opt[data-key=confidence]').classList.contains('layer-na')")
        check("in Jezero the layer is listed as Gale only", na)

        errs = [e for e in ERRORS if not any(i in e for i in ("GPU stall", "GL Driver"))]
        check("no console errors", not errs, "; ".join(errs)[:400])
        browser.close()

    failed = [c for c in CHECKS if not c[1]]
    print(f"\n{len(CHECKS) - len(failed)}/{len(CHECKS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

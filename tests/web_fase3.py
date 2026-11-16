"""Phase 3 browser test (configurable EVA workday and sols). Opens web/index.html over file://.

Requirements: pip install playwright (uses the installed Edge/Chrome).  Usage: python tests/web_fase3.py [screenshot.png]
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
        ctx.add_init_script("localStorage.setItem('mr_tourDone', 'true'); localStorage.removeItem('mr_eva');")
        pg = ctx.new_page()
        pg.on("console", lambda m: ERRORS.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: ERRORS.append("PAGEERROR " + str(e)))
        pg.goto(INDEX)
        pg.wait_for_selector("#modal:not([hidden]) [data-a]", timeout=8000)

        # --- the briefing says how many sols and why not 3
        txt = pg.inner_text("#modal")
        check("default mobility: on foot", pg.evaluate("() => MR.state().mobility") == "astronaut")
        check("briefing shows the estimated sols", "sols" in txt and "ASSUMPTION" in txt, txt.split("\n")[0][:80])
        ev = pg.evaluate("() => MR.eva.plan(MR.state().baseRoute)")
        check("4 to 5 sols on foot with the default values", 4 <= ev["solsCeil"] <= 5 and 38 < ev["hours"] < 46, f"{ev['hours']:.1f} h → {ev['sols']:.2f} sols")
        pg.evaluate("() => document.querySelector('.sol-box summary').click()")
        det = pg.inner_text("#modal .sol-box")
        check("explains the difference from 3 sols", "Why not 3 sols?" in det and "to do it in 3 sols" in det.lower() and "Nelson" in det)

        # --- the estimate uses the same speed as the simulation (no rover by mistake)
        rover = pg.evaluate("() => MR.estimateHours(MR.state().baseRoute, 'rover')")
        check("on foot takes much longer than by rover", ev["hours"] > 4 * rover, f"{ev['hours']:.0f} h vs {rover:.0f} h")

        # --- configurable parameters: breaks and reserve lengthen the traverse; duration shortens it in sols
        base = pg.evaluate("() => MR.eva.plan(MR.state().baseRoute)")
        pg.evaluate("() => { MR.eva.cfg.pauseMinPerH = 15; }")
        pausa = pg.evaluate("() => MR.eva.plan(MR.state().baseRoute)")
        check("15 min of break per hour lengthen the traverse by 33 %", abs(pausa["hours"] / base["hours"] - 60 / 45) < 0.01, f"{base['hours']:.1f} → {pausa['hours']:.1f} h")
        pg.evaluate("() => { MR.eva.cfg.pauseMinPerH = 0; MR.eva.cfg.reserveMin = 60; }")
        res = pg.evaluate("() => MR.eva.plan(MR.state().baseRoute)")
        check("the reserve reduces the walking hours per sol", abs(res["windowH"] - 8) < 1e-9 and res["sols"] > base["sols"], f"{base['windowH']} → {res['windowH']} h/sol")
        pg.evaluate("() => { MR.eva.cfg.reserveMin = 0; MR.eva.cfg.durationH = 12; }")
        largo = pg.evaluate("() => MR.eva.plan(MR.state().baseRoute)")
        check("a 12 h workday lowers the sols", largo["solsCeil"] < base["solsCeil"], f"{base['solsCeil']} → {largo['solsCeil']} sols")
        pg.evaluate("() => { MR.eva.cfg.durationH = 9; }")

        # --- controls in Route → EVA workday, with persistence
        pg.click("#modal [data-n]")  # «Not now»
        pg.evaluate("() => document.querySelector('[data-lptab=route]').click()")
        check("EVA workday panel labeled as an assumption", "EVA workday" in pg.inner_text("[data-lpsec=route]") and "ASSUMPTION" in pg.inner_text("[data-lpsec=route]"))
        pg.evaluate("() => { const e = document.getElementById('evaPause'); e.value = 10; e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); }")
        check("the breaks control updates the summary", "sols" in pg.inner_text("#evaSummary") and pg.evaluate("() => MR.eva.cfg.pauseMinPerH") == 10, pg.inner_text("#evaSummary"))
        check("the configuration is saved", pg.evaluate("() => JSON.parse(localStorage.getItem('mr_eva')).pauseMinPerH") == 10)
        if shot:
            pg.screenshot(path=shot)

        # --- simulation: matches the estimate and respects the reserve
        pg.evaluate("() => { MR.eva.cfg.pauseMinPerH = 0; MR.eva.cfg.reserveMin = 120; }")  # stops walking at 15:00
        pg.evaluate("() => document.getElementById('btnEvaReset').click()")
        check("restore returns to the default values", pg.evaluate("() => JSON.stringify(MR.eva.cfg) === JSON.stringify(MR.eva.DEFAULTS)"))
        pg.evaluate("() => { MR.eva.cfg.reserveMin = 120; }")
        pg.evaluate("() => { const t = MR.state(); }")
        check("the end of the walk subtracts the reserve", pg.evaluate("() => MR.eva.walkEndHour()") == 15)
        pg.evaluate("() => { MR.eva.cfg.reserveMin = 0; }")

        # --- recorrido completo a pie con jornada configurada (guardada y recargada): 08:00–15:00 con pausas de 10 min/h
        ctx2 = browser.new_context(viewport={"width": 1440, "height": 900})
        ctx2.add_init_script("localStorage.setItem('mr_tourDone', 'true'); localStorage.setItem('mr_eva', JSON.stringify({startHour: 8, durationH: 8, pauseMinPerH: 10, reserveMin: 60}));")
        pg2 = ctx2.new_page()
        pg2.on("console", lambda m: ERRORS.append(m.text) if m.type == "error" else None)
        pg2.on("pageerror", lambda e: ERRORS.append("PAGEERROR " + str(e)))
        pg2.goto(INDEX)
        pg2.wait_for_selector("#modal:not([hidden]) [data-a]", timeout=8000)
        check("the saved configuration is reloaded", pg2.evaluate("() => MR.eva.cfg.durationH") == 8 and pg2.evaluate("() => MR.eva.walkEndHour()") == 15)
        pg2.evaluate("() => { MR.cfg.radThr = 1e6; }")  # no radiation alerts
        pg2.click("#modal [data-a]")
        pg2.wait_for_selector("#dockPlan [data-acc]", timeout=5000)
        est = pg2.evaluate("() => MR.eva.plan(MR.state().baseRoute)")
        pg2.click("#dockPlan [data-acc]")
        pg2.evaluate("() => document.querySelector('.speed [data-speed=\"50\"]').click()")
        pg2.evaluate("() => document.getElementById('btnPlay').click()")
        outside, waited = [], 0
        while waited < 150000 and pg2.evaluate("() => MR.state().mode") == "walk":
            st = pg2.evaluate("() => ({ h: MR.state().simMin / 60 % 24, playing: MR.state().playing })")
            if st["playing"] and not (8 - 1e-6 <= st["h"] <= 15 + 0.05):
                outside.append(round(st["h"], 2))
            mt = pg2.evaluate("() => { const m = document.getElementById('modal'); return m && !m.hidden ? m.innerText : '' }")
            if mt:
                for sel in ("[data-ignore]", "[data-s]", "[data-p]"):
                    if pg2.query_selector("#modal " + sel):
                        pg2.click("#modal " + sel)
                        break
            elif pg2.evaluate("() => !document.getElementById('stageCard').hidden"):
                pg2.evaluate("() => document.querySelector('#stageCard .btn.primary').click()")  # continue / rest until morning
            elif not st["playing"]:
                pg2.evaluate("() => document.getElementById('btnPlay').click()")
            pg2.wait_for_timeout(120)
            waited += 120
        done = pg2.evaluate("() => ({ mode: MR.state().mode, simMin: MR.state().simMin, sols: Math.floor(MR.state().simMin / 1440) + 1 })")
        check("the traverse finishes", done["mode"] == "done", str(done))
        check("never walks outside the workday (08:00–15:00)", not outside, str(outside[:5]))
        check("the simulated sols match the estimated ones", done["sols"] == est["solsCeil"], f"simulated {done['sols']}, estimated {est['solsCeil']} ({est['hours']:.1f} h at {est['windowH']:.0f} h per sol)")

        errs = [e for e in ERRORS if not any(i in e for i in ("GPU stall", "GL Driver"))]
        check("no console errors", not errs, "; ".join(errs)[:400])
        browser.close()

    failed = [c for c in CHECKS if not c[1]]
    print(f"\n{len(CHECKS) - len(failed)}/{len(CHECKS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

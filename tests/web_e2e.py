"""End-to-end test (Phase 5). A complete traverse, as a person would do it, opening web/index.html over file://:

  1. open without a server, with no console errors;
  2. switch 2D Map ↔ 3D Relief (before and during the traverse);
  3. accept EV1's mission and route and walk to the summit;
  4. handle a critical slope alert (detour if there is a short one, otherwise proceed with caution);
  5. log a finding and check that EV2 and EV3 receive it without losing their separate trip;
  6. reach the summit: the summary shows EVA dose, finding and alerts.

Requirements: pip install playwright (uses the installed Edge/Chrome).  Usage: python tests/web_e2e.py [screenshots_folder]
"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

INDEX = (Path(__file__).resolve().parent.parent / "web" / "index.html").as_uri()
ERRORS: list[str] = []
CHECKS: list[tuple[str, bool, str]] = []
IGNORE = ("GPU stall", "GL Driver")


def check(name: str, ok: bool, detail: str = "") -> None:
    CHECKS.append((name, bool(ok), detail))
    print(("OK   " if ok else "FAIL "), name, detail)


def modal_text(pg) -> str:
    return pg.evaluate("() => { const m = document.getElementById('modal'); return m && !m.hidden ? m.innerText : '' }")


def set_view(pg, view: str) -> None:
    pg.evaluate("v => document.querySelector('[role=radio][data-view=\"' + v + '\"]').click()", view)
    pg.wait_for_timeout(1200)


def terrain_brightness(pg) -> float:
    """Mean luminance (0-255) of the central area of the screen: a 3D relief with a black texture gives very low values."""
    import base64
    png = base64.b64encode(pg.screenshot(clip={"x": 560, "y": 260, "width": 700, "height": 560})).decode()
    return pg.evaluate("""b64 => new Promise(res => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        const x = c.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let s = 0;
        for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; res(s / (d.length / 4)); }; im.src = 'data:image/png;base64,' + b64; })""", png)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    shots = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        ctx.add_init_script("localStorage.setItem('mr_tourDone', 'true'); localStorage.removeItem('mr_shared'); localStorage.removeItem('mr_eva');")
        pg = ctx.new_page()
        pg.on("console", lambda m: ERRORS.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: ERRORS.append("PAGEERROR " + str(e)))
        pg.on("response", lambda r: ERRORS.append(f"HTTP {r.status} {r.url}") if r.status >= 400 else None)

        # --- 1. open over file://
        pg.goto(INDEX)
        pg.wait_for_selector("#modal:not([hidden]) [data-a]", timeout=8000)
        check("opens over file:// (no server)", pg.url.startswith("file:"), pg.url[:40])
        check("local mode: no backend", pg.evaluate("() => MR.API.online") is False)
        check("briefing with estimated sols", "sols" in modal_text(pg))
        check("three astronauts available", pg.evaluate("() => document.querySelectorAll('.crew button').length") == 3)
        if shots:
            pg.screenshot(path=str(shots / "e2e_1_briefing.png"))

        # --- 2. 2D ↔ 3D (with the briefing open: the view buttons are triggered by script)
        check("starts on the 2D Map", pg.evaluate("() => document.querySelector('[role=radio][data-view=\"2d\"]').getAttribute('aria-checked')") == "true")
        set_view(pg, "3d")
        ok3d = pg.evaluate("() => !!(MR.Scene3D && MR.Scene3D.ready) && !!document.querySelector('canvas')")
        check("3D Relief starts (WebGL)", ok3d)
        pg.evaluate("() => document.querySelector('#modal [data-n]') && 0")
        pg.wait_for_timeout(1500)
        lum = terrain_brightness(pg)
        check("the 3D terrain has texture (it does not come out black over file://)", lum > 45, f"mean luminance {lum:.0f}/255")
        if shots and ok3d:
            pg.screenshot(path=str(shots / "e2e_2_3d.png"))
        set_view(pg, "2d")
        check("returns to the 2D Map", pg.evaluate("() => document.querySelector('[role=radio][data-view=\"2d\"]').getAttribute('aria-checked')") == "true")

        # --- 3. EV1's mission and route
        pg.click("#modal [data-a]")
        pg.wait_for_selector("#dockPlan [data-acc]", timeout=5000)
        est = pg.evaluate("() => MR.eva.plan(MR.state().baseRoute)")
        pg.click("#dockPlan [data-acc]")
        check("EV1's traverse started", pg.evaluate("() => MR.state().mode") == "walk")
        pg.evaluate("() => document.querySelector('.speed [data-speed=\"50\"]').click()")
        pg.evaluate("() => { MR.cfg.radThr = 1e6; }")  # radiation is tested separately; here the slope alert takes precedence

        # --- 4. walk; handle the critical alert; shared finding halfway; 3D during the traverse
        state = {"alert": None, "finding": False, "view3d": False}
        waited = 0
        pg.evaluate("() => document.getElementById('btnPlay').click()")
        while waited < 170000 and pg.evaluate("() => MR.state().mode") == "walk":
            mt = modal_text(pg)
            if "Steep slope" in mt:
                state["alert"] = "detour" if pg.query_selector("#modal [data-d]:not([disabled])") else "follow"
                if shots and not (shots / "e2e_3_alert.png").exists():
                    pg.screenshot(path=str(shots / "e2e_3_alert.png"))
                pg.click("#modal [data-d]" if state["alert"] == "detour" else "#modal [data-s]")
                pg.wait_for_timeout(300)
            elif mt:
                for sel in ("[data-ignore]", "[data-s]", "[data-p]"):
                    if pg.query_selector("#modal " + sel):
                        pg.click("#modal " + sel)
                        break
            elif pg.evaluate("() => !document.getElementById('stageCard').hidden"):
                pg.evaluate("() => document.querySelector('#stageCard .btn.primary').click()")
            elif not pg.evaluate("() => MR.state().playing"):
                pg.evaluate("() => document.getElementById('btnPlay').click()")
            km = pg.evaluate("() => MR.state().km")
            if not state["view3d"] and km > 8:  # switch to 3D during the traverse
                state["view3d"] = True
                set_view(pg, "3d")
                state["view3d_ok"] = pg.evaluate("() => !!(MR.Scene3D && MR.Scene3D.ready)")
                set_view(pg, "2d")
            if not state["finding"] and km > 20 and pg.evaluate("() => MR.state().playing"):
                state["finding"] = True
                pg.evaluate("() => document.getElementById('btnPlay').click()")  # pause
                pg.evaluate("() => document.getElementById('btnReport').click()")
                pg.wait_for_selector("#miniCard:not([hidden]) .typepick button", timeout=5000)
                pg.click("#miniCard .typepick button[data-k=mineral]")
                pg.fill("#miniCard textarea", "sulfate in outcrop")
                pg.click("#miniCard [data-s]")
                pg.wait_for_timeout(400)
                # EV2 and EV3 receive it and keep their trip separate
                got = {}
                for c in ("ev2", "ev3"):
                    pg.evaluate("c => document.querySelector('.crew button[data-id=' + c + ']').click()", c)
                    pg.wait_for_timeout(500)
                    pg.evaluate("() => { const b = document.querySelector('#modal:not([hidden]) [data-n]'); b && b.click(); }")
                    got[c] = pg.evaluate("() => ({ peers: MR.state().log.filter(m => m.from === 'peer' && m.text.includes('sulfate')).length, mode: MR.state().mode, km: MR.state().km, findings: MR.state().findings.length, zones: document.querySelectorAll('#vector .r-zone').length })")
                state["peers"] = got
                pg.evaluate("() => document.querySelector('.crew button[data-id=ev1]').click()")
                pg.wait_for_timeout(500)
                pg.evaluate("() => document.getElementById('btnPlay').click()")
            pg.wait_for_timeout(120)
            waited += 120

        done = pg.evaluate("() => ({ mode: MR.state().mode, km: MR.state().km, sols: Math.floor(MR.state().simMin / 1440) + 1, alerts: MR.state().alerts, detours: MR.state().detours, dose: MR.state().rad.total, findings: MR.state().findings.length })")
        check("full traverse to the summit", done["mode"] == "done", f"{done['km']:.1f} km in {done['sols']} sols")
        check("handled a critical slope alert", state["alert"] is not None and done["alerts"] >= 1, f"{state['alert']} · {done['alerts']} alerts · {done['detours']} detours")
        check("switched to 3D during the traverse", state.get("view3d_ok") is True)
        check("the finding was logged in EV1's trip", state["finding"] and done["findings"] == 1)
        peers = state.get("peers", {})
        check("EV2 and EV3 received the finding", all(v["peers"] == 1 for v in peers.values()) and len(peers) == 2, str(peers))
        check("their trips stay separate (no findings of their own, km 0, no route)", all(v["findings"] == 0 and v["km"] == 0 and v["mode"] == "base" for v in peers.values()))
        check("EV2 and EV3 saw the zone on the map", all(v["zones"] == 1 for v in peers.values()))
        check("the simulated sols match the estimate", abs(done["sols"] - est["solsCeil"]) <= 1, f"simulated {done['sols']} · estimated {est['solsCeil']}")
        check("the accumulated EVA dose is positive", done["dose"] > 0, f"{done['dose']:.2f} mSv")

        # --- 5. summary
        pg.wait_for_selector("#summary:not([hidden])", timeout=8000)
        summ = " ".join(pg.inner_text("#summary").split())
        check("the summary says «Mission completed»", "Mission completed" in summ)
        check("the summary shows the EVA dose (simplified model)", "EVA dose" in summ and "simplified" in summ.lower())
        check("the summary counts the finding and the alerts", "findings" in summ and "alerts handled" in summ)
        if shots:
            pg.screenshot(path=str(shots / "e2e_4_summary.png"))

        errs = [e for e in ERRORS if not any(i in e for i in IGNORE)]
        check("no console errors during the whole traverse", not errs, "; ".join(errs)[:500])
        browser.close()

    failed = [c for c in CHECKS if not c[1]]
    print(f"\n{len(CHECKS) - len(failed)}/{len(CHECKS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

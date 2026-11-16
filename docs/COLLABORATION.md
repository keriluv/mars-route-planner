# Collaboration between astronauts: shared notices

Phase 4. A finding or an alert recorded by one astronaut reaches the other two as a notice. **Each one continues their own separate trip**: the notice does not change their route, clock or mission; it is only reflected as a zone on the map and a message in the logbook.

## What is shared

| Origin | Notice type | Example text | Where it is generated |
|---|---|---|---|
| Logged finding | `finding` | «Mineral: green olivine» | when a finding is saved (`saveFinding`) |
| Critical slope alert | `slope_alert` | «slope of 15° over a 138 m section (km 52.2)» | when the alert opens (`criticalAlert`), once per section |
| Critical radiation alert | `radiation_alert` | «EVA dose of 5.2 mSv today (threshold 5.0 mSv)» | when the threshold is exceeded (`checkRadiation`), once per level |

Left out for now: the demonstration weather alert (it already fires for each explorer at 11:30), messages to Earth and missions.

If the author presses «Undo» after saving a finding, the notice is **withdrawn** for the others.

## What the receiver sees

- **2D map:** a marker with a dashed border in the author's color and a **zone** (dashed circle). Tapping it opens a card with the author, the coordinates, the text and how many km their own route passes away. In the 3D relief the marker appears; the zones exist only on the 2D map.
- **Logbook:** a message «EV1 · Finding: … · your route passes 13.9 km away», with «View on the map». It appears in each receiver's trip even if they have not started walking yet; if the receiver is not the active explorer, it stays as an unread message in their badge.
- **Banner** if the receiver is active at that moment (as a warning if their route passes within «radius + 1 km» of the zone).
- **Findings panel:** «Findings from other explorers» section.
- **Summary timeline:** «Notice from EV1: finding».

The author does not see their own notice as a foreign zone. The size of the zone (0.5 / 0.8 / 1.5 km depending on the type) is an **assumed** visual aid, not a measured safety distance.

## Where it is stored

| Situation | What happens |
|---|---|
| **Without a server** (double-click on `index.html`) | Notices live in `localStorage` (`mr_shared`). Two tabs of the same browser notify each other instantly through the `storage` event; a new tab loads the ones already saved, without repeating banners. |
| **With a backend** (`python backend/server.py`) | In addition: each notice goes to **SQLite** (`notice` table) and each event to **JSONL** (`backend/data/docstore/events.jsonl`). Other browsers receive them by polling `/api/notices` every 4 s. |

- **SQLite (`notice`):** the record: id, author, type, text, coordinates, radius, region, author's clock, status (`active`/`withdrawn`).
- **JSONL (`events`):** the log of what happened: `notice_published`, `notice_received` (with who received it) and `notice_withdrawn`.
- **Idempotent resend:** the same id is not duplicated and the event is not repeated. What was created offline is uploaded on reconnection.
- **Validation:** the server rejects unknown explorers, invalid types, empty text and out-of-range coordinates.

## API

| Method | Route | Use |
|---|---|---|
| GET | `/api/notices[?region=gale]` | list of notices (includes withdrawn ones, so clients remove them) |
| POST | `/api/notices` | publishes a notice |
| POST | `/api/notices/withdraw` | `{id, crew}`: only the author can withdraw it |
| POST | `/api/notices/received` | `{id, crew}`: leaves the receipt event |
| GET | `/api/events[?type=…]` | events from the JSONL store |

`MARS_DATA_DIR` allows using a different data folder (tests use it so as not to touch `backend/data`).

## Limits and pending work

- **There is no identity or permissions:** any client can publish as any explorer. It is a demonstration prototype.
- **Trips have separate clocks.** The notice is delivered as soon as it is published (real time), not when the receiver's clock reaches that hour; the text shows the author's clock on the card.
- **No Mars–Earth delay between companions** (they are in the same operations zone); messages to Earth keep their 12-minute delay.
- **The photo of the finding is not shared**, only the type and the note.
- **Synchronization by polling (4 s)**, not real time; no WebSocket.
- A notice does not modify the receiver's trip nor propose an automatic detour.

## Tests

- `python tests/web_fase4.py` (Playwright): without a server (two tabs, withdrawal, slope and radiation alerts) and with a backend (two browsers, SQLite, JSONL, idempotence, validation).
- `python -m pytest tests/test_notices.py`: notices backend with a temporary folder.

# EVA workday and walking speed

Review of how the simulation and the briefing compute how long the traverse takes on foot, which assumptions lie behind it and how to change them. Phase 3. Each point states its origin: **SOURCE**, **DATA** (measured in this repo) or **ASSUMPTION**.

## 1. What the sources say (and what they do not)

Nelson (NASA, 14 Oct 2021, *Beyond Artemis III – EVA Gap Update & Overview*) **does not contain** EVA duration, walking pace, breaks or reserves. What it does say is that more than 100 gaps affect EVA (~88 on Mars) and that many are **knowledge gaps**: unknown mission parameters that will set the requirements. That is why in this app:

- the workday, breaks and reserve are **not presented as data**, but as **configurable assumptions** (Route → EVA workday) labeled «ASSUMPTION»;
- that document cannot be used to justify 9 h, 8 h or 6 h. The only citable analogy is the lunar one (up to four walks plus a fifth as a contingency reserve in 6.5 days), and it is lunar, not Martian.

## 2. Walking speed

`v = 6 · e^(−3.5·|slope + 0.05|) km/h` (Tobler function, 1993; it is the reference cited by the project document, `docs/Ruta_segura_Mount_Sharp_APA.docx`), multiplied by:

| Factor | Value | Origin |
|---|---|---|
| Pressurized suit | × 0.55 | prototype ASSUMPTION, no source |
| Low traversability | up to × 0.65 (`1 − 0.35·(1 − p)`) | prototype ASSUMPTION |
| Steep section (above the critical threshold) | × 0.6 | prototype ASSUMPTION |
| Breaks | `(60 − minutes)/60` | configurable ASSUMPTION (default 0) |
| Minimum | 0.4 km/h | prototype ASSUMPTION |

Result: **2.77 km/h on flat ground** (matches the «about 2.8 km/h» in the project document). The peak of the Tobler formula is at a gentle downhill (slope −5 %).

Limitations of the formula:
- Tobler describes terrestrial walking; the project document already warns: «it would have to be calibrated with tests in Martian analogs».
- The slope comes from the route over the browser's 177 m cells (44 m in Python): it smooths local slopes, so the estimated speed is somewhat optimistic on steep sections.

## 3. What was corrected

Before this phase, three things were not consistent with each other:

1. **The briefing computed hours with the rover pace** (12 km/h maximum) even though it said «walking», and the default mobility was «Pressurized rover». The 72 km traverse came out at ≈ 7 h. **Now the default mobility is «on foot»**, which is the premise of the project.
2. **The estimate ignored the × 0.6 on steep sections that the simulation did apply.** Now both use the same function (`MR.speedAt`), and a test checks that the simulated sols match the estimated ones.
3. **The 08:00–17:00 workday was fixed in the code.** Now it is configurable and stored in the browser.

Suit consumption was also made consistent: O₂ and battery on foot are measured **per workday** (ASSUMPTION: the suit is recharged every night), not summed over the 44 h. With the default 9 h workday the panel flags that the suit's 8 h endurance is exceeded (prototype assumption, 72 L/h and 576 L): **the 9 h workday and the 8 h suit are incompatible with each other**, and the 20 % reserve threshold requires ≤ 6.4 h. It is shown as is instead of changing the default value without a basis.

## 4. How many sols the traverse takes

Model route to the summit (72 km, +5,333 m), on foot, with the default values (08:00–17:00, no breaks or reserve):

| Measure | Value |
|---|---|
| Walking hours | ≈ 43.5 h |
| Mean pace | ≈ 1.7 km/h |
| Sols | 4.8 → **5 sols** |
| In a pressurized rover (12 km/h max., assumption) | ≈ 7 h (1 sol) |

**Why not 3 sols.** The base flow assumed 3 sols (a figure I could not verify: the PDF «Base interaction flow» is not in the repo). With this model, doing it in 3 sols would require **workdays of ≈ 14.5 h** (more than any configurable workday) or a **mean pace of ≈ 2.7 km/h**, 61 % faster than estimated and almost equal to the maximum speed on flat ground (2.77 km/h), which is impossible to sustain on a traverse with 5.3 km of climb. What changes between «3» and «4–5» is not a calculation error: it is that 3 sols need more optimistic assumptions than those of this model.

Sensitivity (same route, on foot):

| Configuration | Hours | Sols |
|---|---|---|
| Default (9 h, no breaks or reserve) | 43.5 | 5 |
| 12 h workday | 43.5 | 4 |
| 15 min break per hour | 58.0 | 7 |
| 60 min reserve (8 h of walking per sol) | 43.5 | 6 |
| 8 h workday, 10 min/h break and 60 min reserve (7 h of walking per sol; this is the full test) | 52.2 | 8 |

## 5. Where to change it

- **Route → EVA workday:** start time, duration (4–12 h), breaks (0–30 min per walking hour) and safety reserve at the end (0–120 min: walking stops earlier so there is time to return). It is stored in the browser; «Restore default values» returns to the original behavior.
- The briefing and the route cards show the sols with those values.

## 6. Pending work and simplifications

- Breaks are averaged into the pace; there are no discrete stops.
- The simulation uses sols of exactly 24 h; a Martian sol lasts 24 h 39 min. It does not change the walking hours, only the night clock.
- There is nowhere to sleep: the model does not say whether the astronaut spends the night in a shelter, a rover or outdoors. That affects O₂, battery and radiation dose (which today is not added inside the shelter).
- No EVA figure has official backing (Nelson 2021 lists them as gaps); calibrating with analog tests or agency data is pending.

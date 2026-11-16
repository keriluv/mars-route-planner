# Limitations of the traversability model

What can and cannot be concluded from the random forest model that uses Curiosity's traverse as the label of «traversable terrain». Each point states its origin: **SOURCE** (a cited document), **DATA** (something measured in this repo) or **ASSUMPTION** (own reasoning, with no backing in the sources).

Phase 2. Sources: Bennett et al. 2023, *The Curiosity Rover's Exploration of Glen Torridon* (JGR Planets, 10.1029/2022JE007185; CC BY-NC-ND license, only paraphrased); `README.md`; `models/uncertainty_summary.json`.

## 1. What the model learned, in one sentence

It learned to distinguish «it resembles the terrain Curiosity passed through» from «it is steep or rough and far from the traverse». **It did not learn what terrain an astronaut in a suit can cross.**

## 2. Rover versus astronaut in a suit

| # | Limitation | Origin |
|---|---|---|
| 1 | **The traverse was defined by science, not by ease of passage.** The science team set waypoints according to their geological questions («identified by the science team in response to the overarching science questions»). The shape of the traverse reflects where the geological interest was, not the easiest path. | SOURCE (Bennett, §4.1) |
| 2 | **That the rover passed through a place does not make the rest traversable.** The positive examples are the cells ≤ 60 m from the traverse. The negatives are taken more than 200 m away and only if they are steep or rough. The model ranks relative risk; it does not certify that terrain is safe. | DATA (README) |
| 3 | **Some sections were imposed by the terrain, not by choice.** The entrance to Glen Torridon is a cliff «for the most part not traversable by a rover»; the only safe descent fixed the start of the section. The route to the sulfate unit had to go around the Sands of Forvie. | SOURCE (Bennett, §4.1) |
| 4 | **The rover withstood inclinations that our veto excludes.** It reached a record inclination of 32.0° climbing the Greenheugh pediment scarp. Our planner vetoes slopes > 20°. They are not directly comparable: the rover's is the vehicle's inclination at a point; ours is the mean slope of 44 m cells. The 20° veto is a design decision, not a measured limit. | SOURCE (Bennett, §4.2.4) + DATA (`config/mission.yaml`) |
| 5 | **It avoided sand, so the model knows nothing about sand.** It went around a ripple field instead of crossing it. With few examples on sand and no feature describing it, the model does not distinguish «firm rock» from «loose sand». JPL terrain-classification projects (SPOC) treat sand as the main mobility risk of a rover. | SOURCE (Bennett) + claim from the SPOC site, not verified here |
| 6 | **A wheeled rover is not a person in a suit.** Slopes, loose rocks, sand, falls and fatigue affect one and the other differently. | ASSUMPTION |
| 7 | **The rover has needs of its own.** For example, to drill it needs a flat surface of at least 10 cm; those stops weigh on the shape of the traverse and have no equivalent for an astronaut. | SOURCE (Bennett) |

Bennett says nothing about suits, human walking or EVA. Points 6 onward about astronauts are our own reasoning and must not be attributed to that source.

## 3. Coverage and scope of the data

| # | Limitation | Origin |
|---|---|---|
| 8 | **A single 19 km corridor** near the landing site; the summit is ~47 km away. 7 % of the area has some feature outside the range the model saw during training (slope 1.97 %, roughness 2.65 %, texture 1.67 %, gradient 0.09 %, thermal 3.36 %). | DATA (README, `uncertainty_summary.json`) |
| 9 | **Resolution:** 44 m cells in the model and 177 m in the browser. Loose rocks and dunes are not seen. | DATA |
| 10 | **It does not see** dust, visibility, suit energy or fatigue. The cost is static. | DATA (README) |
| 11 | **Moderate metrics:** ROC AUC 0.91 (ranks easy/hard pairs well) but F1 0.50. It is useful for ranking routes, not as a «yes/no» detector. | DATA (`models/metrics.json`) |

## 4. Model confidence (disagreement between trees)

**Method.** Each of the 300 trees is asked for the probability of each 44 m cell and the standard deviation between trees is measured. `confidence = 1 − deviation / 0.5` (0.5 is the maximum possible). It is averaged to 300 × 300 for the browser. `scripts/export_uncertainty.py` reproduces it and checks that the mean of the trees matches the forest's `predict_proba`.

**Results** (whole 53 × 53 km area):

| Measure | Value |
|---|---|
| Mean deviation between trees | 0.166 (median 0.062; p90 0.453) |
| Cells with low confidence (< 0.5) | 34 % |
| Mean confidence along the model route to the summit | 0.56 |
| Mean confidence along the short route (slope-only baseline) | 0.42 |
| Mean confidence along the route to the CRISM footprint | 0.71 |
| Mean confidence along the «follow Curiosity's traverse» route | 0.85 |

**By distance to Curiosity's traverse:**

| Distance | % of the area | Mean confidence | Outside the training range |
|---|---|---|---|
| ≤ 1 km | 1.0 % | 0.75 | 2.4 % |
| 1 – 10 km | 13.7 % | 0.64 | 12.4 % |
| > 10 km | 85.3 % | 0.67 | 6.4 % |

**How to read it.**
- The route the model recommends has more confidence than the short route (0.56 versus 0.42), consistent with the model preferring it.
- **But the disagreement between trees barely changes when moving away from the traverse** (0.75 near, 0.67 far), even though far away the model is extrapolating. That is, the confidence **does not warn** when the model is outside its training zone: the trees can agree and be wrong together. That is why the interface separately shows the percentage of the area with out-of-range values and the warning on the «Model confidence» card.
- The confidence does not include the label bias (sections 2 and 3): a model can be very sure of something it measures badly.

## 5. What would be needed to improve (pending)

- Traversability labels designed for an astronaut (for example, measured walking times or effort), instead of a rover's traverse. There is no data in the repo for this.
- A sand or soft-soil feature. There is no data in the repo; a SPOC-type terrain classifier would need images and a license (the zips reviewed carry no license).
- Measuring extrapolation uncertainty with a different method (for example, distance in feature space to the training set), in addition to agreement between trees.

## 6. Where it appears in the application

- Layers → **Model confidence** (2D and 3D map).
- Conditions → **Predictive model**: confidence card and «Limitations and assumptions» section.
- Conditions → **Terrain and routes**: «Model confidence (mean)» row in the route comparison.
- Gale only: Jezero does not have this model.

## 7. Reproduce

```powershell
python scripts\build_layers.py        # regenerates data/processed/layers.npz (ignored by git)
python scripts\export_uncertainty.py  # models/uncertainty_summary.json and web/data/uncertainty_data.js
```

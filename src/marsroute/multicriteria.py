"""multicriteria.py — Multi-criteria planner and life-support resource evaluation.

Implements the three route profiles (Safe, Fast, Scientific),
the EVA walking kinematic model (Tobler adapted for a pressurized suit),
oxygen, energy and radiation accounting, strict final-shelter validation,
and the generation of structured explanations.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import yaml

from marsroute.domain import (
    Alert,
    AlertLevel,
    ResourceState,
    RouteAlternative,
    RoutePoint,
    RouteProfile,
    Shelter,
)
from marsroute.planner import astar, build_cost_surface, route_lonlat, simplify

MARS_RADIUS_M = 3396190.0
ROOT = Path(__file__).resolve().parents[2]


def load_profiles() -> Dict[str, RouteProfile]:
    """Loads the route profiles and hard constraints from config/route_profiles.yaml."""
    cfg_file = ROOT / "config" / "route_profiles.yaml"
    if not cfg_file.exists():
        # Safe defaults if the file does not exist
        return {
            "safe": RouteProfile("safe", "Safe Route", 6.0, 5.0, 15.0, 7.0, 0.15, 0.5, 0.85, "Maximum reserve"),
            "fast": RouteProfile("fast", "Fast Route", 2.0, 2.0, 20.0, 10.0, 0.05, 0.0, 1.15, "Shortest time"),
            "scientific": RouteProfile("scientific", "Scientific Route", 3.5, 3.0, 18.0, 8.0, 0.10, 4.0, 0.95, "Highest return"),
        }
    data = yaml.safe_load(cfg_file.read_text(encoding="utf-8"))
    profiles = {}
    for pid, pdata in data.get("profiles", {}).items():
        profiles[pid] = RouteProfile(
            id=pdata["id"],
            name=pdata["name"],
            risk_weight=float(pdata["risk_weight"]),
            slope_weight=float(pdata["slope_weight"]),
            max_slope_deg=float(pdata["max_slope_deg"]),
            caution_slope_deg=float(pdata["caution_slope_deg"]),
            min_traversability=float(pdata.get("min_traversability", 0.0)),
            science_reward_weight=float(pdata.get("science_reward_weight", 0.0)),
            speed_factor=float(pdata.get("speed_factor", 1.0)),
            description=pdata.get("description", "").strip(),
        )
    return profiles


def tobler_eva_speed_kmh(slope_grade: float, traversability: float, speed_factor: float = 1.0) -> float:
    """Computes the walking speed of an astronaut in a pressurized suit on Mars.

    Formula: base Tobler v = 6 * exp(-3.5 * |grade + 0.05|) km/h
    Adjusted for suit weight and pressurization (x0.55) and traversability (1 - 0.35*(1 - trav)).
    """
    tobler_base = 6.0 * math.exp(-3.5 * abs(slope_grade + 0.05))
    eva_speed = tobler_base * 0.55 * (1.0 - 0.35 * (1.0 - max(0.0, min(1.0, traversability))))
    return max(0.4, min(3.8, eva_speed * speed_factor))


def compute_path_resources(
    points: List[List[float]],
    profile: RouteProfile,
    mobility: str = "astronaut",
    base_o2_l_min: float = 1.2,
    battery_pct_per_h: float = 12.0,
    radiation_msv_per_h: float = 0.025,
) -> Tuple[float, float, ResourceState]:
    """Evaluates total distance, estimated hours and survival resources along the route."""
    if not points:
        return 0.0, 0.0, ResourceState()

    total_km = points[-1][2]
    total_hours = 0.0
    total_o2_liters = 0.0
    is_rover = (mobility == "rover")

    for i in range(1, len(points)):
        prev = points[i - 1]
        curr = points[i]
        d_km = curr[2] - prev[2]
        d_elev_m = curr[3] - prev[3]
        grade = (d_elev_m / (d_km * 1000.0)) if d_km > 0.001 else 0.0
        trav = curr[6] if len(curr) > 6 else 0.5

        speed = tobler_eva_speed_kmh(grade, trav, profile.speed_factor * (3.0 if is_rover else 1.0))
        step_hours = d_km / speed
        total_hours += step_hours

        # In a pressurized rover, life support is supplied by the cabin
        rate = (base_o2_l_min * 0.2) if is_rover else (base_o2_l_min * (1.3 if grade > 0.14 else 1.0))
        total_o2_liters += rate * (step_hours * 60.0)

    # Capacity: EVA suit astronaut (8 h at 1.2 L/min = 576 L), pressurized rover (72 h = 5184 L)
    o2_capacity = 5184.0 if is_rover else 576.0
    o2_pct = max(0.0, 100.0 - (total_o2_liters / o2_capacity) * 100.0)

    # Battery: 12% per hour in suit, 3% per hour in pressurized rover
    bat_rate = 3.0 if is_rover else battery_pct_per_h
    battery_pct = max(0.0, 100.0 - total_hours * bat_rate)

    # Accumulated ionizing radiation dose (rover shielding reduces it to 40%)
    rad_factor = 0.4 if is_rover else 1.0
    dose_msv = total_hours * radiation_msv_per_h * rad_factor

    # Shelter reserve (oxygen remaining on arrival at the final point)
    reserve_pct = o2_pct

    res = ResourceState(
        oxygen_pct=round(o2_pct, 1),
        battery_pct=round(battery_pct, 1),
        eva_time_min=round(total_hours * 60.0, 1),
        max_eva_time_min=4320.0 if is_rover else 480.0,
        radiation_dose_msv=round(dose_msv, 3),
        reserve_to_next_shelter_pct=round(reserve_pct, 1),
    )
    return round(total_km, 2), round(total_hours, 2), res


def check_shelter_proximity(
    lon: float, lat: float, shelters: List[Dict[str, Any]], tolerance_km: float = 1.0
) -> Optional[Dict[str, Any]]:
    """Checks whether some coordinates are within safe reach of a shelter."""
    for s in shelters:
        slon = s.get("lon", 0.0)
        slat = s.get("lat", 0.0)
        # Approximate spherical distance on Mars
        dlat = (lat - slat) * (math.pi / 180.0) * (MARS_RADIUS_M / 1000.0)
        dlon = (lon - slon) * (math.pi / 180.0) * (MARS_RADIUS_M / 1000.0) * math.cos(math.radians((lat + slat) / 2.0))
        dist = math.hypot(dlon, dlat)
        if dist <= tolerance_km:
            return s
    return None


class MultiCriteriaPlanner:
    """Hybrid planner that generates and compares the 3 alternatives under hard constraints."""

    def __init__(self, layers: Dict[str, np.ndarray], bbox: Tuple[float, float, float, float], grid_size: int = 1200):
        self.layers = layers
        self.bbox = bbox
        self.grid_size = grid_size
        self.profiles = load_profiles()

    def _lonlat_to_cell(self, lon: float, lat: float) -> Tuple[int, int]:
        w, s, e, n = self.bbox
        r = min(self.grid_size - 1, max(0, int((n - lat) / (n - s) * self.grid_size)))
        c = min(self.grid_size - 1, max(0, int((lon - w) / (e - w) * self.grid_size)))
        return r, c

    @staticmethod
    def _find_nearest_free(blocked: np.ndarray, r: int, c: int, max_radius: int = 15) -> Tuple[int, int]:
        """Finds the nearest traversable cell if the point falls inside the blocked margin."""
        if not blocked[r, c]:
            return r, c
        rows, cols = blocked.shape
        for rad in range(1, max_radius + 1):
            for dr in range(-rad, rad + 1):
                for dc in range(-rad, rad + 1):
                    rr, cc = r + dr, c + dc
                    if 0 <= rr < rows and 0 <= cc < cols and not blocked[rr, cc]:
                        return rr, cc
        return r, c

    def plan_alternative(
        self,
        profile_id: str,
        start_lonlat: Tuple[float, float],
        target_lonlats: List[Tuple[float, float]],
        final_shelter_lonlat: Optional[Tuple[float, float]],
        shelters_catalog: List[Dict[str, Any]],
        blocked_dynamic_cells: Optional[np.ndarray] = None,
        require_final_shelter: bool = True,
        mobility: Optional[str] = None,
    ) -> RouteAlternative:
        """Computes an alternative under the given profile and evaluates hard constraints."""
        profile = self.profiles.get(profile_id, self.profiles["safe"])
        trav = self.layers["traversability"]
        slope = self.layers["slope"]

        # Base cost with profile weights
        cost, blocked = build_cost_surface(
            trav,
            slope,
            risk_weight=profile.risk_weight,
            slope_weight=profile.slope_weight,
            max_slope_deg=profile.max_slope_deg,
            caution_slope_deg=profile.caution_slope_deg,
            min_traversability=profile.min_traversability,
            margin_cells=1,
        )

        # Add science reward if the profile requires it (lower cost in mineral zones)
        if profile.science_reward_weight > 0 and "minerals" in self.layers:
            minerals = self.layers["minerals"]
            cost = np.maximum(0.5, cost - profile.science_reward_weight * (minerals > 0.1).astype("float32") * 0.4)

        # Dynamic blocks (e.g. storm detected by an MDA)
        if blocked_dynamic_cells is not None:
            blocked = blocked | blocked_dynamic_cells

        # Build the stop sequence: start -> targets -> final shelter
        all_stops = [start_lonlat] + target_lonlats
        if final_shelter_lonlat:
            all_stops.append(final_shelter_lonlat)

        cells = [self._lonlat_to_cell(lon, lat) for lon, lat in all_stops]
        cells = [self._find_nearest_free(blocked, r, c) for r, c in cells]

        # Validate the hard final-shelter constraint
        alerts: List[Alert] = []
        is_valid = True
        rejection_reason = None

        final_dest = all_stops[-1]
        matched_shelter = check_shelter_proximity(final_dest[0], final_dest[1], shelters_catalog)
        if require_final_shelter and not matched_shelter:
            is_valid = False
            rejection_reason = (
                f"The final destination ({final_dest[0]:.3f}°, {final_dest[1]:.3f}°) is not a registered safe shelter. "
                "The EVA mission safety policy requires finishing at a pressurized shelter."
            )
            alerts.append(
                Alert(
                    id="ALERT-NO-SHELTER",
                    level=AlertLevel.CRITICAL,
                    variable="shelter",
                    threshold=1.0,
                    observed_value=0.0,
                    message="Destination without an available safe shelter.",
                    action_suggested="Select a registered base station or shelter as the final destination.",
                )
            )

        # Run A* in segments
        full_cells: list[Tuple[int, int]] = []
        try:
            for a, b in zip(cells, cells[1:]):
                r = astar(cost, blocked, a, b)
                cell_list = r.cells.tolist()
                full_cells.extend(cell_list if not full_cells else cell_list[1:])
        except ValueError as err:
            is_valid = False
            rejection_reason = f"No continuous traversable route exists: {err}"
            alerts.append(
                Alert(
                    id="ALERT-BLOCKED",
                    level=AlertLevel.CRITICAL,
                    variable="blocked_terrain",
                    threshold=profile.max_slope_deg,
                    observed_value=99.0,
                    message=f"Impassable corridor under profile {profile.name}.",
                    action_suggested="Reduce the intermediate stops or increase the slope tolerance.",
                )
            )
            return RouteAlternative(
                profile_id=profile.id,
                profile_name=profile.name,
                points=[],
                total_km=0.0,
                estimated_hours=0.0,
                resources=ResourceState(),
                alerts=alerts,
                is_valid=False,
                rejection_reason=rejection_reason,
            )

        # Simplify and convert to coordinates
        simplified = simplify(np.asarray(full_cells, dtype="int32"), tolerance=1.2)
        ll = route_lonlat(simplified, self.bbox, self.grid_size)

        # Build full points with elevation, slope, roughness and traversability
        dem = self.layers["dem"]
        rough = self.layers.get("roughness", np.zeros_like(dem))
        points: List[List[float]] = []
        cum_km = 0.0

        for i, (lon, lat) in enumerate(ll):
            r, c = self._lonlat_to_cell(lon, lat)
            elev = float(dem[r, c])
            sl = float(slope[r, c])
            ro = float(rough[r, c])
            tr = float(trav[r, c])
            if i > 0:
                prev_lon, prev_lat = ll[i - 1]
                dlat = (lat - prev_lat) * (math.pi / 180.0) * (MARS_RADIUS_M / 1000.0)
                dlon = (lon - prev_lon) * (math.pi / 180.0) * (MARS_RADIUS_M / 1000.0) * math.cos(math.radians((lat + prev_lat) / 2.0))
                cum_km += math.hypot(dlon, dlat)
            points.append([float(lon), float(lat), round(cum_km, 3), round(elev, 1), round(sl, 1), round(ro, 2), round(tr, 2)])

        # Evaluate resources and times (astronaut on short distances, pressurized rover on long expeditions)
        active_mobility = mobility or ("rover" if cum_km > 15.0 else "astronaut")
        total_km, total_hours, resources = compute_path_resources(points, profile, mobility=active_mobility)

        # Additional survival checks (keeping earlier rejections for a missing shelter)
        if not rejection_reason:
            if resources.oxygen_pct <= 0:
                is_valid = False
                rejection_reason = "Projected oxygen consumption exceeds the EVA suit capacity."
            elif resources.battery_pct <= 0:
                is_valid = False
                rejection_reason = "Life-support battery endurance exceeded."
        elif total_hours > 8.0:
            alerts.append(
                Alert(
                    id="ALERT-EVA-HOURS",
                    level=AlertLevel.CAUTION,
                    variable="eva_time",
                    threshold=8.0,
                    observed_value=total_hours,
                    message=f"Mission duration ({total_hours:.1f} h) close to the maximum safety limit.",
                    action_suggested="Consider shortening the traverse or setting up a rest stop at an intermediate shelter.",
                )
            )

        explanation = {
            "selected_profile": profile.name,
            "total_distance_km": total_km,
            "duration_hours": total_hours,
            "final_oxygen_reserve_pct": resources.reserve_to_next_shelter_pct,
            "shelter_reached": matched_shelter["name"] if matched_shelter else "None",
            "optimization_criterion": (
                "Minimized risk and restricted slope" if profile_id == "safe"
                else "Minimized time and distance" if profile_id == "fast"
                else "Maximized proximity to scientific targets"
            ),
        }

        return RouteAlternative(
            profile_id=profile.id,
            profile_name=profile.name,
            points=points,
            total_km=total_km,
            estimated_hours=total_hours,
            resources=resources,
            alerts=alerts,
            explanation=explanation,
            is_valid=is_valid,
            rejection_reason=rejection_reason,
        )

    def plan_all_alternatives(
        self,
        start_lonlat: Tuple[float, float],
        target_lonlats: List[Tuple[float, float]],
        final_shelter_lonlat: Optional[Tuple[float, float]],
        shelters_catalog: List[Dict[str, Any]],
        blocked_dynamic_cells: Optional[np.ndarray] = None,
        require_final_shelter: bool = True,
    ) -> Dict[str, RouteAlternative]:
        """Computes the 3 alternatives at once to allow direct comparison."""
        results = {}
        for pid in ("safe", "fast", "scientific"):
            results[pid] = self.plan_alternative(
                profile_id=pid,
                start_lonlat=start_lonlat,
                target_lonlats=target_lonlats,
                final_shelter_lonlat=final_shelter_lonlat,
                shelters_catalog=shelters_catalog,
                blocked_dynamic_cells=blocked_dynamic_cells,
                require_final_shelter=require_final_shelter,
            )
        return results

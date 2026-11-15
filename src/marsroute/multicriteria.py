"""multicriteria.py — Planificador multicriterio y evaluación de recursos de soporte vital.

Implementa los tres perfiles de ruta (Segura, Rápida, Científica),
el modelo cinemático de caminata EVA (Tobler para traje presurizado),
la contabilidad de oxígeno, energía y radiación, la validación estricta de refugio final,
y la generación de explicaciones estructuradas.
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
from marsroute.planner import astar, build_cost_surface, route_lonlat

MARS_RADIUS_M = 3396190.0
ROOT = Path(__file__).resolve().parents[2]


def load_profiles() -> Dict[str, RouteProfile]:
    """Carga los perfiles de ruta y restricciones duras desde config/route_profiles.yaml."""
    cfg_file = ROOT / "config" / "route_profiles.yaml"
    if not cfg_file.exists():
        # Valores por defecto seguros si el archivo no existiera
        return {
            "segura": RouteProfile("segura", "Ruta Segura", 6.0, 5.0, 15.0, 7.0, 0.15, 0.5, 0.85, "Máxima reserva"),
            "rapida": RouteProfile("rapida", "Ruta Rápida", 2.0, 2.0, 20.0, 10.0, 0.05, 0.0, 1.15, "Menor tiempo"),
            "cientifica": RouteProfile("cientifica", "Ruta Científica", 3.5, 3.0, 18.0, 8.0, 0.10, 4.0, 0.95, "Mayor retorno"),
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
    """Calcula la velocidad de caminata de un astronauta con traje presurizado en Marte.

    Fórmula: Tobler base v = 6 * exp(-3.5 * |grade + 0.05|) km/h
    Ajustada por peso de traje y presurización (x0.55) y transitabilidad (1 - 0.35*(1 - trav)).
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
    """Evalúa la distancia total, horas estimadas y recursos de supervivencia a lo largo de la ruta."""
    if mobility != "astronaut":
        raise ValueError("El modelo de recursos EVA solo admite astronautas")
    if not points:
        return 0.0, 0.0, ResourceState()

    total_km = points[-1][2]
    total_hours = 0.0
    total_o2_liters = 0.0

    for i in range(1, len(points)):
        prev = points[i - 1]
        curr = points[i]
        d_km = curr[2] - prev[2]
        d_elev_m = curr[3] - prev[3]
        grade = (d_elev_m / (d_km * 1000.0)) if d_km > 0.001 else 0.0
        trav = curr[6] if len(curr) > 6 else 0.5

        speed = tobler_eva_speed_kmh(grade, trav, profile.speed_factor)
        step_hours = d_km / speed
        total_hours += step_hours

        rate = base_o2_l_min * (1.3 if grade > 0.14 else 1.0)
        total_o2_liters += rate * (step_hours * 60.0)

    # Capacidad demostrativa del traje EVA: 8 h a 1.2 L/min.
    o2_capacity = 576.0
    o2_pct = max(0.0, 100.0 - (total_o2_liters / o2_capacity) * 100.0)

    battery_pct = max(0.0, 100.0 - total_hours * battery_pct_per_h)

    dose_msv = total_hours * radiation_msv_per_h

    # Reserva al refugio (oxígeno restante al llegar al punto final)
    reserve_pct = o2_pct

    res = ResourceState(
        oxygen_pct=o2_pct,
        battery_pct=battery_pct,
        eva_time_min=total_hours * 60.0,
        max_eva_time_min=480.0,
        radiation_dose_msv=dose_msv,
        reserve_to_next_shelter_pct=reserve_pct,
    )
    return total_km, total_hours, res


def check_shelter_proximity(
    lon: float, lat: float, shelters: List[Dict[str, Any]], tolerance_km: float = 1.0
) -> Optional[Dict[str, Any]]:
    """Verifica si unas coordenadas se encuentran dentro del radio de alcance seguro de un refugio."""
    for s in shelters:
        slon = s.get("lon", 0.0)
        slat = s.get("lat", 0.0)
        # Distancia esférica aproximada en Marte
        dlat = (lat - slat) * (math.pi / 180.0) * (MARS_RADIUS_M / 1000.0)
        dlon = (lon - slon) * (math.pi / 180.0) * (MARS_RADIUS_M / 1000.0) * math.cos(math.radians((lat + slat) / 2.0))
        dist = math.hypot(dlon, dlat)
        if dist <= tolerance_km:
            return s
    return None


class MultiCriteriaPlanner:
    """Planificador híbrido que genera y compara las 3 alternativas con restricciones duras."""

    def __init__(self, layers: Dict[str, np.ndarray], bbox: Tuple[float, float, float, float], grid_size: int = 1200):
        self.layers = layers
        self.bbox = bbox
        self.grid_size = grid_size
        self.profiles = load_profiles()

    def _lonlat_to_cell(self, lon: float, lat: float) -> Tuple[int, int]:
        w, s, e, n = self.bbox
        if not (math.isfinite(lon) and math.isfinite(lat) and w <= lon <= e and s <= lat <= n):
            raise ValueError("Coordenadas fuera de la región")
        r = min(self.grid_size - 1, max(0, int((n - lat) / (n - s) * self.grid_size)))
        c = min(self.grid_size - 1, max(0, int((lon - w) / (e - w) * self.grid_size)))
        return r, c

    @staticmethod
    def _find_nearest_free(blocked: np.ndarray, r: int, c: int, max_radius: int = 15) -> Tuple[int, int]:
        """Encuentra la celda transitable más cercana si el punto cae en el margen de bloqueo."""
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
        """Calcula una alternativa bajo el perfil especificado y evalúa restricciones duras."""
        if profile_id not in self.profiles:
            raise ValueError("Perfil de ruta desconocido")
        if mobility not in (None, "astronaut"):
            raise ValueError("El planificador EVA solo admite astronautas")
        if not target_lonlats and final_shelter_lonlat is None:
            raise ValueError("La ruta requiere al menos un destino")
        if blocked_dynamic_cells is not None and blocked_dynamic_cells.shape != self.layers["dem"].shape:
            raise ValueError("La máscara dinámica no coincide con la región")
        profile = self.profiles.get(profile_id, self.profiles["segura"])
        trav = self.layers["traversability"]
        slope = self.layers["slope"]

        # Costo base con ponderaciones del perfil
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

        # Incorporar recompensa científica si el perfil lo exige (reducir costo en zonas con minerales)
        if profile.science_reward_weight > 0 and "minerals" in self.layers:
            minerals = self.layers["minerals"]
            cost = np.maximum(0.5, cost - profile.science_reward_weight * (minerals > 0.1).astype("float32") * 0.4)

        # Bloqueos dinámicos (ej. tormenta detectada por MDA)
        if blocked_dynamic_cells is not None:
            blocked = blocked | blocked_dynamic_cells
        if "valid" in self.layers:
            blocked = blocked | ~self.layers["valid"].astype(bool)
        blocked = blocked | ~np.isfinite(self.layers["dem"])

        # Construir secuencia de paradas: inicio -> objetivos -> refugio final
        all_stops = [start_lonlat] + target_lonlats
        if final_shelter_lonlat:
            all_stops.append(final_shelter_lonlat)

        cells = [self._lonlat_to_cell(lon, lat) for lon, lat in all_stops]

        # Validar restricción dura de refugio final
        alerts: List[Alert] = []
        is_valid = True
        rejection_reason = None

        # A* termina en el centro de la celda, no necesariamente en la
        # coordenada solicitada. Validar el punto que devolverá la ruta.
        final_dest = route_lonlat(np.asarray([cells[-1]], dtype="int32"), self.bbox, self.grid_size)[0]
        matched_shelter = check_shelter_proximity(final_dest[0], final_dest[1], shelters_catalog)
        if require_final_shelter and not matched_shelter:
            is_valid = False
            rejection_reason = (
                f"El destino final ({final_dest[0]:.3f}°, {final_dest[1]:.3f}°) no es un refugio seguro registrado. "
                "La política de seguridad de la misión EVA exige culminar en un refugio presurizado."
            )
            alerts.append(
                Alert(
                    id="ALERT-NO-SHELTER",
                    level=AlertLevel.CRITICA,
                    variable="refugio",
                    threshold=1.0,
                    observed_value=0.0,
                    message="Destino sin refugio seguro disponible.",
                    action_suggested="Seleccione una estación base o refugio registrado como destino final.",
                )
            )

        # Ejecutar A* en tramos
        full_cells: list[Tuple[int, int]] = []
        try:
            for a, b in zip(cells, cells[1:]):
                r = astar(cost, blocked, a, b)
                cell_list = r.cells.tolist()
                full_cells.extend(cell_list if not full_cells else cell_list[1:])
        except ValueError as err:
            is_valid = False
            rejection_reason = f"No existe ruta continua practicable: {err}"
            alerts.append(
                Alert(
                    id="ALERT-BLOCKED",
                    level=AlertLevel.CRITICA,
                    variable="terreno_bloqueado",
                    threshold=profile.max_slope_deg,
                    observed_value=99.0,
                    message=f"Corredor impracticable bajo perfil {profile.name}.",
                    action_suggested="Reduzca las paradas intermedias o incremente la tolerancia de pendiente.",
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

        # Convertir la ruta densa a coordenadas
        ll = route_lonlat(np.asarray(full_cells, dtype="int32"), self.bbox, self.grid_size)

        # Construir puntos completos con elevación, pendiente, rugosidad y transitabilidad
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
            points.append([float(lon), float(lat), cum_km, elev, sl, ro, tr])

        # Evaluar recursos y tiempos de la caminata EVA.
        active_mobility = mobility or "astronaut"
        if active_mobility != "astronaut":
            raise ValueError("El planificador EVA solo admite astronautas; los rovers son fuentes de información")
        total_km, total_hours, resources = compute_path_resources(points, profile, mobility=active_mobility)

        settings = yaml.safe_load((ROOT / "config" / "route_profiles.yaml").read_text(encoding="utf-8"))
        limits = settings["hard_constraints"]
        reserve = settings["profiles"][profile.id].get("min_reserve_pct", 0)
        checks = [
            (resources.oxygen_pct < max(reserve, limits["min_oxygen_reserve_pct"]), "Reserva de oxígeno insuficiente"),
            (resources.battery_pct < max(reserve, limits["min_battery_reserve_pct"]), "Reserva de batería insuficiente"),
            (resources.eva_time_min > limits["max_eva_hours"] * 60, "Duración EVA excedida"),
            (resources.radiation_dose_msv > limits["max_radiation_dose_msv"], "Dosis de radiación excedida"),
        ]
        violations = [reason for failed, reason in checks if failed]
        if violations:
            is_valid = False
            rejection_reason = rejection_reason or "; ".join(violations)

        # Validaciones de supervivencia adicionales (conservando rechazos previos por refugio ausente)
        if not rejection_reason:
            if resources.oxygen_pct <= 0:
                is_valid = False
                rejection_reason = "Consumo de oxígeno proyectado supera la capacidad del traje EVA."
            elif resources.battery_pct <= 0:
                is_valid = False
                rejection_reason = "Autonomía de baterías de soporte vital excedida."
        elif total_hours > 8.0:
            alerts.append(
                Alert(
                    id="ALERT-EVA-HOURS",
                    level=AlertLevel.PRECAUCION,
                    variable="tiempo_eva",
                    threshold=8.0,
                    observed_value=total_hours,
                    message=f"Duración de la misión ({total_hours:.1f} h) cercana al límite máximo de seguridad.",
                    action_suggested="Considere acortar la travesía o establecer un punto de descanso en un refugio intermedio.",
                )
            )

        explanation = {
            "perfil_seleccionado": profile.name,
            "distancia_total_km": total_km,
            "duracion_horas": total_hours,
            "reserva_oxigeno_final_pct": resources.reserve_to_next_shelter_pct,
            "refugio_alcanzado": matched_shelter["name"] if matched_shelter else "Ninguno",
            "criterio_optimizacion": (
                "Riesgo minimizado y pendiente restringida" if profile_id == "segura"
                else "Tiempo y distancia minimizados" if profile_id == "rapida"
                else "Proximidad a objetivos científicos maximizada"
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
        """Calcula las 3 alternativas simultáneamente para permitir la comparación directa."""
        results = {}
        for pid in ("segura", "rapida", "cientifica"):
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

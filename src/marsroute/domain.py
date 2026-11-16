"""domain.py — Unified domain contracts for GaleX.

Defines the shared structures for regions, weather observations,
MDA stations, scientific targets, shelters, explorer resources,
route requests and alternatives, alerts and mission reports.
"""
from __future__ import annotations

import enum
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


class Provenance(str, enum.Enum):
    """Provenance level of the data, following the principle of scientific honesty."""
    OBSERVED = "OBSERVED"    # Measured by a real instrument (REMS, MEDA, MOLA, etc.)
    DERIVED = "DERIVED"      # Computed from observations (slope, roughness, etc.)
    SIMULATED = "SIMULATED"  # Generated for the demonstration (hypothetical MDAs, life support)


class AlertLevel(str, enum.Enum):
    """Severity of an environmental or operational alert."""
    INFO = "INFO"
    CAUTION = "CAUTION"
    CRITICAL = "CRITICAL"


@dataclass
class Region:
    """Configuration and metadata of a Martian region."""
    id: str                                  # 'gale' or 'jezero'
    name: str                                # Human-readable name (e.g. 'Gale Crater - Mount Sharp')
    bbox: Tuple[float, float, float, float]  # [west, south, east, north] in degrees
    crs: str                                 # EPSG:104905 or another Martian CRS
    center: Tuple[float, float]              # [lon, lat]
    resolution_m: float                      # Native resolution in meters/cell
    description: str = ""
    available_layers: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> Region:
        bbox = tuple(data["bbox"])
        center = tuple(data["center"])
        return cls(
            id=data["id"],
            name=data["name"],
            bbox=bbox,  # type: ignore[arg-type]
            crs=data.get("crs", "EPSG:104905"),
            center=center,  # type: ignore[arg-type]
            resolution_m=float(data.get("resolution_m", 44.0)),
            description=data.get("description", ""),
            available_layers=list(data.get("available_layers", [])),
        )


@dataclass
class MDAObservation:
    """Single or combined reading from an automatic weather station (MDA)."""
    station_id: str
    variable: str                            # 'air_temp', 'ground_temp', 'pressure', 'wind_speed', 'dust_tau', 'uv', 'radiation_rate'
    value: float
    unit: str                                # '°C', 'Pa', 'm/s', 'dimensionless', 'W/m²', 'µSv/h'
    sol: int
    hour_ltst: float                         # Local true solar time (0.0 - 24.0)
    source: Provenance = Provenance.SIMULATED
    quality: float = 1.0                     # 0.0 to 1.0


@dataclass
class MDAStation:
    """Automatic weather station placed on the Martian grid."""
    id: str                                  # e.g. 'MDA-GALE-14'
    region_id: str
    cell_rc: Tuple[int, int]                 # (row, column) in the regional grid
    lon: float
    lat: float
    status: str = "nominal"                  # 'nominal', 'alert', 'no_comms'
    last_update_sol_min: float = 0.0
    readings: Dict[str, float] = field(default_factory=dict)
    provenance: Provenance = Provenance.SIMULATED

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["provenance"] = self.provenance.value
        return d


@dataclass
class ScientificTarget:
    """Scientific target or point of interest for sample collection."""
    id: str
    region_id: str
    name: str
    type: str                                # 'mineral', 'spectral', 'rock', 'geology'
    lon: float
    lat: float
    priority: int = 1                        # 1 (high) to 5 (low)
    instrument: str = ""                     # e.g. 'CRISM', 'CHEMCAM', 'PIXL', 'SHERLOC'
    source: Provenance = Provenance.OBSERVED
    description: str = ""

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["source"] = self.source.value
        return d


@dataclass
class Shelter:
    """Shelter or safe habitat where the explorer can resupply or end the EVA."""
    id: str
    region_id: str
    name: str
    lon: float
    lat: float
    capacity: int = 4
    oxygen_reserves_h: float = 48.0
    power_reserves_h: float = 72.0
    is_active: bool = True
    provenance: Provenance = Provenance.SIMULATED

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["provenance"] = self.provenance.value
        return d


@dataclass
class ResourceState:
    """State and budget of the explorer's consumables during an EVA."""
    oxygen_pct: float = 100.0                # 0.0% to 100.0%
    battery_pct: float = 100.0               # 0.0% to 100.0%
    eva_time_min: float = 0.0                # Elapsed duration
    max_eva_time_min: float = 480.0          # 8 nominal hours
    radiation_dose_msv: float = 0.0          # Accumulated dose (demonstration limit 5 mSv)
    max_radiation_dose_msv: float = 5.0
    reserve_to_next_shelter_pct: float = 25.0  # Oxygen margin reserved to reach a shelter

    def is_safe(self) -> Tuple[bool, Optional[str]]:
        """Checks whether consumables are within survival limits."""
        if self.oxygen_pct <= 0.0:
            return False, "Oxygen depleted."
        if self.battery_pct <= 0.0:
            return False, "Life-support battery depleted."
        if self.eva_time_min > self.max_eva_time_min:
            return False, f"EVA time exceeded ({self.eva_time_min:.0f}/{self.max_eva_time_min:.0f} min)."
        if self.radiation_dose_msv > self.max_radiation_dose_msv:
            return False, f"Critical radiation dose exceeded ({self.radiation_dose_msv:.2f} mSv)."
        return True, None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Alert:
    """Explainable alert issued when terrain or weather degrades."""
    id: str
    level: AlertLevel
    variable: str                            # 'slope', 'wind', 'dust', 'oxygen', 'radiation', 'shelter'
    threshold: float
    observed_value: float
    message: str
    action_suggested: str
    affected_km_start: float = 0.0
    affected_km_end: float = 0.0
    affected_lonlat: Optional[Tuple[float, float]] = None
    created_at_sol_min: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["level"] = self.level.value
        return d


@dataclass
class RouteProfile:
    """Weighting parameters and thresholds for a route profile."""
    id: str                                  # 'safe', 'fast', 'scientific'
    name: str
    risk_weight: float
    slope_weight: float
    max_slope_deg: float
    caution_slope_deg: float
    min_traversability: float = 0.0
    science_reward_weight: float = 0.0
    speed_factor: float = 1.0                # Multiplier on nominal speed
    description: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class RouteRequest:
    """Route computation request sent to the planner."""
    region_id: str
    start: Tuple[float, float]               # (lon, lat)
    targets: List[Tuple[float, float]] = field(default_factory=list)  # [(lon, lat), ...]
    final_shelter: Optional[Tuple[float, float]] = None                # (lon, lat) Required for valid routes
    profile_id: str = "safe"
    user_overrides: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RoutePoint:
    """Point along a computed route."""
    lon: float
    lat: float
    km: float
    elev_m: float
    slope_deg: float
    roughness: float
    traversability: float


@dataclass
class RouteAlternative:
    """Route generated under a specific profile, with its metrics and resources."""
    profile_id: str
    profile_name: str
    points: List[List[float]]                # [[lon, lat, km, elev, slope, rough, trav], ...]
    total_km: float
    estimated_hours: float
    resources: ResourceState
    alerts: List[Alert] = field(default_factory=list)
    explanation: Dict[str, Any] = field(default_factory=dict)
    is_valid: bool = True
    rejection_reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["alerts"] = [a.to_dict() if isinstance(a, Alert) else a for a in self.alerts]
        return d


@dataclass
class Report:
    """Logbook report or geological finding persisted in SQLite."""
    id: str
    author: str                              # 'ev1', 'ev2', 'ev3', 'sistema', 'tierra' (stored wire values)
    type: str                                # 'hallazgo' (finding), 'mensaje', 'mision', 'alerta' (stored wire values)
    lon: float
    lat: float
    elev_m: float = 0.0
    sol_min: float = 0.0
    km: float = 0.0
    text: str = ""
    attachments: Dict[str, Any] = field(default_factory=dict)
    sync_status: str = "local"               # 'local', 'enviado' (sent), 'pendiente' (pending)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

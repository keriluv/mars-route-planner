"""domain.py — Contratos de dominio unificados para GaleX.

Define las estructuras compartidas para regiones, observaciones meteorológicas,
estaciones MDA, objetivos científicos, refugios, recursos del explorador,
solicitudes y alternativas de ruta, alertas y reportes de misión.
"""
from __future__ import annotations

import enum
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


class Provenance(str, enum.Enum):
    """Nivel de procedencia de los datos según principio de honestidad científica."""
    OBSERVADA = "OBSERVADA"  # Medida por instrumento real (REMS, MEDA, MOLA, etc.)
    DERIVADA = "DERIVADA"    # Calculada a partir de observaciones (pendiente, rugosidad, etc.)
    SIMULADA = "SIMULADA"    # Generada para la demostración (MDA hipotéticas, soporte vital)


class AlertLevel(str, enum.Enum):
    """Severidad de una alerta ambiental u operativa."""
    INFO = "INFO"
    PRECAUCION = "PRECAUCIÓN"
    CRITICA = "CRÍTICA"


@dataclass
class Region:
    """Configuración y metadatos de una región marciana."""
    id: str                                  # 'gale' o 'jezero'
    name: str                                # Nombre legible (ej. 'Cráter Gale - Mount Sharp')
    bbox: Tuple[float, float, float, float]  # [west, south, east, north] en grados
    crs: str                                 # EPSG:104905 u otro CRS marciano
    center: Tuple[float, float]              # [lon, lat]
    resolution_m: float                      # Resolución nativa en metros/celda
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
    """Lectura individual o combinada de una estación meteorológica automática (MDA)."""
    station_id: str
    variable: str                            # 'air_temp', 'ground_temp', 'pressure', 'wind_speed', 'dust_tau', 'uv', 'radiation_rate'
    value: float
    unit: str                                # '°C', 'Pa', 'm/s', 'dimensionless', 'W/m²', 'µSv/h'
    sol: int
    hour_ltst: float                         # Hora solar local verdadera (0.0 - 24.0)
    source: Provenance = Provenance.SIMULADA
    quality: float = 1.0                     # 0.0 a 1.0


@dataclass
class MDAStation:
    """Estación meteorológica automática distribuida en la retícula marciana."""
    id: str                                  # ej. 'MDA-GALE-14'
    region_id: str
    cell_rc: Tuple[int, int]                 # (fila, columna) en la retícula regional
    lon: float
    lat: float
    status: str = "nominal"                  # 'nominal', 'alerta', 'sin_comunicacion'
    last_update_sol_min: float = 0.0
    readings: Dict[str, float] = field(default_factory=dict)
    provenance: Provenance = Provenance.SIMULADA

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["provenance"] = self.provenance.value
        return d


@dataclass
class ScientificTarget:
    """Objetivo o punto de interés científico para la recolección de muestras."""
    id: str
    region_id: str
    name: str
    type: str                                # 'mineral', 'espectral', 'roca', 'geologia'
    lon: float
    lat: float
    priority: int = 1                        # 1 (alta) a 5 (baja)
    instrument: str = ""                     # ej. 'CRISM', 'CHEMCAM', 'PIXL', 'SHERLOC'
    source: Provenance = Provenance.OBSERVADA
    description: str = ""

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["source"] = self.source.value
        return d


@dataclass
class Shelter:
    """Refugio o hábitat seguro donde el explorador puede reabastecerse o finalizar la EVA."""
    id: str
    region_id: str
    name: str
    lon: float
    lat: float
    capacity: int = 4
    oxygen_reserves_h: float = 48.0
    power_reserves_h: float = 72.0
    is_active: bool = True
    provenance: Provenance = Provenance.SIMULADA

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["provenance"] = self.provenance.value
        return d


@dataclass
class ResourceState:
    """Estado y presupuesto de consumibles del explorador durante una EVA."""
    oxygen_pct: float = 100.0                # 0.0% a 100.0%
    battery_pct: float = 100.0               # 0.0% a 100.0%
    eva_time_min: float = 0.0                # Duración transcurrida
    max_eva_time_min: float = 480.0          # 8 horas nominales
    radiation_dose_msv: float = 0.0          # Dosis acumulada (límite demostrativo 5 mSv)
    max_radiation_dose_msv: float = 5.0
    reserve_to_next_shelter_pct: float = 25.0  # Margen de oxígeno reservado para alcanzar refugio
    metabolic_power_w: float = 0.0             # Gasto metabólico instantáneo o medio (W)
    calories_kcal: float = 0.0                 # Calorías acumuladas quemadas (kcal)
    heart_rate_bpm: float = 70.0               # Frecuencia cardíaca estimada (lpm)
    water_liters: float = 0.0                  # Agua acumulada consumida (L)
    o2_used_g: float = 0.0                     # Gramos de O2 consumidos acumulados

    def is_safe(self) -> Tuple[bool, Optional[str]]:
        """Comprueba si los consumibles están dentro de los límites de supervivencia."""
        if self.oxygen_pct <= 0.0:
            return False, "Oxígeno agotado."
        if self.battery_pct <= 0.0:
            return False, "Batería de soporte vital agotada."
        if self.eva_time_min > self.max_eva_time_min:
            return False, f"Tiempo EVA excedido ({self.eva_time_min:.0f}/{self.max_eva_time_min:.0f} min)."
        if self.radiation_dose_msv > self.max_radiation_dose_msv:
            return False, f"Dosis de radiación crítica excedida ({self.radiation_dose_msv:.2f} mSv)."
        return True, None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Alert:
    """Alerta explicable emitida ante degradación del terreno o del clima."""
    id: str
    level: AlertLevel
    variable: str                            # 'pendiente', 'viento', 'polvo', 'oxigeno', 'radiacion', 'refugio'
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
    """Parámetros de ponderación y umbrales para un perfil de ruta."""
    id: str                                  # 'segura', 'rapida', 'cientifica'
    name: str
    risk_weight: float
    slope_weight: float
    max_slope_deg: float
    caution_slope_deg: float
    min_traversability: float = 0.0
    science_reward_weight: float = 0.0
    speed_factor: float = 1.0                # Multiplicador sobre velocidad nominal
    description: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class RouteRequest:
    """Solicitud de cálculo de ruta enviada al planificador."""
    region_id: str
    start: Tuple[float, float]               # (lon, lat)
    targets: List[Tuple[float, float]] = field(default_factory=list)  # [(lon, lat), ...]
    final_shelter: Optional[Tuple[float, float]] = None                # (lon, lat) Obligatorio para rutas válidas
    profile_id: str = "segura"
    user_overrides: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RoutePoint:
    """Punto a lo largo de una ruta calculada."""
    lon: float
    lat: float
    km: float
    elev_m: float
    slope_deg: float
    roughness: float
    traversability: float


@dataclass
class RouteAlternative:
    """Ruta generada bajo un perfil específico con sus métricas y recursos."""
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
    """Reporte de bitácora o hallazgo geológico persistido en SQLite."""
    id: str
    author: str                              # 'ev1', 'ev2', 'ev3', 'sistema', 'tierra'
    type: str                                # 'hallazgo', 'mensaje', 'mision', 'alerta'
    lon: float
    lat: float
    elev_m: float = 0.0
    sol_min: float = 0.0
    km: float = 0.0
    text: str = ""
    attachments: Dict[str, Any] = field(default_factory=dict)
    sync_status: str = "local"               # 'local', 'enviado', 'pendiente'
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LightSource
from matplotlib.patches import Rectangle
from matplotlib.ticker import MaxNLocator
from scipy.ndimage import uniform_filter1d


def _fill(dem: np.ndarray) -> np.ndarray:
    values = dem.astype("float64")
    if not np.isfinite(values).all():
        values = np.where(np.isfinite(values), values, np.nanmedian(values))
    return values


def hillshade(dem: np.ndarray, dx_m: float, dy_m: float) -> np.ndarray:
    source = LightSource(azdeg=315.0, altdeg=45.0)
    return source.hillshade(_fill(dem), vert_exag=3.0, dx=dx_m, dy=dy_m)


def _stretch(array: np.ndarray, low: float = 2.0, high: float = 98.0) -> np.ndarray:
    values = array.astype("float64")
    minimum, maximum = np.nanpercentile(values, [low, high])
    if maximum <= minimum:
        return np.zeros_like(values)
    return np.clip((values - minimum) / (maximum - minimum), 0.0, 1.0)


def _extent(meta: dict) -> list[float]:
    west, south, east, north = meta["bbox"]
    return [west, east, south, north]


def _finish(fig, path: Path, dpi: int = 150) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=dpi, bbox_inches="tight")
    plt.close(fig)


def plot_layer_grid(layers: dict, meta: dict, path: Path) -> None:
    extent = _extent(meta)
    shade = hillshade(layers["dem"], meta["dx_m"], meta["dy_m"])
    panels = [
        ("Elevación (DEM MOLA/HRSC 200 m)", layers["dem"], "terrain", False),
        ("Pendiente (°)", layers["slope"], "viridis", False),
        ("Rugosidad (m)", layers["roughness"], "magma", True),
        ("Óptico (HRSC color)", layers["optical"], "gray", True),
        ("Textura óptica", layers["texture"], "gray", True),
        ("Gradiente óptico", layers["gradient"], "gray", True),
        ("Térmico diurno (THEMIS 100 m)", layers["thermal"], "inferno", False),
        ("Índice de color (Viking 232 m)", layers["color_index"], "coolwarm", True),
        ("Cobertura espectral CRISM MTRDR", layers["spectral_coverage"], "cividis", False),
    ]
    fig, axes = plt.subplots(3, 3, figsize=(13, 13), constrained_layout=True)
    for axis, (title, array, cmap, stretch) in zip(axes.ravel(), panels):
        kwargs = {}
        if stretch:
            low, high = np.nanpercentile(array, [2.0, 98.0])
            kwargs = {"vmin": low, "vmax": high}
        image = axis.imshow(array, extent=extent, origin="upper", cmap=cmap, **kwargs)
        axis.set_title(title, fontsize=10)
        axis.set_xlabel("Longitud (°E)", fontsize=8)
        axis.set_ylabel("Latitud (°N)", fontsize=8)
        axis.tick_params(labelsize=7)
        axis.xaxis.set_major_locator(MaxNLocator(4))
        axis.yaxis.set_major_locator(MaxNLocator(5))
        fig.colorbar(image, ax=axis, shrink=0.75, pad=0.02)
    axes[0, 0].imshow(shade, extent=extent, origin="upper", cmap="gray", alpha=0.35)
    fig.suptitle("Capas de datos superpuestas - Mount Sharp, Gale Crater", fontsize=14)
    _finish(fig, path)


def plot_traversability(
    traversability: np.ndarray, blocked: np.ndarray, cost: np.ndarray, meta: dict, path: Path
) -> None:
    extent = _extent(meta)
    fig, axes = plt.subplots(1, 3, figsize=(16, 5.2), constrained_layout=True)
    first = axes[0].imshow(traversability, extent=extent, origin="upper", cmap="RdYlGn", vmin=0, vmax=1)
    axes[0].set_title("Probabilidad de terreno transitable")
    fig.colorbar(first, ax=axes[0], shrink=0.8)
    second = axes[1].imshow(cost, extent=extent, origin="upper", cmap="magma")
    axes[1].set_title("Costo de desplazamiento")
    fig.colorbar(second, ax=axes[1], shrink=0.8)
    overlay = np.where(blocked, 1.0, 0.0)
    third = axes[2].imshow(overlay, extent=extent, origin="upper", cmap="Greys", vmin=0, vmax=1)
    axes[2].set_title(f"Zonas bloqueadas ({100.0 * blocked.mean():.1f} %)")
    fig.colorbar(third, ax=axes[2], shrink=0.8, ticks=[0, 1])
    for axis in axes:
        axis.set_xlabel("Longitud (°E)", fontsize=9)
        axis.set_ylabel("Latitud (°N)", fontsize=9)
    _finish(fig, path)


def plot_route(
    layers: dict,
    meta: dict,
    route_lonlat: np.ndarray,
    traverse_paths,
    start,
    goal,
    metrics: dict,
    path: Path,
) -> None:
    extent = _extent(meta)
    shade = hillshade(layers["dem"], meta["dx_m"], meta["dy_m"])
    optical = _stretch(layers["optical"], 1.0, 99.0)
    base = np.clip(optical**1.5 * (0.55 + 0.45 * shade), 0.0, 1.0)
    figure, axis = plt.subplots(figsize=(11, 11), constrained_layout=True)
    axis.imshow(base, extent=extent, origin="upper", cmap="gray", vmin=0, vmax=1)
    for index, path_points in enumerate(traverse_paths):
        points = np.asarray(path_points)
        axis.plot(
            points[:, 0],
            points[:, 1],
            color="#22d3ee",
            linewidth=1.3,
            linestyle=(0, (5, 3)),
            alpha=0.9,
            label="Recorrido real de Curiosity" if index == 0 else None,
            zorder=4,
        )
    axis.plot(route_lonlat[:, 0], route_lonlat[:, 1], color="white", linewidth=4.5, zorder=5)
    axis.plot(
        route_lonlat[:, 0],
        route_lonlat[:, 1],
        color="#f97316",
        linewidth=2.4,
        label="Ruta segura calculada",
        zorder=6,
    )
    axis.plot(start[0], start[1], marker="^", color="#22c55e", markersize=15, markeredgecolor="black", zorder=7, label="Inicio")
    axis.plot(goal[0], goal[1], marker="*", color="#e879f9", markersize=20, markeredgecolor="black", zorder=7, label="Objetivo")
    axis.set_xlim(extent[0], extent[1])
    axis.set_ylim(extent[2], extent[3])
    axis.set_xlabel("Longitud (°E)")
    axis.set_ylabel("Latitud (°N)")
    axis.set_title("Ruta segura hacia la cumbre de Mount Sharp (Aeolis Mons)")
    axis.legend(loc="lower left", framealpha=0.85, fontsize=9)
    axis.grid(color="white", alpha=0.15, linewidth=0.5)
    scale_km = 5.0
    degrees = scale_km * 1000.0 / (np.pi / 180.0 * 3396190.0 * np.cos(np.deg2rad(-4.87)))
    bar_x = [extent[1] - 0.012 - degrees, extent[1] - 0.012]
    bar_y = [extent[2] + 0.006] * 2
    axis.plot(bar_x, bar_y, color="white", linewidth=6, solid_capstyle="butt", zorder=8)
    axis.plot(bar_x, bar_y, color="black", linewidth=2, solid_capstyle="butt", zorder=9)
    axis.text(
        extent[1] - 0.012 - degrees / 2,
        extent[2] + 0.010,
        f"{scale_km:.0f} km",
        color="black",
        ha="center",
        fontsize=9,
        zorder=9,
        bbox={"facecolor": "white", "alpha": 0.8, "pad": 1.5},
    )
    text = (
        f"Longitud: {metrics['length_km']:.1f} km\n"
        f"Desnivel: +{metrics['elevation_gain_m']:.0f} m\n"
        f"Pendiente media: {metrics['mean_slope_deg']:.1f}°\n"
        f"Pendiente máxima: {metrics['max_slope_deg']:.1f}°\n"
        f"Transitabilidad media: {metrics['mean_traversability']:.2f}\n"
        f"Terreno tipo traverse: {100.0 * metrics['traverse_likeness']:.0f} %"
    )
    axis.text(
        0.02,
        0.98,
        text,
        transform=axis.transAxes,
        va="top",
        fontsize=9,
        color="white",
        bbox={"facecolor": "black", "alpha": 0.55, "pad": 6},
    )
    _finish(figure, path)


def plot_route_comparison(
    layers: dict,
    traversability: np.ndarray,
    meta: dict,
    learned_lonlat: np.ndarray,
    baseline_lonlat: np.ndarray,
    traverse_paths,
    start,
    goal,
    metrics: dict,
    baseline_metrics: dict,
    path: Path,
) -> None:
    extent = _extent(meta)
    shade = hillshade(layers["dem"], meta["dx_m"], meta["dy_m"])
    figure, axis = plt.subplots(figsize=(11, 11), constrained_layout=True)
    axis.imshow(traversability, extent=extent, origin="upper", cmap="RdYlGn", vmin=0, vmax=1, alpha=0.6)
    axis.imshow(shade, extent=extent, origin="upper", cmap="gray", alpha=0.35)
    points = np.asarray(traverse_paths[0])
    axis.plot(points[:, 0], points[:, 1], color="#0e7490", linewidth=1.3, linestyle=(0, (5, 3)), label="Recorrido real de Curiosity", zorder=4)
    axis.plot(baseline_lonlat[:, 0], baseline_lonlat[:, 1], color="white", linewidth=4.0, zorder=5)
    axis.plot(baseline_lonlat[:, 0], baseline_lonlat[:, 1], color="#a21caf", linewidth=2.2, linestyle="--", label="Solo pendiente (referencia)", zorder=6)
    axis.plot(learned_lonlat[:, 0], learned_lonlat[:, 1], color="white", linewidth=4.5, zorder=7)
    axis.plot(learned_lonlat[:, 0], learned_lonlat[:, 1], color="#f97316", linewidth=2.6, label="Modelo aprendido", zorder=8)
    axis.plot(start[0], start[1], marker="^", color="#22c55e", markersize=14, markeredgecolor="black", zorder=9, label="Inicio")
    axis.plot(goal[0], goal[1], marker="*", color="#e879f9", markersize=19, markeredgecolor="black", zorder=9, label="Objetivo")
    axis.set_xlim(extent[0], extent[1])
    axis.set_ylim(extent[2], extent[3])
    axis.set_xlabel("Longitud (°E)")
    axis.set_ylabel("Latitud (°N)")
    axis.set_title("Ruta aprendida frente a referencia solo-pendiente")
    axis.legend(loc="lower left", framealpha=0.85, fontsize=8.5)
    text = (
        f"Aprendida: {metrics['length_km']:.1f} km, transitabilidad {metrics['mean_traversability']:.2f}\n"
        f"Solo pendiente: {baseline_metrics['length_km']:.1f} km, transitabilidad {baseline_metrics['mean_traversability']:.2f}"
    )
    axis.text(
        0.02,
        0.98,
        text,
        transform=axis.transAxes,
        va="top",
        fontsize=9,
        color="black",
        bbox={"facecolor": "white", "alpha": 0.8, "pad": 6},
    )
    _finish(figure, path)


def plot_profile(layers: dict, meta: dict, cells: np.ndarray, path: Path) -> None:
    rows = cells[:, 0]
    columns = cells[:, 1]
    elevation = layers["dem"][rows, columns]
    delta = np.diff(cells.astype("float64"), axis=0)
    steps = np.hypot(delta[:, 0] * meta["dy_m"], delta[:, 1] * meta["dx_m"])
    distance = np.concatenate([[0.0], np.cumsum(steps)])
    slope = uniform_filter1d(layers["slope"][rows, columns].astype("float64"), 41)
    figure, axis = plt.subplots(figsize=(11, 4.5), constrained_layout=True)
    axis.plot(distance / 1000.0, elevation, color="#b45309", linewidth=1.8)
    axis.fill_between(distance / 1000.0, elevation.min(), elevation, color="#f59e0b", alpha=0.2)
    axis.set_xlabel("Distancia recorrida (km)")
    axis.set_ylabel("Elevación (m)", color="#b45309")
    axis.tick_params(axis="y", labelcolor="#b45309")
    second = axis.twinx()
    second.plot(distance / 1000.0, slope, color="#1d4ed8", linewidth=1.1, alpha=0.8)
    second.set_ylabel("Pendiente suavizada (°)", color="#1d4ed8")
    second.tick_params(axis="y", labelcolor="#1d4ed8")
    axis.set_title("Perfil topográfico de la ruta")
    axis.grid(alpha=0.25)
    _finish(figure, path)


def plot_perspective(layers: dict, meta: dict, route_lonlat: np.ndarray, path: Path) -> None:
    dem = _fill(layers["dem"])
    step = max(1, dem.shape[0] // 320)
    coarse = dem[::step, ::step]
    west, south, east, north = meta["bbox"]
    lon = np.linspace(west, east, coarse.shape[1])
    lat = np.linspace(north, south, coarse.shape[0])
    grid_lon, grid_lat = np.meshgrid(lon, lat)
    figure = plt.figure(figsize=(12, 8.5))
    axis = figure.add_subplot(111, projection="3d")
    axis.computed_zorder = False
    axis.plot_surface(
        grid_lon,
        grid_lat,
        coarse,
        cmap="gist_earth",
        linewidth=0,
        antialiased=True,
        rstride=1,
        cstride=1,
        alpha=0.95,
    )
    route_elevation = layers["dem"][
        np.clip(((north - route_lonlat[:, 1]) / (north - south) * layers["dem"].shape[0]).astype(int), 0, layers["dem"].shape[0] - 1),
        np.clip(((route_lonlat[:, 0] - west) / (east - west) * layers["dem"].shape[1]).astype(int), 0, layers["dem"].shape[1] - 1),
    ]
    axis.plot(route_lonlat[:, 0], route_lonlat[:, 1], route_elevation + 40.0, color="#f97316", linewidth=3.2, zorder=10)
    axis.scatter(route_lonlat[0, 0], route_lonlat[0, 1], route_elevation[0] + 40.0, color="#22c55e", s=90, depthshade=False, zorder=11)
    axis.scatter(route_lonlat[-1, 0], route_lonlat[-1, 1], route_elevation[-1] + 40.0, color="#e879f9", s=140, marker="*", depthshade=False, zorder=11)
    axis.set_xlabel("Longitud (°E)")
    axis.set_ylabel("Latitud (°N)")
    axis.set_zlabel("Elevación (m)")
    axis.set_box_aspect((1.0, 1.0, 0.45))
    axis.view_init(elev=42, azim=-122)
    axis.set_title("Vista 3D del terreno y la ruta")
    _finish(figure, path)


def plot_integrated(layers: dict, traversability: np.ndarray, meta: dict, path: Path) -> None:
    extent = _extent(meta)
    shade = hillshade(layers["dem"], meta["dx_m"], meta["dy_m"])
    optical = _stretch(layers["optical"], 2.0, 98.0)
    thermal = _stretch(layers["thermal"], 5.0, 95.0)
    base = np.clip(optical**1.4 * (0.6 + 0.4 * shade), 0.0, 1.0)
    figure, axes = plt.subplots(1, 2, figsize=(15, 7), constrained_layout=True)
    axes[0].imshow(base, extent=extent, origin="upper", cmap="gray", vmin=0, vmax=1)
    warm = axes[0].imshow(thermal, extent=extent, origin="upper", cmap="inferno", alpha=0.45)
    figure.colorbar(warm, ax=axes[0], shrink=0.75, label="térmico (escala relativa)")
    axes[0].set_title("Óptico + térmico superpuestos")
    second = axes[1].imshow(traversability, extent=extent, origin="upper", cmap="RdYlGn", vmin=0, vmax=1)
    axes[1].imshow(shade, extent=extent, origin="upper", cmap="gray", alpha=0.25)
    axes[1].set_title("Transitabilidad aprendida sobre relieve")
    figure.colorbar(second, ax=axes[1], shrink=0.75)
    for axis in axes:
        axis.set_xlabel("Longitud (°E)")
        axis.set_ylabel("Latitud (°N)")
    _finish(figure, path)


def plot_context(image: np.ndarray, bbox, study_bbox, path: Path) -> None:
    west, south, east, north = bbox
    figure, axis = plt.subplots(figsize=(9, 9), constrained_layout=True)
    axis.imshow(image, extent=[west, east, south, north], origin="upper")
    study_west, study_south, study_east, study_north = study_bbox
    axis.add_patch(
        Rectangle(
            (study_west, study_south),
            study_east - study_west,
            study_north - study_south,
            fill=False,
            edgecolor="#facc15",
            linewidth=2.0,
        )
    )
    axis.text(
        study_west,
        study_north + 0.02,
        "área de estudio",
        color="#facc15",
        fontsize=9,
        fontweight="bold",
    )
    axis.set_xlabel("Longitud (°E)")
    axis.set_ylabel("Latitud (°N)")
    axis.set_title("Contexto regional - Gale Crater y Mount Sharp")
    axis.grid(color="white", alpha=0.2, linewidth=0.5)
    _finish(figure, path)

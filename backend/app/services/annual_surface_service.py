"""
Servizio per il calcolo della superficie annuale potenza × ore × giorni.
Itera su 365 giorni × 24 ore riutilizzando la logica di solar_service.py.

Step 10 — aggregazione energy-weighted (Eq. 4.46, UNI/TS 11300-1):
Questo servizio calcola F_s(t) istantaneamente per ogni ora e lo moltiplica
per la POA(t) all'interno del loop orario. L'integrale su 8760 ore di
`power_actual(t) = power_ideal(t) · F_s(t)` è già, per costruzione, una
sintesi pesata energeticamente: equivale a usare
`annual_shading_pct_energy_weighted` di ShadowResponse al posto della media
temporale `annual_shading_pct_time_avg`. Non viene quindi consumato alcun
aggregato pre-calcolato da shadow_service: la correttezza energetica è
garantita dalla pipeline oraria stessa.
"""
import time as _time
import math
import logging
import calendar
from datetime import datetime

import numpy as np
import pandas as pd
import pvlib
import trimesh

from app.services.thermal import calc_temp_derating
from app.services.solar_service import _create_location, _get_tmy_data
from app.models.annual_surface import (
    AnnualSurfaceRequest,
    AnnualSurfaceResponse,
    DaySurfaceData,
    HourlySurfacePoint,
)

logger = logging.getLogger(__name__)


def compute_annual_surface(request: AnnualSurfaceRequest) -> AnnualSurfaceResponse:
    """Calcola potenza e irradianza per 365 giorni × 24 ore."""
    from app.services.shadow_service import create_scene

    t0 = _time.time()
    year = request.year
    location = _create_location(request.latitude, request.longitude, request.timezone)

    # ── Posizione solare per tutto l'anno (8760 ore) ──
    times = pd.date_range(
        start=f"{year}-01-01 00:00:00",
        end=f"{year}-12-31 23:00:00",
        freq="1h",
        tz=request.timezone,
    )
    solpos = location.get_solarposition(times)

    # ── Irradianza clear-sky ──
    clearsky = location.get_clearsky(times, model="ineichen")
    ghi_s, dni_s, dhi_s = clearsky["ghi"], clearsky["dni"], clearsky["dhi"]

    # ── TMY per temperatura ambiente ──
    tmy_hourly_temp = None
    tmy_data = _get_tmy_data(request.latitude, request.longitude)
    if tmy_data is not None:
        tmy_tz = (
            tmy_data.index.tz_convert(request.timezone)
            if tmy_data.index.tz
            else tmy_data.index.tz_localize("UTC").tz_convert(request.timezone)
        )
        tmy_reindexed = tmy_data.set_index(tmy_tz)
        tmy_reindexed = tmy_reindexed[~tmy_reindexed.index.duplicated(keep="first")]
        # Remap anno TMY → anno simulazione
        new_idx = tmy_reindexed.index.map(lambda ts: ts.replace(year=year))
        tmy_reindexed = tmy_reindexed.set_index(pd.DatetimeIndex(new_idx))
        tmy_reindexed = tmy_reindexed[~tmy_reindexed.index.duplicated(keep="first")]
        tmy_reindexed = tmy_reindexed.sort_index()
        tmy_hourly_temp = tmy_reindexed["temp_air"].reindex(times, method="nearest")

    # ── POA irradianza ──
    dni_extra = pvlib.irradiance.get_extra_radiation(times)
    panel_groups = getattr(request, "panel_groups", None)

    if panel_groups and len(panel_groups) > 1:
        n_total = sum(g.count for g in panel_groups)
        poa_global = None
        for grp in panel_groups:
            poa_grp = pvlib.irradiance.get_total_irradiance(
                surface_tilt=grp.tilt,
                surface_azimuth=grp.azimuth,
                dni=dni_s, ghi=ghi_s, dhi=dhi_s,
                solar_zenith=solpos["apparent_zenith"],
                solar_azimuth=solpos["azimuth"],
                model="perez", dni_extra=dni_extra,
            )
            weighted = poa_grp["poa_global"].fillna(0.0).clip(lower=0) * (grp.count / n_total)
            poa_global = weighted if poa_global is None else poa_global + weighted
    else:
        tilt_val = panel_groups[0].tilt if panel_groups and len(panel_groups) == 1 else request.tilt
        az_val = panel_groups[0].azimuth if panel_groups and len(panel_groups) == 1 else request.panel_azimuth
        poa = pvlib.irradiance.get_total_irradiance(
            surface_tilt=tilt_val,
            surface_azimuth=az_val,
            dni=dni_s, ghi=ghi_s, dhi=dhi_s,
            solar_zenith=solpos["apparent_zenith"],
            solar_azimuth=solpos["azimuth"],
            model="perez", dni_extra=dni_extra,
        )
        poa_global = poa["poa_global"].fillna(0.0).clip(lower=0)

    # ── Pannelli e scene 3D per ombre ──
    n_panels = max(len(request.panels), 1)
    total_power_stc = n_panels * request.panel_power_w
    noct = request.noct_temperature
    system_loss_factor = 1.0 - request.system_losses

    has_panel_positions = len(request.panels) > 0 and any(
        "x" in p and "z" in p for p in request.panels
    )
    scene_mesh = None
    obstacle_mesh = None
    panel_centers = None
    canopy_meshes = []
    opaque_obstacle_mesh = None
    canopy_concat = None

    if has_panel_positions:
        scene, building_mesh, _shadow_mesh, canopy_meshes, _obstacle_meshes = create_scene(
            request.building, request.obstacles,
            model_offset_y=getattr(request, "model_offset_y", 0.0),
        )
        scene_mesh = trimesh.util.concatenate(scene.geometry.values())

        obstacle_geoms = list(scene.geometry.values())[1:]
        canopy_geom_ids = set(id(cm["mesh"]) for cm in canopy_meshes)
        opaque_obs_geoms = [g for g in obstacle_geoms if id(g) not in canopy_geom_ids]
        opaque_obstacle_mesh = trimesh.util.concatenate(opaque_obs_geoms) if opaque_obs_geoms else None
        canopy_concat = trimesh.util.concatenate([cm["mesh"] for cm in canopy_meshes]) if canopy_meshes else None
        obstacle_mesh = trimesh.util.concatenate(obstacle_geoms) if obstacle_geoms else None

        panel_centers = []
        for p in request.panels:
            cx, cy, cz = p.get("x", 0), p.get("y", 0), p.get("z", 0)
            if abs(cy) < 0.01:
                ray_origin = np.array([[cx, building_mesh.bounds[1][1] + 10.0, cz]])
                ray_dir = np.array([[0, -1, 0]])
                locs, _, _ = building_mesh.ray.intersects_location(
                    ray_origins=ray_origin, ray_directions=ray_dir,
                )
                if len(locs) > 0:
                    cy = float(np.max(locs[:, 1]))
            panel_centers.append([cx, cy, cz])
        panel_centers = np.array(panel_centers)

    building_rot = np.radians(-request.building_azimuth)
    cos_r, sin_r = np.cos(building_rot), np.sin(building_rot)

    # ── T_AMB fallback (stima media annua → overridden per mese nel loop) ──
    T_AMB_base = 15.0
    if request.ambient_temperature is not None:
        T_AMB_base = request.ambient_temperature
        tmy_hourly_temp = None

    # ── Loop su 365 giorni × 24 ore ──
    days_result = []
    max_power_w = 0.0
    max_poa = 0.0

    # Converto poa_global e solpos a numpy per accesso veloce
    poa_values = poa_global.values
    elevations = solpos["apparent_elevation"].values
    azimuths = solpos["azimuth"].values
    temp_values = tmy_hourly_temp.values if tmy_hourly_temp is not None else None

    # Numero giorni nell'anno
    n_days = 366 if calendar.isleap(year) else 365

    # Mapping (day_of_year_0based, hour) → indice in times array.
    # Gestisce correttamente DST: il giorno spring-forward ha 23 timestamp,
    # il giorno fall-back ne ha 25 (l'ora duplicata viene sovrascritta).
    day_hour_to_idx = {}
    for i, ts in enumerate(times):
        doy = ts.timetuple().tm_yday - 1  # 0-based
        day_hour_to_idx[(doy, ts.hour)] = i

    for day_idx in range(n_days):
        dt = datetime(year, 1, 1) + pd.Timedelta(days=day_idx)
        month = dt.month
        date_str = dt.strftime("%Y-%m-%d")

        # Stima T_AMB stagionale se nessun override e nessun TMY
        T_AMB = T_AMB_base if request.ambient_temperature is not None else 15.0 + 10.0 * math.sin((month - 4) * math.pi / 6)

        hours_data = []
        for h in range(24):
            ts_idx = day_hour_to_idx.get((day_idx, h))
            if ts_idx is None or ts_idx >= len(poa_values):
                hours_data.append(HourlySurfacePoint(
                    power_w=0.0, power_ideal_w=0.0, power_clearsky_w=0.0, poa_global=0.0,
                ))
                continue

            elev = float(elevations[ts_idx])
            azi = float(azimuths[ts_idx])
            poa_val = float(poa_values[ts_idx])

            if elev <= 2 or poa_val <= 0:
                hours_data.append(HourlySurfacePoint(
                    power_w=0.0, power_ideal_w=0.0, power_clearsky_w=0.0, poa_global=0.0,
                ))
                continue

            # Temperatura ambiente
            t_amb = float(temp_values[ts_idx]) if temp_values is not None and ts_idx < len(temp_values) else T_AMB
            T_cell = t_amb + (noct - 20.0) * (poa_val / 800.0)
            temp_derating = calc_temp_derating(request.temp_coefficient, T_cell)

            power_clearsky = total_power_stc * (poa_val / 1000.0)
            power_ideal = power_clearsky * temp_derating

            # Ombre
            shading_factor = 1.0
            if has_panel_positions and scene_mesh is not None:
                az_rad = np.radians(azi)
                el_rad = np.radians(elev)
                sun_x = np.cos(el_rad) * np.sin(az_rad)
                sun_y = np.sin(el_rad)
                sun_z = -np.cos(el_rad) * np.cos(az_rad)

                if abs(building_rot) > 1e-6:
                    rx = sun_x * cos_r - sun_z * sin_r
                    rz = sun_x * sin_r + sun_z * cos_r
                    sun_vec = np.array([rx, sun_y, rz])
                else:
                    sun_vec = np.array([sun_x, sun_y, sun_z])

                vertical_offset = np.array([0, 0.3, 0])
                ray_origins = panel_centers + vertical_offset
                ray_dirs = np.tile(sun_vec, (len(panel_centers), 1))

                if canopy_concat is not None and len(canopy_meshes) > 0:
                    opaque_hits = (
                        opaque_obstacle_mesh.ray.intersects_any(ray_origins=ray_origins, ray_directions=ray_dirs)
                        if opaque_obstacle_mesh is not None
                        else np.zeros(len(panel_centers), dtype=bool)
                    )
                    not_opaque = ~opaque_hits
                    canopy_check_idx = np.where(not_opaque)[0]
                    if len(canopy_check_idx) > 0:
                        canopy_hits = canopy_concat.ray.intersects_any(
                            ray_origins=ray_origins[canopy_check_idx],
                            ray_directions=ray_dirs[canopy_check_idx],
                        )
                        month_transmissivity = float(
                            np.mean([cm["transmissivity"][month - 1] for cm in canopy_meshes])
                        )
                        factors = np.ones(len(panel_centers))
                        factors[opaque_hits] = 0.0
                        factors[canopy_check_idx[canopy_hits]] = month_transmissivity
                        shading_factor = float(np.mean(factors))
                    else:
                        shading_factor = float(np.mean(~opaque_hits))
                else:
                    ray_target = obstacle_mesh if obstacle_mesh is not None else scene_mesh
                    hits = ray_target.ray.intersects_any(
                        ray_origins=ray_origins, ray_directions=ray_dirs,
                    )
                    shading_factor = float(np.mean(~hits))

            power_actual = power_ideal * shading_factor * system_loss_factor

            if power_actual > max_power_w:
                max_power_w = power_actual
            if poa_val > max_poa:
                max_poa = poa_val

            hours_data.append(HourlySurfacePoint(
                power_w=round(power_actual, 1),
                power_ideal_w=round(power_ideal, 1),
                power_clearsky_w=round(power_clearsky, 1),
                poa_global=round(poa_val, 1),
            ))

        days_result.append(DaySurfaceData(
            day_of_year=day_idx + 1,
            date=date_str,
            hours=hours_data,
        ))

    computation_time = round(_time.time() - t0, 2)
    logger.info(f"Annual surface computed in {computation_time}s ({n_days} days)")

    return AnnualSurfaceResponse(
        days=days_result,
        max_power_w=round(max_power_w, 1),
        max_poa=round(max_poa, 1),
        computation_time_s=computation_time,
    )

import pandas as pd
import pvlib
from app.services.thermal import calc_temp_derating
from app.models.solar import (
    SunPathRequest, SunPathResponse,
    IrradianceRequest, IrradianceResponse, SurfaceIrradiance,
    DailySimulationRequest, DailySimulationResponse, HourlyDataPoint,
    EconomicsRequest, EconomicsResponse, MonthlyEconomicsData, HourlyAnalysis,
)
from datetime import datetime
import calendar
import logging
import math
import numpy as np
import trimesh


def _create_location(latitude: float, longitude: float, timezone: str) -> pvlib.location.Location:
    """Create a pvlib Location object."""
    return pvlib.location.Location(latitude=latitude, longitude=longitude, tz=timezone)

logger = logging.getLogger(__name__)

# Cache TMY in-memory: chiave = (lat_arrotondato, lon_arrotondato) → dati TMY
_tmy_cache: dict[tuple[float, float], pd.DataFrame] = {}


def _get_tmy_data(latitude: float, longitude: float) -> pd.DataFrame | None:
    """
    Fetch dati TMY (Typical Meteorological Year) da PVGIS API.
    Ritorna DataFrame con colonne: ghi, dni, dhi, temp_air, wind_speed.
    Cache in-memory per coordinate arrotondate a 1 decimale.
    Ritorna None se il fetch fallisce (fallback a clearsky).
    """
    # Arrotonda a 1 decimale per cache hit più probabili
    cache_key = (round(latitude, 1), round(longitude, 1))

    if cache_key in _tmy_cache:
        return _tmy_cache[cache_key]

    try:
        tmy_data, _, _, _ = pvlib.iotools.get_pvgis_tmy(
            latitude, longitude, map_variables=True
        )
        _tmy_cache[cache_key] = tmy_data
        logger.info(f"TMY data fetched from PVGIS for ({latitude}, {longitude})")
        return tmy_data
    except Exception as e:
        logger.warning(f"PVGIS TMY fetch failed for ({latitude}, {longitude}): {e}. Falling back to clearsky.")
        return None

def calculate_sun_path(request: SunPathRequest) -> SunPathResponse:
    """
    Calcola il percorso solare per una data località e anno.
    Restituisce serie temporali orarie di azimuth, elevazione e zenith.
    Filtra le ore notturne (elevazione <= 0).
    """
    
    # 1. Creazione Location object
    location = _create_location(request.latitude, request.longitude, request.timezone)

    # 2. Generazione range temporale (orario per tutto l'anno)
    start_date = f"{request.year}-01-01 00:00:00"
    end_date = f"{request.year}-12-31 23:59:00"
    
    times = pd.date_range(
        start=start_date,
        end=end_date,
        freq='1h',
        tz=request.timezone
    )
    
    # 3. Calcolo posizione solare
    solpos = location.get_solarposition(times)
    
    # 4. Filtro ore diurne (elevation > 0)
    daylight_mask = solpos['apparent_elevation'] > 0
    daylight_solpos = solpos[daylight_mask]
    
    # 5. Preparazione risposta
    # Convertiamo l'index (DatetimeIndex) in lista di stringhe ISO format
    timestamps = daylight_solpos.index.strftime('%Y-%m-%dT%H:%M:%S%z').tolist()
    
    return SunPathResponse(
        timestamps=timestamps,
        azimuth=daylight_solpos['azimuth'].tolist(),
        elevation=daylight_solpos['apparent_elevation'].tolist(), # Uso apparent_elevation per rifrazione atmosferica
        zenith=daylight_solpos['zenith'].tolist()
    )

def calculate_irradiance(request: IrradianceRequest) -> IrradianceResponse:
    """
    Calcola l'irradianza solare su un piano inclinato (POA) usando dati TMY da PVGIS
    (con fallback a clearsky). Restituisce serie temporali e totali aggregati.
    """

    # 1. Creazione Location object
    location = _create_location(request.latitude, request.longitude, request.timezone)

    # 2. Tentativo di usare dati TMY da PVGIS (dati meteo reali satellitari)
    tmy_data = _get_tmy_data(request.latitude, request.longitude)

    if tmy_data is not None:
        # TMY disponibile: usa dati meteo reali
        # TMY ha anni diversi per mesi diversi → normalizziamo a un anno singolo
        tmy_local = tmy_data.index.tz_convert(request.timezone) if tmy_data.index.tz else tmy_data.index.tz_localize('UTC').tz_convert(request.timezone)
        # Riscriviamo l'anno a request.year mantenendo mese/giorno/ora
        normalized_index = tmy_local.map(
            lambda ts: ts.replace(year=request.year)
        )
        times = pd.DatetimeIndex(normalized_index)
        # Remove duplicate timestamps from DST transitions in TMY data
        dup_mask = times.duplicated(keep='first')
        if dup_mask.any():
            times = times[~dup_mask]
            tmy_data = tmy_data.iloc[~dup_mask]
        solpos = location.get_solarposition(times)

        ghi_s = pd.Series(tmy_data['ghi'].values, index=times, name='ghi')
        dni_s = pd.Series(tmy_data['dni'].values, index=times, name='dni')
        dhi_s = pd.Series(tmy_data['dhi'].values, index=times, name='dhi')
    else:
        # Fallback: clearsky (sovrastima ~10-15%)
        start_date = f"{request.year}-01-01 00:00:00"
        end_date = f"{request.year}-12-31 23:59:00"
        times = pd.date_range(start=start_date, end=end_date, freq='1h', tz=request.timezone)
        solpos = location.get_solarposition(times)
        clearsky = location.get_clearsky(times)
        ghi_s = clearsky['ghi']
        dni_s = clearsky['dni']
        dhi_s = clearsky['dhi']

    # 3. Calcolo Irradianza POA (Plane of Array) — modello Perez
    dni_extra = pvlib.irradiance.get_extra_radiation(times)

    per_surface_data = None
    if request.roof_surfaces:
        # Multi-superficie: calcola POA per ogni falda, media pesata + breakdown per-falda
        poa_global_weighted = None
        poa_direct_weighted = None
        poa_diffuse_weighted = None
        per_surface_data = []
        for surf in request.roof_surfaces:
            poa_i = pvlib.irradiance.get_total_irradiance(
                surface_tilt=surf.tilt,
                surface_azimuth=surf.azimuth,
                dni=dni_s, ghi=ghi_s, dhi=dhi_s,
                solar_zenith=solpos['apparent_zenith'],
                solar_azimuth=solpos['azimuth'],
                model='perez', dni_extra=dni_extra,
            )
            poa_g_raw = poa_i['poa_global'].fillna(0).clip(lower=0)
            # Irradianza annua per questa superficie (kWh/m²)
            surf_annual = round(float(poa_g_raw.sum() / 1000.0), 2)
            per_surface_data.append(SurfaceIrradiance(
                face=surf.face or f"tilt{surf.tilt}_az{surf.azimuth}",
                tilt=surf.tilt,
                azimuth=surf.azimuth,
                annual_total=surf_annual,
            ))
            g = poa_g_raw * surf.weight
            d = poa_i['poa_direct'].fillna(0).clip(lower=0) * surf.weight
            f = poa_i['poa_diffuse'].fillna(0).clip(lower=0) * surf.weight
            if poa_global_weighted is None:
                poa_global_weighted, poa_direct_weighted, poa_diffuse_weighted = g, d, f
            else:
                poa_global_weighted += g
                poa_direct_weighted += d
                poa_diffuse_weighted += f
        poa_irradiance = pd.DataFrame({
            'poa_global': poa_global_weighted,
            'poa_direct': poa_direct_weighted,
            'poa_diffuse': poa_diffuse_weighted,
        })
    else:
        poa_irradiance = pvlib.irradiance.get_total_irradiance(
            surface_tilt=request.tilt,
            surface_azimuth=request.azimuth,
            dni=dni_s,
            ghi=ghi_s,
            dhi=dhi_s,
            solar_zenith=solpos['apparent_zenith'],
            solar_azimuth=solpos['azimuth'],
            model='perez',
            dni_extra=dni_extra,
        )

    # 4. Aggregazione dati
    # Totali mensili (W/m² * 1h = Wh/m² -> /1000 = kWh/m²)
    monthly_series = poa_irradiance['poa_global'].clip(lower=0).resample('ME').sum() / 1000.0

    monthly_totals = {
        date.strftime('%B'): round(val, 2)
        for date, val in monthly_series.items()
    }

    annual_total = round(monthly_series.sum(), 2)

    # 5. Preparazione risposta
    timestamps = poa_irradiance.index.strftime('%Y-%m-%dT%H:%M:%S%z').tolist()

    poa_global = poa_irradiance['poa_global'].fillna(0.0).clip(lower=0).tolist()
    poa_direct = poa_irradiance['poa_direct'].fillna(0.0).clip(lower=0).tolist()
    poa_diffuse = poa_irradiance['poa_diffuse'].fillna(0.0).clip(lower=0).tolist()

    return IrradianceResponse(
        timestamps=timestamps,
        poa_global=poa_global,
        poa_direct=poa_direct,
        poa_diffuse=poa_diffuse,
        monthly_totals=monthly_totals,
        annual_total=annual_total,
        per_surface=per_surface_data,
    )


def calculate_daily_simulation(request: DailySimulationRequest) -> DailySimulationResponse:
    """
    Simula la produzione energetica per un giorno intero con step di 30 minuti.
    Per ogni step calcola: posizione solare, irradianza POA, ombre sui pannelli, potenza.
    """
    import time as _time
    _t0 = _time.time()

    from app.services.shadow_service import create_scene

    # Clamp giorno al massimo del mese
    year = getattr(request, 'year', datetime.now().year)
    max_day = calendar.monthrange(year, request.month)[1]
    day = min(request.day, max_day)
    sim_date = datetime(year, request.month, day)
    date_str = sim_date.strftime("%Y-%m-%d")

    location = _create_location(request.latitude, request.longitude, request.timezone)

    # Time range: intero giorno con step 30 min
    times = pd.date_range(
        start=sim_date,
        end=sim_date.replace(hour=23, minute=30),
        freq="30min",
        tz=request.timezone,
    )

    # Posizione solare
    solpos = location.get_solarposition(times)

    # Filtro ore diurne (elevazione > 2°)
    daylight_mask = solpos["apparent_elevation"] > 2
    daylight_solpos = solpos[daylight_mask]

    if daylight_solpos.empty:
        return DailySimulationResponse(
            date=date_str, hourly=[], daily_kwh=0, daily_kwh_ideal=0,
            daily_kwh_clearsky=0, peak_power_w=0, sunshine_hours=0,
            computation_time_s=round(_time.time() - _t0, 2),
        )

    # Irradianza clear-sky (Ineichen) — potenziale teorico massimo senza nuvole
    # Questo permette un confronto diretto tra il potenziale del sito e le perdite
    # dovute esclusivamente a ombre locali e de-rating termico.
    clearsky = location.get_clearsky(times, model='ineichen')
    ghi_s, dni_s, dhi_s = clearsky["ghi"], clearsky["dni"], clearsky["dhi"]

    # Temperatura ambiente: usa TMY se disponibile per de-rating termico realistico
    tmy_hourly_temp = None
    tmy_data = _get_tmy_data(request.latitude, request.longitude)
    if tmy_data is not None:
        tmy_tz = tmy_data.index.tz_convert(request.timezone) if tmy_data.index.tz else tmy_data.index.tz_localize('UTC').tz_convert(request.timezone)
        tmy_reindexed = tmy_data.set_index(tmy_tz)
        # Remove duplicate index entries (can occur from DST transitions in TMY data)
        tmy_reindexed = tmy_reindexed[~tmy_reindexed.index.duplicated(keep='first')]
        day_mask = (tmy_reindexed.index.month == request.month) & (tmy_reindexed.index.day == day)
        tmy_day = tmy_reindexed[day_mask]
        if len(tmy_day) > 0:
            tmy_day = tmy_day.copy()
            tmy_day.index = tmy_day.index.map(lambda ts: ts.replace(year=year))
            tmy_day = tmy_day[~tmy_day.index.duplicated(keep='first')]
            tmy_hourly_temp = tmy_day['temp_air'].reindex(times, method='nearest')

    dni_extra = pvlib.irradiance.get_extra_radiation(times)

    # Numero totale pannelli e area
    n_panels = len(request.panels)
    if n_panels == 0:
        n_panels = 1  # fallback: 1 pannello virtuale

    total_power_stc = n_panels * request.panel_power_w  # W @ STC (1000 W/m²)

    # Calcolo POA: per-falda se panel_groups è presente, altrimenti singolo tilt/azimuth
    panel_groups = getattr(request, 'panel_groups', None)
    if panel_groups and len(panel_groups) > 1:
        # POA pesata per-falda: ogni gruppo contribuisce proporzionalmente al numero di pannelli
        n_total_groups = sum(g.count for g in panel_groups)
        poa_global = None
        for grp in panel_groups:
            poa_grp = pvlib.irradiance.get_total_irradiance(
                surface_tilt=grp.tilt,
                surface_azimuth=grp.azimuth,
                dni=dni_s, ghi=ghi_s, dhi=dhi_s,
                solar_zenith=solpos["apparent_zenith"],
                solar_azimuth=solpos["azimuth"],
                model="perez",
                dni_extra=dni_extra,
            )
            weighted = poa_grp["poa_global"].fillna(0.0).clip(lower=0) * (grp.count / n_total_groups)
            poa_global = weighted if poa_global is None else poa_global + weighted
    else:
        # Singolo tilt/azimuth (retrocompatibilità)
        tilt_val = panel_groups[0].tilt if panel_groups and len(panel_groups) == 1 else request.tilt
        az_val = panel_groups[0].azimuth if panel_groups and len(panel_groups) == 1 else request.panel_azimuth
        poa = pvlib.irradiance.get_total_irradiance(
            surface_tilt=tilt_val,
            surface_azimuth=az_val,
            dni=dni_s, ghi=ghi_s, dhi=dhi_s,
            solar_zenith=solpos["apparent_zenith"],
            solar_azimuth=solpos["azimuth"],
            model="perez",
            dni_extra=dni_extra,
        )
        poa_global = poa["poa_global"].fillna(0.0).clip(lower=0)

    # Parametri correzione termica
    noct = request.noct_temperature

    # Temperatura ambiente: override manuale > TMY reale > stima stagionale
    # T_AMB è sempre definito come fallback per timestamp mancanti nel TMY
    T_AMB = 15.0 + 10.0 * math.sin((request.month - 4) * math.pi / 6)
    if request.ambient_temperature is not None:
        T_AMB = request.ambient_temperature
        tmy_hourly_temp = None  # forza costante se override esplicito

    # Fattore perdite di sistema BOS (inverter, cablaggio, soiling, mismatch)
    system_loss_factor = 1.0 - request.system_losses

    # --- Shadow calculation setup (solo se ci sono pannelli con posizione) ---
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
            model_offset_y=getattr(request, 'model_offset_y', 0.0)
        )
        scene_mesh = trimesh.util.concatenate(scene.geometry.values())

        # Costruisci mesh separate: opache (no chiome) e chiome (trasmissività)
        obstacle_geoms = list(scene.geometry.values())[1:]  # skip building
        canopy_geom_ids = set(id(cm['mesh']) for cm in canopy_meshes)
        opaque_obs_geoms = [g for g in obstacle_geoms if id(g) not in canopy_geom_ids]
        opaque_obstacle_mesh = trimesh.util.concatenate(opaque_obs_geoms) if opaque_obs_geoms else None
        canopy_concat = trimesh.util.concatenate([cm['mesh'] for cm in canopy_meshes]) if canopy_meshes else None
        # Mantieni obstacle_mesh per retrocompatibilità
        obstacle_mesh = trimesh.util.concatenate(obstacle_geoms) if obstacle_geoms else None

        # Centri pannelli (nel sistema locale dell'edificio)
        # Se y=0, proietta sulla superficie del tetto tramite raycast
        panel_centers = []
        for p in request.panels:
            cx = p.get("x", 0)
            cy = p.get("y", 0)
            cz = p.get("z", 0)

            # Se y ≈ 0, proietta dall'alto verso il tetto per trovare l'altezza corretta
            if abs(cy) < 0.01:
                ray_origin = np.array([[cx, building_mesh.bounds[1][1] + 10.0, cz]])
                ray_dir = np.array([[0, -1, 0]])
                locs, _, _ = building_mesh.ray.intersects_location(
                    ray_origins=ray_origin, ray_directions=ray_dir
                )
                if len(locs) > 0:
                    cy = float(np.max(locs[:, 1]))  # punto più alto del tetto

            panel_centers.append([cx, cy, cz])
        panel_centers = np.array(panel_centers)

    # Rotazione vettori solari per compensare azimuth edificio
    # building_azimuth dal frontend include già model_rotation (= project.azimuth + modelRotationY),
    # quindi NON sommare model_rotation di nuovo (era contato 2 volte).
    building_rot = np.radians(-request.building_azimuth)
    cos_r = np.cos(building_rot)
    sin_r = np.sin(building_rot)

    # --- Loop su ogni step temporale ---
    hourly_data = []
    total_energy_wh = 0.0
    total_energy_ideal_wh = 0.0
    total_energy_clearsky_wh = 0.0
    peak_power = 0.0
    step_hours = 0.5  # 30 minuti
    total_weighted_temp_loss = 0.0
    total_poa_weight = 0.0

    for ts in daylight_solpos.index:
        elev = daylight_solpos.loc[ts, "apparent_elevation"]
        azi = daylight_solpos.loc[ts, "azimuth"]
        poa_val = float(poa_global.get(ts, 0.0))
        time_str = ts.strftime("%H:%M")

        if poa_val <= 0:
            continue

        # Correzione termica: temperatura cella secondo modello NOCT
        # Usa temperatura oraria TMY se disponibile, altrimenti T_AMB costante
        t_amb = float(tmy_hourly_temp.get(ts, T_AMB)) if tmy_hourly_temp is not None else T_AMB
        T_cell = t_amb + (noct - 20.0) * (poa_val / 800.0)
        temp_derating = calc_temp_derating(request.temp_coefficient, T_cell)
        temp_loss = (1.0 - temp_derating) * 100.0

        # Potenza teorica clear-sky (senza ombre, senza perdite termiche): potenziale massimo del sito
        power_clearsky = total_power_stc * (poa_val / 1000.0)
        # Potenza ideale (senza ombre, con correzione termica)
        power_ideal = power_clearsky * temp_derating

        # Accumulo perdita termica ponderata sull'irradianza
        total_weighted_temp_loss += temp_loss * poa_val
        total_poa_weight += poa_val

        # Calcolo ombreggiatura per ogni pannello
        shading_factor = 1.0  # 1.0 = nessuna ombra
        if has_panel_positions and scene_mesh is not None:
            # Vettore sole nel sistema locale
            az_rad = np.radians(azi)
            el_rad = np.radians(elev)
            sun_x = np.cos(el_rad) * np.sin(az_rad)
            sun_y = np.sin(el_rad)
            sun_z = -np.cos(el_rad) * np.cos(az_rad)

            # Ruota nel sistema locale edificio
            if abs(building_rot) > 1e-6:
                rx = sun_x * cos_r - sun_z * sin_r
                rz = sun_x * sin_r + sun_z * cos_r
                sun_vec = np.array([rx, sun_y, rz])
            else:
                sun_vec = np.array([sun_x, sun_y, sun_z])

            # Ray-cast da ogni centro pannello verso il sole.
            # Offset verticale (+Y) di 0.3m per evitare auto-intersezione col tetto.
            # Usiamo obstacle_mesh se disponibile (esclude il tetto),
            # altrimenti scene_mesh con offset maggiore.
            vertical_offset = np.array([0, 0.3, 0])
            ray_origins = panel_centers + vertical_offset
            ray_dirs = np.tile(sun_vec, (len(panel_centers), 1))

            # Two-pass: ostacoli opachi, poi chiome con trasmissività
            if canopy_concat is not None and len(canopy_meshes) > 0:
                # Pass 1: geometria opaca (tronchi + altri ostacoli)
                opaque_hits = opaque_obstacle_mesh.ray.intersects_any(
                    ray_origins=ray_origins, ray_directions=ray_dirs
                ) if opaque_obstacle_mesh is not None else np.zeros(len(panel_centers), dtype=bool)

                # Pass 2: chiome per i raggi non bloccati
                not_opaque = ~opaque_hits
                canopy_check_idx = np.where(not_opaque)[0]

                if len(canopy_check_idx) > 0:
                    canopy_hits = canopy_concat.ray.intersects_any(
                        ray_origins=ray_origins[canopy_check_idx],
                        ray_directions=ray_dirs[canopy_check_idx]
                    )
                    month_transmissivity = float(np.mean([
                        cm['transmissivity'][request.month - 1] for cm in canopy_meshes
                    ]))
                    # Per-pannello: 1.0 (libero), transmissivity (chioma), 0.0 (opaco)
                    factors = np.ones(len(panel_centers))
                    factors[opaque_hits] = 0.0
                    factors[canopy_check_idx[canopy_hits]] = month_transmissivity
                    shading_factor = float(np.mean(factors))
                else:
                    shading_factor = float(np.mean(~opaque_hits))
            else:
                # Nessuna chioma: logica binaria originale
                ray_target = obstacle_mesh if obstacle_mesh is not None else scene_mesh
                hits = ray_target.ray.intersects_any(
                    ray_origins=ray_origins,
                    ray_directions=ray_dirs,
                )
                shading_factor = float(np.mean(~hits))

        power_actual = power_ideal * shading_factor * system_loss_factor
        shading_loss = (1.0 - shading_factor) * 100.0

        peak_power = max(peak_power, power_actual)
        total_energy_wh += power_actual * step_hours
        total_energy_ideal_wh += power_ideal * step_hours
        total_energy_clearsky_wh += power_clearsky * step_hours

        hourly_data.append(HourlyDataPoint(
            time=time_str,
            solar_elevation=round(elev, 1),
            solar_azimuth=round(azi, 1),
            poa_global=round(poa_val, 1),
            power_w=round(power_actual, 1),
            power_ideal_w=round(power_ideal, 1),
            power_clearsky_w=round(power_clearsky, 1),
            shading_loss_pct=round(shading_loss, 1),
            temp_loss_pct=round(temp_loss, 1),
        ))

    daily_kwh = round(total_energy_wh / 1000.0, 3)
    daily_kwh_ideal = round(total_energy_ideal_wh / 1000.0, 3)
    daily_kwh_clearsky = round(total_energy_clearsky_wh / 1000.0, 3)
    sunshine_hours = len(hourly_data) * step_hours
    daily_temp_loss_pct = round(total_weighted_temp_loss / total_poa_weight, 1) if total_poa_weight > 0 else 0.0

    return DailySimulationResponse(
        date=date_str,
        hourly=hourly_data,
        daily_kwh=daily_kwh,
        daily_kwh_ideal=daily_kwh_ideal,
        daily_kwh_clearsky=daily_kwh_clearsky,
        peak_power_w=round(peak_power, 1),
        sunshine_hours=round(sunshine_hours, 1),
        daily_temp_loss_pct=daily_temp_loss_pct,
        computation_time_s=round(_time.time() - _t0, 2),
    )


# ─── Economics ─────────────────────────────────────────────

# Coefficienti distribuzione consumo mensile residenziale italiano (fonte ENEA)
_CONSUMPTION_DISTRIBUTION = [0.10, 0.09, 0.08, 0.07, 0.07, 0.07, 0.07, 0.06, 0.08, 0.09, 0.10, 0.12]
_MONTH_NAMES_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
                   'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

# Ore di luce diurna tipiche per mese (latitudine ~42°N, Italia centrale)
_DAYLIGHT_HOURS = [9, 10, 12, 13, 14, 15, 15, 14, 12, 11, 10, 9]

# Giorni per mese (anno non bisestile)
_DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

# Indice della prima ora di ogni mese nelle 8760 ore annue
_MONTH_HOUR_OFFSETS = []
_offset = 0
for _d in _DAYS_PER_MONTH:
    _MONTH_HOUR_OFFSETS.append(_offset)
    _offset += _d * 24


def _hourly_economics_for_month(
    month_idx: int,
    monthly_production: float,
    hourly_consumption: list[float],
) -> tuple[float, float, float, float]:
    """Calcola autoconsumo ora per ora per un mese, distribuendo la produzione
    sulle ore diurne centrali del mese."""
    days = _DAYS_PER_MONTH[month_idx]
    daylight = _DAYLIGHT_HOURS[month_idx]
    total_daylight_hours = days * daylight
    production_per_hour = monthly_production / total_daylight_hours if total_daylight_hours > 0 else 0.0

    # Ore diurne centrali: centrate a mezzogiorno (12:00)
    sunrise_hour = 12 - daylight // 2
    sunset_hour = sunrise_hour + daylight

    start = _MONTH_HOUR_OFFSETS[month_idx]
    end = start + days * 24

    month_consumption = 0.0
    month_self_consumed = 0.0
    month_fed_in = 0.0

    for d in range(days):
        for h in range(24):
            idx = start + d * 24 + h
            if idx >= len(hourly_consumption):
                break
            cons = hourly_consumption[idx]
            prod = production_per_hour if sunrise_hour <= h < sunset_hour else 0.0
            month_consumption += cons
            month_self_consumed += min(prod, cons)
            month_fed_in += max(0.0, prod - cons)

    month_grid = max(0.0, month_consumption - month_self_consumed)
    return month_consumption, month_self_consumed, month_fed_in, month_grid


_MONTH_NAMES_IT_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu',
                         'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']


def _compute_hourly_analysis(hourly_data: list[float], year: int = 2025) -> HourlyAnalysis:
    """Calcola statistiche aggregate dal profilo di consumo orario (8760 valori)."""
    arr = np.array(hourly_data)
    total = float(arr.sum())
    n_days = 365

    avg_daily = total / n_days
    avg_hourly = total / 8760
    peak_kw = float(arr.max())
    peak_idx = int(arr.argmax())
    base_load = float(np.percentile(arr, 10))
    peak_ratio = peak_kw / avg_hourly if avg_hourly > 0 else 0.0

    # Label leggibile per il picco
    peak_day = peak_idx // 24
    peak_hour = peak_idx % 24
    from datetime import datetime as _dt, timedelta as _td
    peak_date = _dt(year, 1, 1) + _td(days=peak_day)
    peak_label = f"{peak_date.day} {_MONTH_NAMES_IT_SHORT[peak_date.month - 1]}, ore {peak_hour:02d}:00"

    # Profilo giornaliero medio (24 valori)
    daily_profile = [float(arr[h::24].mean()) for h in range(24)]

    # Profilo settimanale medio (7 valori, Lun=0)
    jan1_weekday = _dt(year, 1, 1).weekday()  # 0=Lun
    week_sums = [0.0] * 7
    week_counts = [0] * 7
    for d in range(n_days):
        dow = (jan1_weekday + d) % 7
        day_total = float(arr[d * 24:(d + 1) * 24].sum())
        week_sums[dow] += day_total
        week_counts[dow] += 1
    weekly_profile = [round(week_sums[d] / week_counts[d], 2) if week_counts[d] > 0 else 0.0 for d in range(7)]

    # Totali mensili (12 valori)
    monthly_totals = []
    for m in range(12):
        start = _MONTH_HOUR_OFFSETS[m]
        end = start + _DAYS_PER_MONTH[m] * 24
        monthly_totals.append(round(float(arr[start:end].sum()), 1))

    # Totali giornalieri (365 valori)
    daily_totals = [round(float(arr[d * 24:(d + 1) * 24].sum()), 2) for d in range(n_days)]

    return HourlyAnalysis(
        avg_daily_kwh=round(avg_daily, 2),
        avg_hourly_kwh=round(avg_hourly, 3),
        peak_hourly_kw=round(peak_kw, 3),
        peak_hour_index=peak_idx,
        peak_hour_label=peak_label,
        base_load_kw=round(base_load, 3),
        peak_to_avg_ratio=round(peak_ratio, 1),
        daily_profile=[round(v, 3) for v in daily_profile],
        weekly_profile=weekly_profile,
        monthly_totals=monthly_totals,
        daily_totals=daily_totals,
    )


def calculate_economics(request: EconomicsRequest) -> EconomicsResponse:
    """
    Calcola l'analisi economica autoconsumo vs immissione in rete.
    Supporta 3 modalità di consumo:
    - hourly_consumption_kwh (8760 valori): calcolo autoconsumo ora per ora
    - monthly_consumption_kwh (12 valori): consumo mensile diretto
    - annual_consumption_kwh (singolo float): distribuzione ENEA
    """
    monthly_data = []
    total_self_consumed = 0.0
    total_fed_in = 0.0
    total_savings = 0.0
    total_revenue = 0.0
    total_production = 0.0

    use_hourly = request.hourly_consumption_kwh is not None
    use_monthly = request.monthly_consumption_kwh is not None

    for i in range(12):
        production = request.monthly_production_kwh[i]

        if use_hourly:
            consumption, self_consumed, fed_in, grid_consumed = _hourly_economics_for_month(
                i, production, request.hourly_consumption_kwh,
            )
        else:
            if use_monthly:
                consumption = request.monthly_consumption_kwh[i]
            else:
                consumption = request.annual_consumption_kwh * _CONSUMPTION_DISTRIBUTION[i]
            self_consumed = min(production, consumption)
            fed_in = max(0.0, production - consumption)
            grid_consumed = max(0.0, consumption - production)

        savings = self_consumed * request.energy_price_eur
        revenue = fed_in * request.feed_in_tariff_eur

        total_production += production
        total_self_consumed += self_consumed
        total_fed_in += fed_in
        total_savings += savings
        total_revenue += revenue

        monthly_data.append(MonthlyEconomicsData(
            month=i + 1,
            month_name=_MONTH_NAMES_IT[i],
            production_kwh=round(production, 1),
            consumption_kwh=round(consumption, 1),
            self_consumed_kwh=round(self_consumed, 1),
            fed_in_kwh=round(fed_in, 1),
            grid_consumed_kwh=round(grid_consumed, 1),
            savings_eur=round(savings, 2),
            revenue_eur=round(revenue, 2),
        ))

    self_consumption_rate = (total_self_consumed / total_production * 100) if total_production > 0 else 0
    self_sufficiency_rate = (total_self_consumed / request.annual_consumption_kwh * 100) if request.annual_consumption_kwh > 0 else 0

    payback = None
    annual_benefit = total_savings + total_revenue
    if request.system_cost_eur is not None and annual_benefit > 0:
        payback = round(request.system_cost_eur / annual_benefit, 1)

    hourly_analysis = None
    if use_hourly:
        hourly_analysis = _compute_hourly_analysis(request.hourly_consumption_kwh)

    return EconomicsResponse(
        monthly=monthly_data,
        total_production_kwh=round(total_production, 1),
        total_self_consumed_kwh=round(total_self_consumed, 1),
        total_fed_in_kwh=round(total_fed_in, 1),
        total_savings_eur=round(total_savings, 2),
        total_revenue_eur=round(total_revenue, 2),
        self_consumption_rate_pct=round(self_consumption_rate, 1),
        self_sufficiency_rate_pct=round(self_sufficiency_rate, 1),
        payback_years=payback,
        annual_consumption_kwh=round(request.annual_consumption_kwh, 1),
        hourly_analysis=hourly_analysis,
    )

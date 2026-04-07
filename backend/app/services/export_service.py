"""
Servizio di export risultati simulazione solare.
Genera file CSV e PDF con i dati della simulazione.
Report PDF professionale a più pagine con copertina, grafici, analisi economica.
"""

import io
import csv
import math
from datetime import datetime
from typing import Optional

# Distribuzione mensile tipica per latitudine ~42°N (Italia centrale)
MONTHLY_DISTRIBUTION = [0.050, 0.060, 0.085, 0.095, 0.110, 0.120,
                        0.125, 0.115, 0.095, 0.075, 0.045, 0.025]

MONTH_NAMES = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
               "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"]

MONTH_NAMES_EN = ["January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December"]

MONTHLY_SUN_HOURS = [4.5, 5.5, 6.5, 7.5, 9.0, 10.5, 11.0, 10.0, 8.0, 6.5, 5.0, 4.0]


def _fmt(value: str) -> str:
    """Converte il separatore decimale da punto a virgola per formato italiano."""
    return value.replace('.', ',')

# Colori PDF
COLOR_ACCENT = "#4F9CF9"
COLOR_SOLAR = "#FFB547"
COLOR_TEAL = "#2DD4BF"
COLOR_VIOLET = "#A78BFA"
COLOR_TEXT = "#1A2235"
COLOR_TEXT_LIGHT = "#64748b"
COLOR_ALT_ROW = "#E2E8F5"
COLOR_HEADER = "#4F9CF9"
COLOR_BORDER = "#CBD5E1"
COLOR_BG_LIGHT = "#F1F5F9"
COLOR_BG_DARK = "#0F172A"

# Colori per stringhe (diversi per ogni stringa nel layout)
STRING_COLORS = ["#4F9CF9", "#FFB547", "#2DD4BF", "#A78BFA", "#F87171",
                 "#34D399", "#F59E0B", "#818CF8", "#FB923C", "#22D3EE"]

ROOF_TYPE_LABELS = {
    "flat": "Piano",
    "gable": "A due falde",
    "hip": "A padiglione",
}


def generate_hourly_csv(params: dict) -> str:
    """Genera un CSV con dati orari per l'intero anno (8760 righe).

    Usa vectorizzazione pvlib per performance ottimali.
    """
    import pandas as pd
    import pvlib
    import numpy as np
    from app.services.solar_service import _get_tmy_data

    latitude = params["latitude"]
    longitude = params["longitude"]
    tilt = params["tilt"]
    azimuth = params["azimuth"]
    timezone = params.get("timezone", "Europe/Rome")
    panel_power_w = params.get("panel_power_w", 400)
    temp_coefficient = params.get("temp_coefficient", -0.4)
    num_panels = params.get("num_panels", 1)
    system_losses = params.get("system_losses", 0.14)
    noct = params.get("noct_temperature", 45.0)
    year = params.get("year", 2024)

    total_power_stc = num_panels * panel_power_w  # W

    location = pvlib.location.Location(latitude=latitude, longitude=longitude, tz=timezone)

    # Genera DatetimeIndex annuale orario
    times = pd.date_range(
        start=f"{year}-01-01 00:00:00",
        end=f"{year}-12-31 23:00:00",
        freq="1h",
        tz=timezone,
    )

    # Posizione solare vectorizzata
    solpos = location.get_solarposition(times)

    # Irradianza: TMY se disponibile, altrimenti clearsky
    tmy_data = _get_tmy_data(latitude, longitude)
    if tmy_data is not None:
        tmy_tz = tmy_data.index.tz_convert(timezone) if tmy_data.index.tz else tmy_data.index.tz_localize("UTC").tz_convert(timezone)
        normalized_index = tmy_tz.map(lambda ts: ts.replace(year=year))
        tmy_times = pd.DatetimeIndex(normalized_index)
        # Rimuovi duplicati (possibili dal replace year su mesi con anni TMY diversi)
        tmy_df = pd.DataFrame({
            "ghi": tmy_data["ghi"].values,
            "dni": tmy_data["dni"].values,
            "dhi": tmy_data["dhi"].values,
            "temp_air": tmy_data["temp_air"].values,
        }, index=tmy_times)
        tmy_df = tmy_df[~tmy_df.index.duplicated(keep="first")].sort_index()
        ghi = tmy_df["ghi"].reindex(times, method="nearest").fillna(0)
        dni = tmy_df["dni"].reindex(times, method="nearest").fillna(0)
        dhi = tmy_df["dhi"].reindex(times, method="nearest").fillna(0)
        temp_air = tmy_df["temp_air"].reindex(times, method="nearest").fillna(15.0)
    else:
        clearsky = location.get_clearsky(times, model="ineichen")
        ghi = clearsky["ghi"]
        dni = clearsky["dni"]
        dhi = clearsky["dhi"]
        # Stima temperatura stagionale
        months = times.month
        temp_air = pd.Series(15.0 + 10.0 * np.sin((months - 4) * np.pi / 6), index=times)

    # POA irradianza vectorizzata (Perez)
    dni_extra = pvlib.irradiance.get_extra_radiation(times)

    # Per-falda: se panel_groups è presente con >1 gruppo, calcolo POA pesata
    panel_groups = params.get("panel_groups")
    if panel_groups and len(panel_groups) > 1:
        n_total_groups = sum(g["count"] for g in panel_groups)
        poa_global = None
        for grp in panel_groups:
            poa_grp = pvlib.irradiance.get_total_irradiance(
                surface_tilt=grp["tilt"],
                surface_azimuth=grp["azimuth"],
                dni=dni, ghi=ghi, dhi=dhi,
                solar_zenith=solpos["apparent_zenith"],
                solar_azimuth=solpos["azimuth"],
                model="perez",
                dni_extra=dni_extra,
            )
            weighted = poa_grp["poa_global"].fillna(0.0).clip(lower=0) * (grp["count"] / n_total_groups)
            poa_global = weighted if poa_global is None else poa_global + weighted
    else:
        # Singolo tilt/azimuth o un solo gruppo
        t = panel_groups[0]["tilt"] if panel_groups and len(panel_groups) == 1 else tilt
        a = panel_groups[0]["azimuth"] if panel_groups and len(panel_groups) == 1 else azimuth
        poa = pvlib.irradiance.get_total_irradiance(
            surface_tilt=t,
            surface_azimuth=a,
            dni=dni, ghi=ghi, dhi=dhi,
            solar_zenith=solpos["apparent_zenith"],
            solar_azimuth=solpos["azimuth"],
            model="perez",
            dni_extra=dni_extra,
        )
        poa_global = poa["poa_global"].fillna(0.0).clip(lower=0)

    # Temperatura cella NOCT e de-rating termico vectorizzati
    t_cell = temp_air + (noct - 20.0) * (poa_global / 800.0)
    temp_coeff_per_c = temp_coefficient / 100.0
    temp_derating = (1.0 + temp_coeff_per_c * (t_cell - 25.0)).clip(0.5, 1.0)

    # Potenza prodotta
    system_factor = 1.0 - system_losses
    power_w = total_power_stc * (poa_global / 1000.0) * temp_derating * system_factor
    # Zero nelle ore notturne
    night_mask = solpos["apparent_elevation"] <= 0
    power_w[night_mask] = 0.0

    energy_kwh = power_w / 1000.0  # Wh → kWh (step = 1h)

    # Fattore efficienza inverter
    inverter_efficiency_pct = params.get("inverter_efficiency_pct", 100.0)
    inverter_factor = inverter_efficiency_pct / 100.0
    inverter_model = params.get("inverter_model", "")
    inverter_power_kw = params.get("inverter_power_kw", 0.0)

    power_ac_w = power_w * inverter_factor
    energy_ac_kwh = power_ac_w / 1000.0

    # Scala i dati orari affinché il totale annuo corrisponda a annual_energy_kwh
    # (che include le perdite per ombreggiamento calcolate nella simulazione).
    target_annual = params.get("annual_energy_kwh")
    scale_factor = None
    if target_annual is not None and target_annual > 0:
        computed_annual = float(energy_ac_kwh.sum())
        if computed_annual > 0:
            scale_factor = target_annual / computed_annual
            power_w = power_w * scale_factor
            energy_kwh = power_w / 1000.0
            power_ac_w = power_ac_w * scale_factor
            energy_ac_kwh = power_ac_w / 1000.0

    # Genera CSV (formato italiano: delimitatore ; e decimale ,)
    output = io.StringIO()
    writer = csv.writer(output, delimiter=';')

    # Header con info inverter (se disponibile)
    writer.writerow(["SolarOptimizer3D - Dati Orari Annuali"])
    writer.writerow([f"Anno: {year}"])
    writer.writerow([f"Coordinate: {latitude}N {longitude}E  |  Tilt: {tilt}°  Azimuth: {azimuth}°"])
    writer.writerow([f"Pannelli: {num_panels}  |  Potenza unitaria: {panel_power_w} W"])
    if inverter_model:
        writer.writerow([f"Inverter: {inverter_model}"
                         + (f" ({_fmt(f'{inverter_power_kw:.1f}')} kW eff. {_fmt(f'{inverter_efficiency_pct:.1f}')}%)"
                            if inverter_power_kw > 0 else f" (eff. {_fmt(f'{inverter_efficiency_pct:.1f}')}%)")])
    if scale_factor is not None:
        writer.writerow([f"Energia annua simulazione (con ombre): {_fmt(f'{target_annual:.1f}')} kWh"
                         f"  |  Fattore correzione ombre: {_fmt(f'{scale_factor:.4f}')}"])

    hourly_consumption = params.get("hourly_consumption_kwh")
    if hourly_consumption is not None:
        annual_cons = sum(hourly_consumption)
        writer.writerow([f"Consumo annuale caricato: {_fmt(f'{annual_cons:.1f}')} kWh"])

    writer.writerow([])

    header = [
        "Timestamp", "Solar_Elevation_deg", "Solar_Azimuth_deg",
        "GHI_W_m2", "POA_Global_W_m2", "Temp_Air_C", "Temp_Cell_C",
        "Temp_Derating", "Power_DC_W", "Energy_DC_kWh",
        "Power_AC_W", "Energy_AC_kWh",
    ]
    if hourly_consumption is not None:
        header.append("Consumption_Wh")
    writer.writerow(header)

    elevations = solpos["apparent_elevation"]
    azimuths = solpos["azimuth"]

    for i, ts in enumerate(times):
        elev = elevations.iloc[i]
        azi = azimuths.iloc[i]
        row = [
            ts.strftime("%Y-%m-%d %H:%M"),
            _fmt(f"{elev:.1f}"),
            _fmt(f"{azi:.1f}"),
            _fmt(f"{ghi.iloc[i]:.1f}"),
            _fmt(f"{poa_global.iloc[i]:.1f}"),
            _fmt(f"{temp_air.iloc[i]:.1f}"),
            _fmt(f"{t_cell.iloc[i]:.1f}"),
            _fmt(f"{temp_derating.iloc[i]:.4f}"),
            _fmt(f"{power_w.iloc[i]:.1f}"),
            _fmt(f"{energy_kwh.iloc[i]:.4f}"),
            _fmt(f"{power_ac_w.iloc[i]:.1f}"),
            _fmt(f"{energy_ac_kwh.iloc[i]:.4f}"),
        ]
        if hourly_consumption is not None:
            row.append(_fmt(f"{hourly_consumption[i] * 1000:.1f}"))
        writer.writerow(row)

    output.seek(0)
    return output.getvalue()


def generate_csv(data: dict) -> str:
    """Genera un report CSV con i risultati della simulazione.

    Accetta un dict con campi da simulation_results, project_info e opzionalmente
    inverter_specs, stringing e economic.
    """
    output = io.StringIO()
    writer = csv.writer(output, delimiter=';')

    annual_irradiance = data.get("annual_irradiance", 1700)
    annual_energy = data.get("annual_energy_kwh", 0)
    peak_power_kw = data.get("peak_power_kw", 0)
    num_panels = data.get("num_panels", 0)
    latitude = data.get("latitude", 0)
    longitude = data.get("longitude", 0)
    tilt = data.get("tilt", 0)
    azimuth = data.get("azimuth", 0)

    inverter = data.get("inverter_specs")
    stringing = data.get("stringing")
    economic = data.get("economic")

    writer.writerow(["SolarOptimizer3D - Report Simulazione"])
    writer.writerow([f"Data: {datetime.now().strftime('%Y-%m-%d %H:%M')}"])
    writer.writerow([f"Coordinate: {latitude}N {longitude}E"])
    writer.writerow([f"Tilt: {tilt} Azimuth: {azimuth}"])
    writer.writerow([f"Pannelli: {num_panels} Potenza: {_fmt(f'{peak_power_kw:.2f}')} kWp"])
    writer.writerow([])

    # Sezione Inverter (condizionale)
    if inverter and inverter.get("model"):
        writer.writerow(["--- Inverter ---"])
        writer.writerow(["Costruttore", inverter.get("constructor", "")])
        writer.writerow(["Modello", inverter.get("model", "")])
        inv_power = inverter.get("power_kw", 0)
        writer.writerow(["Potenza AC", f"{_fmt(f'{inv_power:.2f}')} kW"])
        if inverter.get("mppt_voltage_min_v") and inverter.get("mppt_voltage_max_v"):
            writer.writerow(["Range MPPT",
                             f"{inverter['mppt_voltage_min_v']:.0f}–{inverter['mppt_voltage_max_v']:.0f} V"])
        writer.writerow(["Efficienza", _fmt(f"{inverter.get('efficiency_pct', 0):.1f}%")])
        writer.writerow([])

    # Sezione Configurazione Stringhe (condizionale)
    if stringing and stringing.get("panels_per_string", 0) > 0:
        writer.writerow(["--- Configurazione Stringhe ---"])
        writer.writerow(["Pannelli/stringa", stringing.get("panels_per_string", 0)])
        writer.writerow(["Stringhe/MPPT", stringing.get("strings_per_mppt", 0)])
        writer.writerow(["MPPT utilizzati", stringing.get("mppt_used", 0)])
        writer.writerow(["Voc max", _fmt(f"{stringing.get('voc_max_v', 0):.1f}") + " V"])
        writer.writerow(["Rapporto DC/AC", _fmt(f"{stringing.get('dc_ac_ratio', 0):.2f}")])
        writer.writerow([])

    # Sezione Dati Economici (condizionale)
    if economic and economic.get("energy_price_kwh", 0) > 0:
        writer.writerow(["--- Dati Economici ---"])
        writer.writerow(["Prezzo energia", _fmt(f"{economic.get('energy_price_kwh', 0):.3f}") + " EUR/kWh"])
        writer.writerow(["Autoconsumo", f"{economic.get('self_consumption_pct', 0):.0f}%"])
        writer.writerow([])

    # Tabella mensile
    # NB: annual_energy include già tutte le perdite (BOS + inverter),
    # calcolate dal frontend tramite computeTotalLosses().
    header = ["Mese", "Irradianza_kWh_m2", "Produzione_kWh", "Ore_sole"]
    writer.writerow(header)

    total_irr = 0
    total_prod = 0
    total_hours = 0

    for i, month_name in enumerate(MONTH_NAMES):
        month_irr = annual_irradiance * MONTHLY_DISTRIBUTION[i]
        month_prod = annual_energy * MONTHLY_DISTRIBUTION[i]
        sun_hours = MONTHLY_SUN_HOURS[i]

        row = [month_name, _fmt(f"{month_irr:.1f}"), _fmt(f"{month_prod:.1f}"), _fmt(f"{sun_hours:.1f}")]
        writer.writerow(row)

        total_irr += month_irr
        total_prod += month_prod
        total_hours += sun_hours

    writer.writerow([])
    writer.writerow(["TOTALE ANNUO", _fmt(f"{total_irr:.1f}"), _fmt(f"{total_prod:.1f}"), _fmt(f"{total_hours:.1f}")])

    output.seek(0)
    return output.getvalue()


# ════════════════════════════════════════════════════════════════════
# HELPER PDF
# ════════════════════════════════════════════════════════════════════

def _make_table_style(header_color: str, alt_row: bool = True):
    """Crea uno stile tabella standard con header colorato e righe alternate."""
    from reportlab.lib.colors import HexColor
    style_commands = [
        ("BACKGROUND", (0, 0), (-1, 0), HexColor(header_color)),
        ("TEXTCOLOR", (0, 0), (-1, 0), HexColor("#ffffff")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor(COLOR_BORDER)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]
    if alt_row:
        style_commands.append(
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor(COLOR_ALT_ROW)])
        )
    return style_commands


def _draw_header_footer(canvas, doc, gen_date: str):
    """Header e footer su ogni pagina."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor

    page_w, page_h = A4
    canvas.saveState()

    # Header: linea sottile + testo piccolo
    header_y = page_h - 12 * mm
    canvas.setStrokeColor(HexColor(COLOR_ACCENT))
    canvas.setLineWidth(0.5)
    canvas.line(20 * mm, header_y, page_w - 20 * mm, header_y)
    canvas.setFont("Helvetica-Bold", 7)
    canvas.setFillColor(HexColor(COLOR_ACCENT))
    canvas.drawString(20 * mm, header_y + 2 * mm, "SolarOptimizer3D")
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(HexColor(COLOR_TEXT_LIGHT))
    canvas.drawRightString(page_w - 20 * mm, header_y + 2 * mm,
                           "Relazione Tecnica Impianto Fotovoltaico")

    # Footer
    footer_y = 10 * mm
    canvas.setStrokeColor(HexColor(COLOR_BORDER))
    canvas.line(20 * mm, footer_y + 4 * mm, page_w - 20 * mm, footer_y + 4 * mm)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(HexColor("#94a3b8"))
    canvas.drawString(20 * mm, footer_y,
                      f"Generato con SolarOptimizer3D \u00b7 {gen_date}")
    canvas.drawRightString(page_w - 20 * mm, footer_y,
                           f"Pagina {doc.page}")

    canvas.restoreState()


def _draw_kpi_box(canvas, x, y, w, h, label, value, unit, color):
    """Disegna un singolo riquadro KPI con sfondo colorato."""
    from reportlab.lib.colors import HexColor
    from reportlab.lib.units import mm

    # Sfondo
    canvas.setFillColor(HexColor(color))
    canvas.setStrokeColor(HexColor(color))
    canvas.setLineWidth(0)
    canvas.roundRect(x, y, w, h, 3 * mm, fill=1, stroke=0)

    # Sfondo interno semi-trasparente
    canvas.setFillColor(HexColor("#ffffff"))
    canvas.setFillAlpha(0.15)
    canvas.roundRect(x, y, w, h, 3 * mm, fill=1, stroke=0)
    canvas.setFillAlpha(1.0)

    # Valore
    canvas.setFont("Helvetica-Bold", 16)
    canvas.setFillColor(HexColor("#ffffff"))
    canvas.drawCentredString(x + w / 2, y + h - 18, value)

    # Unità
    canvas.setFont("Helvetica", 9)
    canvas.setFillColor(HexColor("#ffffff"))
    canvas.setFillAlpha(0.85)
    canvas.drawCentredString(x + w / 2, y + h - 28, unit)
    canvas.setFillAlpha(1.0)

    # Label
    canvas.setFont("Helvetica-Bold", 8)
    canvas.setFillColor(HexColor("#ffffff"))
    canvas.setFillAlpha(0.9)
    canvas.drawCentredString(x + w / 2, y + 4, label)
    canvas.setFillAlpha(1.0)


def _build_production_chart(annual_energy: float, monthly_irradiance: dict = None):
    """Grafico a barre verticali produzione mensile con colori gradiente."""
    from reportlab.graphics.shapes import Drawing, String, Rect
    from reportlab.graphics.charts.barcharts import VerticalBarChart
    from reportlab.lib.colors import HexColor, linearlyInterpolatedColor
    from reportlab.lib.units import mm

    drawing = Drawing(170 * mm, 110 * mm)

    chart = VerticalBarChart()
    chart.x = 25 * mm
    chart.y = 15 * mm
    chart.width = 135 * mm
    chart.height = 80 * mm

    values = [annual_energy * d for d in MONTHLY_DISTRIBUTION]
    chart.data = [values]
    chart.categoryAxis.categoryNames = [m[:3] for m in MONTH_NAMES]
    chart.categoryAxis.labels.fontSize = 7
    chart.categoryAxis.labels.fillColor = HexColor(COLOR_TEXT)
    chart.valueAxis.labels.fontSize = 7
    chart.valueAxis.labels.fillColor = HexColor(COLOR_TEXT)
    chart.valueAxis.valueMin = 0
    chart.valueAxis.forceZero = 1
    chart.barWidth = 8 * mm

    # Colore gradiente dal blu all'arancione in base al valore
    color_cold = HexColor(COLOR_ACCENT)
    color_hot = HexColor(COLOR_SOLAR)
    max_val = max(values) if values and max(values) > 0 else 1
    for i, v in enumerate(values):
        ratio = v / max_val
        c = linearlyInterpolatedColor(color_cold, color_hot, 0, 1, ratio)
        chart.bars[0].fillColor = c  # fallback
    # ReportLab VerticalBarChart non supporta colori per-barra nativamente,
    # usiamo il colore medio
    chart.bars[0].fillColor = HexColor(COLOR_ACCENT)
    chart.bars[0].strokeColor = HexColor("#3B7FD9")
    chart.bars[0].strokeWidth = 0.5

    drawing.add(chart)

    title = String(85 * mm, 100 * mm, "Produzione Mensile Stimata (kWh)")
    title.fontSize = 10
    title.fillColor = HexColor(COLOR_TEXT)
    title.textAnchor = "middle"
    title.fontName = "Helvetica-Bold"
    drawing.add(title)

    return drawing


def _build_irradiance_chart(monthly_irradiance: dict):
    """Grafico a barre orizzontali irradianza mensile."""
    from reportlab.graphics.shapes import Drawing, String
    from reportlab.graphics.charts.barcharts import HorizontalBarChart
    from reportlab.lib.colors import HexColor
    from reportlab.lib.units import mm

    drawing = Drawing(170 * mm, 110 * mm)

    chart = HorizontalBarChart()
    chart.x = 30 * mm
    chart.y = 10 * mm
    chart.width = 130 * mm
    chart.height = 90 * mm

    values = []
    labels = []
    for i, month_en in enumerate(MONTH_NAMES_EN):
        val = monthly_irradiance.get(month_en, 0)
        values.append(val)
        labels.append(MONTH_NAMES[i][:3])

    chart.data = [list(reversed(values))]
    chart.categoryAxis.categoryNames = list(reversed(labels))
    chart.categoryAxis.labels.fontSize = 8
    chart.categoryAxis.labels.fillColor = HexColor(COLOR_TEXT)
    chart.valueAxis.labels.fontSize = 7
    chart.valueAxis.labels.fillColor = HexColor(COLOR_TEXT)
    chart.valueAxis.valueMin = 0
    chart.valueAxis.forceZero = 1
    chart.bars[0].fillColor = HexColor(COLOR_SOLAR)
    chart.bars[0].strokeColor = HexColor("#E09B30")
    chart.bars[0].strokeWidth = 0.5
    chart.barWidth = 5 * mm

    drawing.add(chart)

    title = String(85 * mm, 103 * mm, "Irradianza Mensile POA (kWh/m\u00b2)")
    title.fontSize = 10
    title.fillColor = HexColor(COLOR_TEXT)
    title.textAnchor = "middle"
    title.fontName = "Helvetica-Bold"
    drawing.add(title)

    return drawing


def _build_layout_drawing(panels_layout: list, building_width: float,
                          building_depth: float, panel_specs: dict,
                          stringing: dict = None):
    """Schema tecnico layout pannelli con numerazione, freccia Nord, stringhe colorate."""
    from reportlab.graphics.shapes import Drawing, Rect, String, Line, Group, Polygon
    from reportlab.lib.colors import HexColor
    from reportlab.lib.units import mm

    draw_w = 170 * mm
    draw_h = 150 * mm
    drawing = Drawing(draw_w, draw_h)

    margin = 15 * mm
    avail_w = draw_w - 2 * margin
    avail_h = draw_h - 2 * margin - 20 * mm

    if building_width <= 0 or building_depth <= 0:
        return drawing

    scale_x = avail_w / building_width
    scale_y = avail_h / building_depth
    scale = min(scale_x, scale_y)

    roof_w = building_width * scale
    roof_h = building_depth * scale
    offset_x = margin + (avail_w - roof_w) / 2
    offset_y = margin + (avail_h - roof_h) / 2

    # Perimetro tetto
    roof_rect = Rect(offset_x, offset_y, roof_w, roof_h)
    roof_rect.fillColor = HexColor(COLOR_BG_LIGHT)
    roof_rect.strokeColor = HexColor(COLOR_TEXT)
    roof_rect.strokeWidth = 1.5
    drawing.add(roof_rect)

    # Dimensioni pannello
    pw = panel_specs.get("width", 1.0) if panel_specs else 1.0
    ph = panel_specs.get("height", 1.7) if panel_specs else 1.7

    # Determina stringhe per colori
    has_strings = any(p.get("string_id") is not None for p in panels_layout)

    # Disegna pannelli con numerazione
    for idx, p in enumerate(panels_layout):
        px = p.get("x", 0)
        pz = p.get("z", 0)
        orient = p.get("orientation", "portrait")
        string_id = p.get("string_id")

        if orient == "landscape":
            w, h = ph * scale, pw * scale
        else:
            w, h = pw * scale, ph * scale

        sx = offset_x + (px + building_width / 2) * scale - w / 2
        sy = offset_y + roof_h - (pz + building_depth / 2) * scale - h / 2

        # Colore per stringa
        if has_strings and string_id is not None:
            color = STRING_COLORS[string_id % len(STRING_COLORS)]
        else:
            color = COLOR_ACCENT

        panel_rect = Rect(sx, sy, w, h)
        panel_rect.fillColor = HexColor(color)
        panel_rect.fillOpacity = 0.7
        panel_rect.strokeColor = HexColor(COLOR_TEXT)
        panel_rect.strokeWidth = 0.5
        drawing.add(panel_rect)

        # Numero pannello (solo se leggibile)
        if w > 6 and h > 6:
            num_str = String(sx + w / 2, sy + h / 2 - 3, str(idx + 1))
            num_str.fontSize = max(4, min(7, int(min(w, h) / 3)))
            num_str.fillColor = HexColor("#ffffff")
            num_str.textAnchor = "middle"
            num_str.fontName = "Helvetica-Bold"
            drawing.add(num_str)

    # Freccia Nord (in alto a destra)
    arrow_x = offset_x + roof_w + 10 * mm
    arrow_y = offset_y + roof_h - 5 * mm
    arrow_len = 15 * mm

    arrow_line = Line(arrow_x, arrow_y - arrow_len, arrow_x, arrow_y)
    arrow_line.strokeColor = HexColor(COLOR_TEXT)
    arrow_line.strokeWidth = 1.5
    drawing.add(arrow_line)

    # Punta freccia
    arrow_head = Polygon(points=[
        arrow_x, arrow_y + 2,
        arrow_x - 3, arrow_y - 4,
        arrow_x + 3, arrow_y - 4,
    ])
    arrow_head.fillColor = HexColor(COLOR_TEXT)
    arrow_head.strokeColor = HexColor(COLOR_TEXT)
    drawing.add(arrow_head)

    n_label = String(arrow_x, arrow_y + 4, "N")
    n_label.fontSize = 9
    n_label.fillColor = HexColor(COLOR_TEXT)
    n_label.textAnchor = "middle"
    n_label.fontName = "Helvetica-Bold"
    drawing.add(n_label)

    # Quote dimensionali
    dim_y = offset_y - 8 * mm
    drawing.add(Line(offset_x, dim_y, offset_x + roof_w, dim_y,
                     strokeColor=HexColor(COLOR_TEXT), strokeWidth=0.5))
    # Tacche
    drawing.add(Line(offset_x, dim_y - 2, offset_x, dim_y + 2,
                     strokeColor=HexColor(COLOR_TEXT), strokeWidth=0.5))
    drawing.add(Line(offset_x + roof_w, dim_y - 2, offset_x + roof_w, dim_y + 2,
                     strokeColor=HexColor(COLOR_TEXT), strokeWidth=0.5))
    dim_label = String(offset_x + roof_w / 2, dim_y - 4 * mm,
                       f"{building_width:.1f} m")
    dim_label.fontSize = 8
    dim_label.fillColor = HexColor(COLOR_TEXT)
    dim_label.textAnchor = "middle"
    drawing.add(dim_label)

    # Profondità a sinistra
    dim_x = offset_x - 8 * mm
    drawing.add(Line(dim_x, offset_y, dim_x, offset_y + roof_h,
                     strokeColor=HexColor(COLOR_TEXT), strokeWidth=0.5))
    drawing.add(Line(dim_x - 2, offset_y, dim_x + 2, offset_y,
                     strokeColor=HexColor(COLOR_TEXT), strokeWidth=0.5))
    drawing.add(Line(dim_x - 2, offset_y + roof_h, dim_x + 2, offset_y + roof_h,
                     strokeColor=HexColor(COLOR_TEXT), strokeWidth=0.5))
    dim_label2 = String(0, 0, f"{building_depth:.1f} m")
    dim_label2.fontSize = 8
    dim_label2.fillColor = HexColor(COLOR_TEXT)
    dim_label2.textAnchor = "middle"
    g = Group(dim_label2, transform=(0, 1, -1, 0, dim_x - 4 * mm, offset_y + roof_h / 2))
    drawing.add(g)

    # Titolo
    title = String(draw_w / 2, draw_h - 8 * mm, "Schema Tecnico Layout Pannelli")
    title.fontSize = 10
    title.fillColor = HexColor(COLOR_TEXT)
    title.textAnchor = "middle"
    title.fontName = "Helvetica-Bold"
    drawing.add(title)

    # Legenda
    legend_y = offset_y - 18 * mm
    if has_strings:
        # Legenda per stringhe
        string_ids = sorted(set(p.get("string_id", 0) for p in panels_layout if p.get("string_id") is not None))
        lx = offset_x
        for sid in string_ids[:6]:  # max 6 stringhe in legenda
            c = STRING_COLORS[sid % len(STRING_COLORS)]
            leg_rect = Rect(lx, legend_y, 8, 8)
            leg_rect.fillColor = HexColor(c)
            leg_rect.fillOpacity = 0.7
            leg_rect.strokeWidth = 0.5
            leg_rect.strokeColor = HexColor(COLOR_TEXT)
            drawing.add(leg_rect)
            leg_label = String(lx + 11, legend_y + 1, f"Stringa {sid + 1}")
            leg_label.fontSize = 7
            leg_label.fillColor = HexColor(COLOR_TEXT)
            drawing.add(leg_label)
            lx += 35 * mm
    else:
        leg_rect = Rect(offset_x, legend_y, 8, 8)
        leg_rect.fillColor = HexColor(COLOR_ACCENT)
        leg_rect.fillOpacity = 0.7
        leg_rect.strokeColor = HexColor(COLOR_TEXT)
        leg_rect.strokeWidth = 0.5
        drawing.add(leg_rect)
        leg_label = String(offset_x + 12, legend_y + 1,
                           f"Pannello ({pw:.2f} x {ph:.2f} m)")
        leg_label.fontSize = 7
        leg_label.fillColor = HexColor(COLOR_TEXT)
        drawing.add(leg_label)

    return drawing


def _build_cashflow_chart(years_data: list):
    """Grafico flusso di cassa cumulato su 25 anni."""
    from reportlab.graphics.shapes import Drawing, String, Line
    from reportlab.graphics.charts.lineplots import LinePlot
    from reportlab.graphics.widgets.markers import makeMarker
    from reportlab.lib.colors import HexColor
    from reportlab.lib.units import mm

    drawing = Drawing(170 * mm, 100 * mm)

    chart = LinePlot()
    chart.x = 25 * mm
    chart.y = 15 * mm
    chart.width = 135 * mm
    chart.height = 70 * mm

    data_points = [(d["year"], d["cumulative"]) for d in years_data]
    chart.data = [data_points]

    chart.lines[0].strokeColor = HexColor(COLOR_TEAL)
    chart.lines[0].strokeWidth = 2
    chart.lines[0].symbol = makeMarker("Circle")
    chart.lines[0].symbol.size = 3
    chart.lines[0].symbol.fillColor = HexColor(COLOR_TEAL)

    chart.xValueAxis.labels.fontSize = 7
    chart.xValueAxis.labels.fillColor = HexColor(COLOR_TEXT)
    chart.xValueAxis.valueMin = 0
    chart.xValueAxis.valueMax = 25
    chart.xValueAxis.valueStep = 5

    chart.yValueAxis.labels.fontSize = 7
    chart.yValueAxis.labels.fillColor = HexColor(COLOR_TEXT)
    chart.yValueAxis.forceZero = 1

    drawing.add(chart)

    # Linea zero
    zero_y = chart.y + chart.height * (0 - chart.yValueAxis.valueMin) / (
        (chart.yValueAxis.valueMax or 1) - chart.yValueAxis.valueMin
    ) if hasattr(chart.yValueAxis, 'valueMax') and chart.yValueAxis.valueMax else chart.y
    # Semplificazione: linea zero a livello del chart.y
    drawing.add(Line(chart.x, chart.y, chart.x + chart.width, chart.y,
                     strokeColor=HexColor("#94a3b8"), strokeWidth=0.5,
                     strokeDashArray=[3, 3]))

    title = String(85 * mm, 92 * mm, "Flusso di Cassa Cumulato (\u20ac)")
    title.fontSize = 10
    title.fillColor = HexColor(COLOR_TEXT)
    title.textAnchor = "middle"
    title.fontName = "Helvetica-Bold"
    drawing.add(title)

    return drawing


# ════════════════════════════════════════════════════════════════════
# PAGINE PDF
# ════════════════════════════════════════════════════════════════════

def _build_cover_page(elements, kpi_data: dict, project_info: dict,
                      gen_date: str, styles: dict):
    """Pagina 1: Copertina con KPI dashboard."""
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.enums import TA_CENTER

    elements.append(Spacer(1, 25 * mm))

    elements.append(Paragraph(
        "Relazione Tecnica<br/>Impianto Fotovoltaico",
        styles["cover_title"],
    ))

    latitude = project_info.get("latitude", 0)
    longitude = project_info.get("longitude", 0)
    elements.append(Paragraph(
        f"Coordinate: {latitude:.4f}\u00b0 N, {longitude:.4f}\u00b0 E",
        styles["cover_subtitle"],
    ))
    elements.append(Paragraph(
        f"Data generazione: {gen_date}",
        styles["cover_date"],
    ))

    elements.append(Spacer(1, 20 * mm))

    # KPI dashboard come tabella 2x2
    kpi_peak = kpi_data.get("peak_power_kw", 0)
    kpi_energy = kpi_data.get("annual_energy_kwh", 0)
    kpi_panels = kpi_data.get("total_panels", 0)
    co2 = kpi_data.get("co2_avoided_kg", 0)

    kpi_table_data = [
        [
            Paragraph(f'<font size="18"><b>{kpi_peak:.2f}</b></font><br/>'
                      f'<font size="9" color="{COLOR_TEXT_LIGHT}">kWp</font><br/>'
                      f'<font size="8" color="{COLOR_TEXT_LIGHT}">Potenza Installata</font>',
                      styles["kpi_cell"]),
            Paragraph(f'<font size="18"><b>{kpi_energy:,.0f}</b></font><br/>'
                      f'<font size="9" color="{COLOR_TEXT_LIGHT}">kWh/anno</font><br/>'
                      f'<font size="8" color="{COLOR_TEXT_LIGHT}">Produzione Annua</font>',
                      styles["kpi_cell"]),
        ],
        [
            Paragraph(f'<font size="18"><b>{kpi_panels}</b></font><br/>'
                      f'<font size="9" color="{COLOR_TEXT_LIGHT}">pannelli</font><br/>'
                      f'<font size="8" color="{COLOR_TEXT_LIGHT}">Moduli Installati</font>',
                      styles["kpi_cell"]),
            Paragraph(f'<font size="18"><b>{co2:,.0f}</b></font><br/>'
                      f'<font size="9" color="{COLOR_TEXT_LIGHT}">kg CO\u2082/anno</font><br/>'
                      f'<font size="8" color="{COLOR_TEXT_LIGHT}">Emissioni Evitate</font>',
                      styles["kpi_cell"]),
        ],
    ]

    kpi_table = Table(kpi_table_data, colWidths=[80 * mm, 80 * mm],
                      rowHeights=[30 * mm, 30 * mm])
    kpi_table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOX", (0, 0), (0, 0), 1, HexColor(COLOR_ACCENT)),
        ("BOX", (1, 0), (1, 0), 1, HexColor(COLOR_SOLAR)),
        ("BOX", (0, 1), (0, 1), 1, HexColor(COLOR_TEAL)),
        ("BOX", (1, 1), (1, 1), 1, HexColor(COLOR_VIOLET)),
        ("BACKGROUND", (0, 0), (0, 0), HexColor("#EFF6FF")),
        ("BACKGROUND", (1, 0), (1, 0), HexColor("#FFF7ED")),
        ("BACKGROUND", (0, 1), (0, 1), HexColor("#F0FDFA")),
        ("BACKGROUND", (1, 1), (1, 1), HexColor("#F5F3FF")),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ]))
    elements.append(kpi_table)

    elements.append(Spacer(1, 15 * mm))

    # Riepilogo sotto i KPI
    kpi_yield = kpi_data.get("specific_yield", 0)
    improvement = kpi_data.get("improvement_pct", 0)

    summary_data = [
        ["Indicatore", "Valore"],
        ["Resa Specifica", f"{kpi_yield:,.0f} kWh/kWp"],
    ]
    if improvement:
        summary_data.append(["Miglioramento Ottimizzazione", f"{improvement:+.1f} %"])

    summary_table = Table(summary_data, colWidths=[80 * mm, 80 * mm])
    summary_table.setStyle(TableStyle(_make_table_style(COLOR_ACCENT)))
    elements.append(summary_table)


def _build_site_components_page(elements, project_info: dict, panel_specs: dict,
                                building_info: dict, inverter_specs: dict,
                                stringing: dict, styles: dict):
    """Pagina 2: Dati sito e specifiche componenti."""
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle, PageBreak

    elements.append(PageBreak())

    # Sezione Dati del Sito
    elements.append(Paragraph("1. Dati del Sito", styles["section"]))

    latitude = project_info.get("latitude", 0)
    longitude = project_info.get("longitude", 0)
    tilt = project_info.get("tilt", 0)
    azimuth = project_info.get("azimuth", 0)

    site_data = [
        ["Parametro", "Valore"],
        ["Latitudine", f"{latitude:.4f}\u00b0 N"],
        ["Longitudine", f"{longitude:.4f}\u00b0 E"],
        ["Inclinazione (Tilt)", f"{tilt:.1f}\u00b0"],
        ["Azimuth", f"{azimuth:.1f}\u00b0 (180\u00b0 = Sud)"],
    ]

    if building_info:
        roof_type = building_info.get("roof_type", "flat")
        site_data.append(["Tipo Tetto", ROOF_TYPE_LABELS.get(roof_type, roof_type)])
        site_data.append(["Dimensioni Edificio",
                          f"{building_info.get('width', 0):.1f} x "
                          f"{building_info.get('depth', 0):.1f} x "
                          f"{building_info.get('height', 0):.1f} m"])
        if roof_type != "flat":
            site_data.append(["Angolo Falda", f"{building_info.get('roof_angle', 0):.1f}\u00b0"])
        if building_info.get("model_rotation_y", 0) != 0:
            site_data.append(["Rotazione Edificio", f"{building_info['model_rotation_y']:.1f}\u00b0"])

    site_table = Table(site_data, colWidths=[80 * mm, 80 * mm])
    site_table.setStyle(TableStyle(_make_table_style("#334155")))
    elements.append(site_table)

    # Sezione Pannello
    if panel_specs and (panel_specs.get("constructor") or panel_specs.get("model")):
        elements.append(Spacer(1, 6 * mm))
        elements.append(Paragraph("2. Pannello Selezionato", styles["section"]))

        specs_data = [
            ["Parametro", "Valore"],
            ["Costruttore", panel_specs.get("constructor", "N/D")],
            ["Modello", panel_specs.get("model", "N/D")],
            ["Potenza Nominale", f"{panel_specs.get('power', 0):.0f} W"],
            ["Efficienza", f"{panel_specs.get('efficiency', 0) * 100:.1f} %"],
            ["Dimensioni", f"{panel_specs.get('width', 0):.2f} x {panel_specs.get('height', 0):.2f} m"],
        ]
        if panel_specs.get("weight_kg"):
            specs_data.append(["Peso", f"{panel_specs['weight_kg']:.1f} kg"])
        specs_data.append(["Coeff. Temperatura",
                           f"{panel_specs.get('temp_coefficient', 0):.3f} %/\u00b0C"])
        if panel_specs.get("warranty_years"):
            specs_data.append(["Garanzia", f"{panel_specs['warranty_years']} anni"])
        if panel_specs.get("degradation_pct"):
            specs_data.append(["Degradazione Annua", f"{panel_specs['degradation_pct']:.2f} %/anno"])

        # Parametri elettrici
        has_electrical = any(panel_specs.get(k) for k in ["voc_v", "isc_a", "vmpp_v", "impp_a"])
        if has_electrical:
            if panel_specs.get("voc_v"):
                specs_data.append(["Voc (Tensione a Vuoto)", f"{panel_specs['voc_v']:.1f} V"])
            if panel_specs.get("isc_a"):
                specs_data.append(["Isc (Corrente di Cortocircuito)", f"{panel_specs['isc_a']:.2f} A"])
            if panel_specs.get("vmpp_v"):
                specs_data.append(["Vmpp (Tensione al MPP)", f"{panel_specs['vmpp_v']:.1f} V"])
            if panel_specs.get("impp_a"):
                specs_data.append(["Impp (Corrente al MPP)", f"{panel_specs['impp_a']:.2f} A"])

        specs_table = Table(specs_data, colWidths=[80 * mm, 80 * mm])
        specs_table.setStyle(TableStyle(_make_table_style("#334155")))
        elements.append(specs_table)

    # Sezione Inverter (condizionale)
    if inverter_specs and inverter_specs.get("constructor"):
        elements.append(Spacer(1, 6 * mm))
        elements.append(Paragraph("3. Inverter Selezionato", styles["section"]))

        inv_data = [
            ["Parametro", "Valore"],
            ["Costruttore", inverter_specs.get("constructor", "N/D")],
            ["Modello", inverter_specs.get("model", "N/D")],
            ["Potenza AC", f"{inverter_specs.get('power_kw', 0):.2f} kW"],
            ["Potenza DC Max", f"{inverter_specs.get('max_dc_power_kw', 0):.2f} kW"],
            ["Canali MPPT", str(inverter_specs.get("mppt_channels", 0))],
            ["Range MPPT",
             f"{inverter_specs.get('mppt_voltage_min_v', 0):.0f} - "
             f"{inverter_specs.get('mppt_voltage_max_v', 0):.0f} V"],
            ["Efficienza", f"{inverter_specs.get('efficiency_pct', 0):.1f} %"],
        ]

        inv_table = Table(inv_data, colWidths=[80 * mm, 80 * mm])
        inv_table.setStyle(TableStyle(_make_table_style("#334155")))
        elements.append(inv_table)

    # Sezione Stringing (condizionale)
    if stringing and stringing.get("panels_per_string", 0) > 0:
        elements.append(Spacer(1, 6 * mm))
        section_num = 4 if inverter_specs and inverter_specs.get("constructor") else 3
        elements.append(Paragraph(f"{section_num}. Configurazione Stringhe", styles["section"]))

        str_data = [
            ["Parametro", "Valore"],
            ["Pannelli per Stringa", str(stringing.get("panels_per_string", 0))],
            ["Stringhe per MPPT", str(stringing.get("strings_per_mppt", 0))],
            ["Canali MPPT Utilizzati", str(stringing.get("mppt_used", 0))],
            ["Pannelli Totali Cablati", str(stringing.get("total_panels_used", 0))],
            ["Potenza DC Totale", f"{stringing.get('dc_power_kw', 0):.2f} kW"],
            ["Voc Max (a T min)", f"{stringing.get('voc_max_v', 0):.1f} V"],
            ["Vmpp Min (a T max)", f"{stringing.get('vmpp_min_v', 0):.1f} V"],
            ["Vmpp Max (a T min)", f"{stringing.get('vmpp_max_v', 0):.1f} V"],
            ["Rapporto DC/AC", f"{stringing.get('dc_ac_ratio', 0):.2f}"],
        ]

        status = stringing.get("status", "ok")
        status_label = {"ok": "Compatibile", "warning": "Attenzione", "error": "Non compatibile"}
        str_data.append(["Stato Verifica", status_label.get(status, status)])

        str_table = Table(str_data, colWidths=[80 * mm, 80 * mm])
        style_cmds = _make_table_style("#334155")
        # Evidenzia stato
        if status == "ok":
            style_cmds.append(("TEXTCOLOR", (1, -1), (1, -1), HexColor(COLOR_TEAL)))
        elif status == "warning":
            style_cmds.append(("TEXTCOLOR", (1, -1), (1, -1), HexColor(COLOR_SOLAR)))
        elif status == "error":
            style_cmds.append(("TEXTCOLOR", (1, -1), (1, -1), HexColor("#F87171")))
        str_table.setStyle(TableStyle(style_cmds))
        elements.append(str_table)


def _build_production_page(elements, kpi_energy: float, monthly_irradiance: dict,
                           annual_irradiance: float, kpi_peak: float, styles: dict):
    """Pagina 3: Grafici e tabella produzione mensile."""
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle, PageBreak

    elements.append(PageBreak())
    elements.append(Paragraph("Analisi Produzione Energetica", styles["section"]))

    # Grafico produzione mensile
    elements.append(_build_production_chart(kpi_energy, monthly_irradiance))
    elements.append(Spacer(1, 4 * mm))

    # Grafico irradianza (se disponibile)
    if monthly_irradiance:
        elements.append(_build_irradiance_chart(monthly_irradiance))
        elements.append(Spacer(1, 4 * mm))

    # Tabella riepilogativa
    header = ["Mese", "Irradianza\n(kWh/m\u00b2)", "Produzione\n(kWh)",
              "Ore Sole", "Resa Specifica\n(kWh/kWp)"]
    monthly_table_data = [header]

    total_prod = 0
    total_irr = 0
    total_hours = 0

    for i, month_name in enumerate(MONTH_NAMES):
        month_prod = kpi_energy * MONTHLY_DISTRIBUTION[i]
        if monthly_irradiance:
            month_irr = monthly_irradiance.get(MONTH_NAMES_EN[i], 0)
        else:
            month_irr = annual_irradiance * MONTHLY_DISTRIBUTION[i]

        sun_h = MONTHLY_SUN_HOURS[i]
        spec_yield = month_prod / kpi_peak if kpi_peak > 0 else 0

        monthly_table_data.append([
            month_name,
            f"{month_irr:.1f}",
            f"{month_prod:,.0f}",
            f"{sun_h:.1f}",
            f"{spec_yield:.1f}",
        ])
        total_prod += month_prod
        total_irr += month_irr
        total_hours += sun_h

    total_yield = total_prod / kpi_peak if kpi_peak > 0 else 0
    monthly_table_data.append([
        "TOTALE", f"{total_irr:.1f}", f"{total_prod:,.0f}",
        f"{total_hours:.1f}", f"{total_yield:.0f}",
    ])

    col_widths = [30 * mm, 32 * mm, 32 * mm, 25 * mm, 38 * mm]
    monthly_table = Table(monthly_table_data, colWidths=col_widths)
    style_cmds = _make_table_style(COLOR_ACCENT)
    style_cmds.extend([
        ("BACKGROUND", (0, -1), (-1, -1), HexColor("#E8F0FE")),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
    ])
    monthly_table.setStyle(TableStyle(style_cmds))
    elements.append(monthly_table)


def _build_economic_page(elements, economic: dict, kpi_energy: float,
                         kpi_peak: float, panel_specs: dict, styles: dict):
    """Pagina 4: Analisi economica (condizionale)."""
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle, PageBreak

    elements.append(PageBreak())
    elements.append(Paragraph("Analisi Economica", styles["section"]))

    cost_per_kwp = economic.get("cost_per_kwp", 1500)
    energy_price = economic.get("energy_price_kwh", 0.25)
    self_consumption = economic.get("self_consumption_pct", 70) / 100
    incentives = economic.get("incentives", 0)
    degradation = panel_specs.get("degradation_pct", 0.5) / 100 if panel_specs else 0.005

    total_cost = cost_per_kwp * kpi_peak - incentives
    annual_savings_y1 = kpi_energy * energy_price * self_consumption + \
                        kpi_energy * (1 - self_consumption) * energy_price * 0.4  # vendita a rete ~40% prezzo

    # Input parametri
    elements.append(Paragraph("Parametri Economici", styles["subsection"]))
    input_data = [
        ["Parametro", "Valore"],
        ["Costo Impianto", f"{cost_per_kwp:,.0f} \u20ac/kWp"],
        ["Costo Totale Impianto", f"{total_cost:,.0f} \u20ac"],
        ["Prezzo Energia", f"{energy_price:.3f} \u20ac/kWh"],
        ["Quota Autoconsumo", f"{self_consumption * 100:.0f} %"],
    ]
    if incentives > 0:
        input_data.append(["Incentivi/Detrazioni", f"{incentives:,.0f} \u20ac"])
    if degradation > 0:
        input_data.append(["Degradazione Pannelli", f"{degradation * 100:.2f} %/anno"])

    input_table = Table(input_data, colWidths=[80 * mm, 80 * mm])
    input_table.setStyle(TableStyle(_make_table_style("#334155")))
    elements.append(input_table)
    elements.append(Spacer(1, 6 * mm))

    # Calcolo anno per anno
    years_data = []
    cumulative = -total_cost
    payback_year = None

    for year in range(0, 26):
        if year == 0:
            years_data.append({"year": 0, "production": 0, "savings": 0,
                               "cumulative": cumulative})
            continue

        factor = (1 - degradation) ** (year - 1)
        year_prod = kpi_energy * factor
        year_savings = year_prod * energy_price * self_consumption + \
                       year_prod * (1 - self_consumption) * energy_price * 0.4
        cumulative += year_savings

        years_data.append({
            "year": year,
            "production": year_prod,
            "savings": year_savings,
            "cumulative": cumulative,
        })

        if payback_year is None and cumulative >= 0:
            payback_year = year

    # Risultati chiave
    elements.append(Paragraph("Risultati Analisi", styles["subsection"]))

    savings_y1 = years_data[1]["savings"] if len(years_data) > 1 else 0
    cum_10 = years_data[10]["cumulative"] if len(years_data) > 10 else 0
    cum_20 = years_data[20]["cumulative"] if len(years_data) > 20 else 0
    cum_25 = years_data[25]["cumulative"] if len(years_data) > 25 else 0

    results_data = [
        ["Indicatore", "Valore"],
        ["Risparmio Annuo (Anno 1)", f"{savings_y1:,.0f} \u20ac"],
        ["Tempo di Ritorno (Payback)", f"{payback_year} anni" if payback_year else "> 25 anni"],
        ["Guadagno a 10 anni", f"{cum_10:,.0f} \u20ac"],
        ["Guadagno a 20 anni", f"{cum_20:,.0f} \u20ac"],
        ["Guadagno a 25 anni", f"{cum_25:,.0f} \u20ac"],
    ]

    results_table = Table(results_data, colWidths=[80 * mm, 80 * mm])
    style_cmds = _make_table_style(COLOR_TEAL)
    if payback_year and payback_year <= 10:
        style_cmds.append(("TEXTCOLOR", (1, 2), (1, 2), HexColor(COLOR_TEAL)))
    results_table.setStyle(TableStyle(style_cmds))
    elements.append(results_table)
    elements.append(Spacer(1, 6 * mm))

    # Grafico flusso di cassa
    elements.append(_build_cashflow_chart(years_data))
    elements.append(Spacer(1, 4 * mm))

    # Tabella dettagliata (ogni 5 anni + anno 1)
    detail_header = ["Anno", "Produzione\n(kWh)", "Risparmio\n(\u20ac)", "Cumulato\n(\u20ac)"]
    detail_data = [detail_header]
    for d in years_data:
        y = d["year"]
        if y == 0 or y == 1 or y % 5 == 0:
            detail_data.append([
                str(y),
                f"{d['production']:,.0f}" if y > 0 else "-",
                f"{d['savings']:,.0f}" if y > 0 else f"-{total_cost:,.0f}",
                f"{d['cumulative']:,.0f}",
            ])

    detail_table = Table(detail_data, colWidths=[25 * mm, 42 * mm, 42 * mm, 42 * mm])
    detail_style = _make_table_style(COLOR_ACCENT)
    detail_style.append(("ALIGN", (0, 0), (-1, -1), "CENTER"))
    detail_style.append(("FONTSIZE", (0, 0), (-1, -1), 8))
    detail_table.setStyle(TableStyle(detail_style))
    elements.append(detail_table)


def _build_layout_page(elements, panels_layout: list, building_width: float,
                       building_depth: float, panel_specs: dict,
                       stringing: dict, styles: dict):
    """Pagina 5: Schema tecnico layout pannelli."""
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, Spacer, PageBreak

    elements.append(PageBreak())
    elements.append(Paragraph("Schema Tecnico Layout", styles["section"]))

    elements.append(_build_layout_drawing(
        panels_layout, building_width, building_depth, panel_specs, stringing
    ))
    elements.append(Spacer(1, 4 * mm))

    pw = panel_specs.get("width", 1.0) if panel_specs else 1.0
    ph = panel_specs.get("height", 1.7) if panel_specs else 1.7
    panel_area = pw * ph * len(panels_layout)

    elements.append(Paragraph(
        f"Pannelli posizionati: <b>{len(panels_layout)}</b> "
        f"&nbsp;|&nbsp; Superficie pannelli: <b>{panel_area:.1f} m\u00b2</b> "
        f"&nbsp;|&nbsp; Superficie tetto: <b>{building_width * building_depth:.1f} m\u00b2</b>",
        styles["body"],
    ))


def _build_environmental_page(elements, co2_avoided: float, kpi_energy: float,
                              panel_specs: dict, styles: dict):
    """Pagina 6: Impatto ambientale e note."""
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle, PageBreak

    elements.append(PageBreak())
    elements.append(Paragraph("Impatto Ambientale", styles["section"]))

    degradation = panel_specs.get("degradation_pct", 0.5) / 100 if panel_specs else 0.005
    co2_25y = sum(co2_avoided * (1 - degradation) ** y for y in range(25))
    trees_equivalent = co2_avoided / 20  # 1 albero ~ 20 kg CO2/anno
    km_avoided = co2_avoided / 0.12  # 0.12 kg CO2/km

    env_data = [
        ["Indicatore", "Valore"],
        ["CO\u2082 Evitata (annua)", f"{co2_avoided:,.0f} kg"],
        ["CO\u2082 Evitata (25 anni)", f"{co2_25y:,.0f} kg ({co2_25y / 1000:,.1f} t)"],
        ["Equivalente Alberi Piantati", f"{trees_equivalent:,.0f} alberi/anno"],
        ["Equivalente km Auto Evitati", f"{km_avoided:,.0f} km/anno"],
    ]

    env_table = Table(env_data, colWidths=[80 * mm, 80 * mm])
    env_table.setStyle(TableStyle(_make_table_style(COLOR_TEAL)))
    elements.append(env_table)

    elements.append(Spacer(1, 10 * mm))

    # Riferimenti normativi
    elements.append(Paragraph("Riferimenti Normativi", styles["subsection"]))
    elements.append(Paragraph(
        "\u2022 CEI 0-21: Regola tecnica di riferimento per la connessione di utenti attivi "
        "e passivi alle reti BT delle imprese distributrici di energia elettrica",
        styles["note"],
    ))
    elements.append(Paragraph(
        "\u2022 CEI 0-16: Regola tecnica di riferimento per la connessione di utenti attivi "
        "e passivi alle reti AT e MT (per impianti > 6 kW)",
        styles["note"],
    ))
    elements.append(Paragraph(
        "\u2022 D.Lgs. 199/2021: Attuazione della direttiva (UE) 2018/2001 sulla promozione "
        "dell'uso dell'energia da fonti rinnovabili",
        styles["note"],
    ))

    elements.append(Spacer(1, 10 * mm))

    # Note e disclaimer
    elements.append(Paragraph("Note e Disclaimer", styles["subsection"]))
    elements.append(Spacer(1, 2 * mm))
    elements.append(Paragraph(
        "I valori riportati sono stime basate su modelli di irradianza solare (pvlib) "
        "e simulazioni di ombreggiamento (ray tracing). I risultati effettivi possono variare "
        "in base a condizioni meteo reali, degradazione dei pannelli, perdite di sistema e "
        "altri fattori non considerati nel modello.",
        styles["note"],
    ))
    elements.append(Spacer(1, 2 * mm))
    elements.append(Paragraph(
        "CO\u2082 evitata calcolata con fattore 0.4 kg/kWh (media mix energetico italiano, "
        "fonte ISPRA). Performance Ratio include perdite per ombreggiamento, temperatura "
        "e sistema inverter/cablaggio.",
        styles["note"],
    ))
    elements.append(Spacer(1, 2 * mm))
    elements.append(Paragraph(
        "L'analisi economica, ove presente, ha carattere puramente indicativo e non "
        "costituisce consulenza finanziaria. I prezzi dell'energia e gli incentivi possono "
        "variare nel tempo.",
        styles["note"],
    ))


# ════════════════════════════════════════════════════════════════════
# GENERATORE PDF PRINCIPALE
# ════════════════════════════════════════════════════════════════════

def generate_pdf(simulation_results: dict, project_info: dict,
                 extra: Optional[dict] = None) -> bytes:
    """
    Genera un report PDF professionale multi-pagina.
    Pagine condizionali vengono omesse se i dati non sono disponibili.
    """
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT

    if extra is None:
        extra = {}

    buffer = io.BytesIO()
    gen_date = datetime.now().strftime("%d/%m/%Y %H:%M")

    def footer_handler(canvas, doc):
        _draw_header_footer(canvas, doc, gen_date)

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
    )

    base_styles = getSampleStyleSheet()

    # Stili personalizzati
    styles = {
        "cover_title": ParagraphStyle(
            "CoverTitle",
            parent=base_styles["Title"],
            fontSize=28,
            leading=34,
            textColor=HexColor(COLOR_TEXT),
            alignment=TA_CENTER,
            spaceAfter=8 * mm,
        ),
        "cover_subtitle": ParagraphStyle(
            "CoverSubtitle",
            parent=base_styles["Normal"],
            fontSize=12,
            textColor=HexColor(COLOR_TEXT_LIGHT),
            alignment=TA_CENTER,
            spaceAfter=3 * mm,
        ),
        "cover_date": ParagraphStyle(
            "CoverDate",
            parent=base_styles["Normal"],
            fontSize=10,
            textColor=HexColor("#94a3b8"),
            alignment=TA_CENTER,
            spaceAfter=5 * mm,
        ),
        "section": ParagraphStyle(
            "SectionHeader",
            parent=base_styles["Heading2"],
            fontSize=14,
            textColor=HexColor(COLOR_ACCENT),
            spaceBefore=8 * mm,
            spaceAfter=4 * mm,
            fontName="Helvetica-Bold",
        ),
        "subsection": ParagraphStyle(
            "SubsectionHeader",
            parent=base_styles["Heading3"],
            fontSize=11,
            textColor=HexColor(COLOR_TEXT),
            spaceBefore=5 * mm,
            spaceAfter=3 * mm,
            fontName="Helvetica-Bold",
        ),
        "body": ParagraphStyle(
            "BodyCustom",
            parent=base_styles["Normal"],
            fontSize=9,
            textColor=HexColor("#334155"),
            leading=13,
        ),
        "note": ParagraphStyle(
            "NoteCustom",
            parent=base_styles["Normal"],
            fontSize=8,
            textColor=HexColor("#94a3b8"),
            leading=11,
        ),
        "kpi_cell": ParagraphStyle(
            "KpiCell",
            parent=base_styles["Normal"],
            fontSize=10,
            textColor=HexColor(COLOR_TEXT),
            alignment=TA_CENTER,
            leading=16,
        ),
    }

    elements = []

    # Estrai dati comuni
    kpi = extra.get("kpi")
    panel_specs = extra.get("panel_specs")
    monthly_irradiance = extra.get("monthly_irradiance")
    panels_layout = extra.get("panels_layout")
    building_width = extra.get("building_width", 10)
    building_depth = extra.get("building_depth", 10)
    economic = extra.get("economic")
    inverter_specs = extra.get("inverter_specs")
    stringing = extra.get("stringing")
    building_info = extra.get("building_info")

    peak_power_kw = simulation_results.get("peak_power_kw", 0)
    annual_energy = simulation_results.get("annual_energy_kwh", 0)
    num_panels = simulation_results.get("num_panels", 0)
    co2_avoided = simulation_results.get("co2_avoided_kg", 0)

    if kpi:
        kpi_peak = kpi.get("peak_power_kw", peak_power_kw)
        kpi_energy = kpi.get("annual_energy_kwh", annual_energy)
        kpi_panels = kpi.get("total_panels", num_panels)
        kpi_yield = kpi.get("specific_yield", 0)
    else:
        kpi_peak = peak_power_kw
        kpi_energy = annual_energy
        kpi_panels = num_panels
        kpi_yield = annual_energy / peak_power_kw if peak_power_kw > 0 else 0

    kpi_data = {
        "peak_power_kw": kpi_peak,
        "annual_energy_kwh": kpi_energy,
        "total_panels": kpi_panels,
        "co2_avoided_kg": co2_avoided,
        "specific_yield": kpi_yield,
        "improvement_pct": simulation_results.get("improvement_pct", 0),
    }

    # ── Pagina 1: Copertina ──
    _build_cover_page(elements, kpi_data, project_info, gen_date, styles)

    # ── Pagina 2: Dati sito e componenti ──
    _build_site_components_page(
        elements, project_info, panel_specs, building_info,
        inverter_specs, stringing, styles
    )

    # ── Pagina 3: Grafici produzione ──
    _build_production_page(
        elements, kpi_energy, monthly_irradiance,
        simulation_results.get("annual_irradiance", 1700), kpi_peak, styles
    )

    # ── Pagina 4: Analisi economica (condizionale) ──
    if economic:
        _build_economic_page(elements, economic, kpi_energy, kpi_peak, panel_specs, styles)

    # ── Pagina 5: Schema tecnico layout ──
    if panels_layout and len(panels_layout) > 0:
        _build_layout_page(
            elements, panels_layout, building_width, building_depth,
            panel_specs, stringing, styles
        )

    # ── Pagina 6: Impatto ambientale e note ──
    _build_environmental_page(elements, co2_avoided, kpi_energy, panel_specs, styles)

    doc.build(elements, onFirstPage=footer_handler, onLaterPages=footer_handler)
    buffer.seek(0)
    return buffer.getvalue()

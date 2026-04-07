"""Servizio di dimensionamento stringhe fotovoltaiche (IEC 62548).

Calcola la configurazione serie/parallelo ottimale per collegare i pannelli
a un inverter, verificando i vincoli elettrici MPPT.
"""

import math
from app.models.stringing import StringingRequest, StringingResponse


def _temp_correction(coeff_pct: float, t_actual: float, t_stc: float = 25.0) -> float:
    """Fattore di correzione temperatura: 1 + (coeff/100) * (T - 25)."""
    return 1.0 + (coeff_pct / 100.0) * (t_actual - t_stc)


def _evaluate_config(
    req: StringingRequest,
    n_serie: int,
    n_parallelo: int,
) -> tuple[float, float, float, float, float, list[str]]:
    """Calcola tensioni/correnti per una configurazione e ritorna warning."""
    warnings = []

    # Tensioni corrette per temperatura
    voc_max = n_serie * req.voc_v * _temp_correction(req.temp_coeff_voc, req.t_min_c)
    vmpp_min = n_serie * req.vmpp_v * _temp_correction(req.temp_coeff_voc, req.t_max_c)
    vmpp_max = n_serie * req.vmpp_v * _temp_correction(req.temp_coeff_voc, req.t_min_c)
    isc_max = n_parallelo * req.isc_a * _temp_correction(req.temp_coeff_isc, req.t_max_c)

    # Verifiche
    if voc_max > req.max_input_voltage_v:
        warnings.append(
            f"Voc max ({voc_max:.1f} V) supera il limite inverter ({req.max_input_voltage_v:.1f} V)"
        )
    if vmpp_min < req.mppt_voltage_min_v:
        warnings.append(
            f"Vmpp min ({vmpp_min:.1f} V) sotto il range MPPT ({req.mppt_voltage_min_v:.1f} V)"
        )
    if vmpp_max > req.mppt_voltage_max_v:
        warnings.append(
            f"Vmpp max ({vmpp_max:.1f} V) sopra il range MPPT ({req.mppt_voltage_max_v:.1f} V)"
        )
    if isc_max > req.max_input_current_a:
        warnings.append(
            f"Isc max ({isc_max:.1f} A) supera il limite per canale ({req.max_input_current_a:.1f} A)"
        )

    dc_power_kw = n_serie * n_parallelo * req.power_w / 1000.0

    return voc_max, vmpp_min, vmpp_max, isc_max, dc_power_kw, warnings


def calculate_stringing(req: StringingRequest) -> StringingResponse:
    """Calcola il dimensionamento stringhe in modalità auto o manuale."""
    if req.mode == 'manual':
        return _calculate_manual(req)
    return _calculate_auto(req)


def _calculate_auto(req: StringingRequest) -> StringingResponse:
    """Modalità automatica: trova la configurazione ottimale."""
    max_n_serie = int(math.floor(req.max_input_voltage_v / req.voc_v))
    best = None

    for n_serie in range(1, max_n_serie + 1):
        # Verifica Voc a T_min
        voc_max = n_serie * req.voc_v * _temp_correction(req.temp_coeff_voc, req.t_min_c)
        if voc_max > req.max_input_voltage_v:
            break  # n_serie troppo alto, non serve continuare

        # Verifica Vmpp nel range MPPT
        vmpp_min = n_serie * req.vmpp_v * _temp_correction(req.temp_coeff_voc, req.t_max_c)
        vmpp_max = n_serie * req.vmpp_v * _temp_correction(req.temp_coeff_voc, req.t_min_c)
        if vmpp_max < req.mppt_voltage_min_v:
            continue  # troppo pochi moduli, tensione insufficiente
        if vmpp_min > req.mppt_voltage_max_v:
            continue  # troppo alta anche a T_max

        # Calcola max parallelo ammissibile per canale (limite corrente)
        isc_per_string = req.isc_a * _temp_correction(req.temp_coeff_isc, req.t_max_c)
        max_parallel_current = int(math.floor(req.max_input_current_a / isc_per_string)) if isc_per_string > 0 else 0
        if max_parallel_current < 1:
            continue

        # Calcola max parallelo per limite potenza DC totale
        power_per_string = n_serie * req.power_w / 1000.0  # kW
        max_dc_total = req.max_dc_power_kw
        # Totale stringhe possibili su tutti i canali
        max_total_strings = int(math.floor(max_dc_total / power_per_string)) if power_per_string > 0 else 0

        # Distribuisci tra i canali MPPT
        for n_mppt in range(req.mppt_channels, 0, -1):
            n_parallelo = min(max_parallel_current, max_total_strings // n_mppt) if n_mppt > 0 else 0
            if n_parallelo < 1:
                continue

            total_used = n_serie * n_parallelo * n_mppt
            if total_used > req.total_panels:
                # Riduci n_parallelo per non superare il totale
                n_parallelo = req.total_panels // (n_serie * n_mppt)
                if n_parallelo < 1:
                    continue
                total_used = n_serie * n_parallelo * n_mppt

            if best is None or total_used > best['total_used']:
                best = {
                    'n_serie': n_serie,
                    'n_parallelo': n_parallelo,
                    'n_mppt': n_mppt,
                    'total_used': total_used,
                }

    if best is None:
        return StringingResponse(
            compatible=False,
            status='error',
            panels_per_string=0,
            strings_per_mppt=0,
            mppt_used=0,
            total_panels_used=0,
            total_panels_unused=req.total_panels,
            dc_power_kw=0,
            voc_max_v=0,
            vmpp_min_v=0,
            vmpp_max_v=0,
            isc_max_a=0,
            dc_ac_ratio=0,
            warnings=["Nessuna configurazione valida trovata per i parametri forniti"],
        )

    n_serie = best['n_serie']
    n_parallelo = best['n_parallelo']
    n_mppt = best['n_mppt']
    total_used = best['total_used']

    voc_max, vmpp_min, vmpp_max, isc_max, dc_power_per_mppt, warnings = _evaluate_config(
        req, n_serie, n_parallelo
    )
    dc_power_kw = dc_power_per_mppt * n_mppt
    dc_ac_ratio = dc_power_kw / req.inverter_power_kw if req.inverter_power_kw > 0 else 0

    # Warning per sovradimensionamento
    if dc_ac_ratio > 1.5:
        warnings.append(f"Rapporto DC/AC elevato ({dc_ac_ratio:.2f}), consigliato ≤ 1.3")
    elif dc_ac_ratio > 1.3:
        warnings.append(f"Rapporto DC/AC ({dc_ac_ratio:.2f}) sopra il valore tipico (1.0–1.3)")

    status = 'ok' if len(warnings) == 0 else 'warning'

    return StringingResponse(
        compatible=len(warnings) == 0,
        status=status,
        panels_per_string=n_serie,
        strings_per_mppt=n_parallelo,
        mppt_used=n_mppt,
        total_panels_used=total_used,
        total_panels_unused=req.total_panels - total_used,
        dc_power_kw=round(dc_power_kw, 3),
        voc_max_v=round(voc_max, 1),
        vmpp_min_v=round(vmpp_min, 1),
        vmpp_max_v=round(vmpp_max, 1),
        isc_max_a=round(isc_max, 2),
        dc_ac_ratio=round(dc_ac_ratio, 2),
        warnings=warnings,
    )


def _calculate_manual(req: StringingRequest) -> StringingResponse:
    """Modalità manuale: verifica una configurazione scelta dall'utente."""
    n_serie = req.panels_per_string or 1
    n_parallelo = req.strings_per_mppt or 1

    # Calcola quanti MPPT servono
    panels_per_mppt = n_serie * n_parallelo
    n_mppt = min(req.mppt_channels, req.total_panels // panels_per_mppt) if panels_per_mppt > 0 else 0
    if n_mppt < 1:
        n_mppt = 1
    total_used = n_serie * n_parallelo * n_mppt
    if total_used > req.total_panels:
        total_used = (req.total_panels // (n_serie * n_parallelo)) * n_serie * n_parallelo
        n_mppt = total_used // (n_serie * n_parallelo) if (n_serie * n_parallelo) > 0 else 0

    voc_max, vmpp_min, vmpp_max, isc_max, dc_power_per_mppt, warnings = _evaluate_config(
        req, n_serie, n_parallelo
    )
    dc_power_kw = dc_power_per_mppt * n_mppt
    dc_ac_ratio = dc_power_kw / req.inverter_power_kw if req.inverter_power_kw > 0 else 0

    # Verifica potenza DC totale
    if dc_power_kw > req.max_dc_power_kw:
        warnings.append(
            f"Potenza DC totale ({dc_power_kw:.1f} kW) supera il limite inverter ({req.max_dc_power_kw:.1f} kW)"
        )

    if dc_ac_ratio > 1.5:
        warnings.append(f"Rapporto DC/AC elevato ({dc_ac_ratio:.2f}), consigliato ≤ 1.3")
    elif dc_ac_ratio > 1.3:
        warnings.append(f"Rapporto DC/AC ({dc_ac_ratio:.2f}) sopra il valore tipico (1.0–1.3)")

    has_errors = any(
        "supera" in w or "sotto" in w or "sopra il range" in w
        for w in warnings
    )
    status = 'error' if has_errors else ('warning' if warnings else 'ok')

    return StringingResponse(
        compatible=not has_errors,
        status=status,
        panels_per_string=n_serie,
        strings_per_mppt=n_parallelo,
        mppt_used=n_mppt,
        total_panels_used=total_used,
        total_panels_unused=req.total_panels - total_used,
        dc_power_kw=round(dc_power_kw, 3),
        voc_max_v=round(voc_max, 1),
        vmpp_min_v=round(vmpp_min, 1),
        vmpp_max_v=round(vmpp_max, 1),
        isc_max_a=round(isc_max, 2),
        dc_ac_ratio=round(dc_ac_ratio, 2),
        warnings=warnings,
    )

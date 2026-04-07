"""Shared thermal derating helpers."""


def calc_temp_derating(temp_coefficient_pct: float, cell_temperature: float) -> float:
    """Compute power temperature derating factor.

    Parameters
    ----------
    temp_coefficient_pct : float
        Temperature coefficient of Pmax in %/°C (e.g. -0.4).
    cell_temperature : float
        Cell (or NOCT) temperature in °C.

    Returns
    -------
    float
        Derating factor clamped to [0.5, 1.0].
    """
    temp_coeff_per_c = temp_coefficient_pct / 100.0
    return max(0.5, min(1.0, 1.0 + temp_coeff_per_c * (cell_temperature - 25.0)))

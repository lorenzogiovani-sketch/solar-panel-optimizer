"""
Daily-to-hourly disaggregation of horizontal irradiance aggregates.

Implements the Collares-Pereira & Rabl (1979) ratio r_t for the beam component
(as modified by Gueymard's normalisation) and the Liu-Jordan (1960) ratio r_d
for the diffuse component.  Inputs are daily averages (H_bh, H_dh) as provided
by UNI 10349 tables; outputs are 24 hourly samples (W/m²).

Conventions
-----------
- ω (omega) is the solar hour angle, in radians, zero at solar noon, negative
  in the morning (AM), positive in the afternoon (PM).
- ω_s is the sunset hour angle, in radians, computed from latitude and
  declination: cos(ω_s) = -tan(φ)·tan(δ).
- Input daily values (H_bh_day, H_dh_day) are expressed in **kWh/m²·day**.
- Output hourly values are expressed in **W/m²** (average over the hour).
  Conservation holds: Σ_h H_hourly · 1h (Wh/m²) ≈ H_day · 1000 (Wh/m²).

References: docs/Riferimento.md §2.5.2, §2.5.1, §4.4.2.
"""

from __future__ import annotations

import numpy as np


# Klein (1977) representative day-of-year for each month — the day on which
# the extraterrestrial irradiation equals the monthly average.  Standard
# convention adopted by UNI 10349 when expanding monthly averages to hourly.
KLEIN_REPRESENTATIVE_DOY: tuple[int, ...] = (
    17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344,
)


def _declination_rad(day_of_year: float) -> float:
    """Solar declination δ (radians) — Cooper (1969) approximation."""
    return np.radians(23.45) * np.sin(2.0 * np.pi * (284 + day_of_year) / 365.0)


def _sunset_hour_angle_rad(latitude_deg: float, day_of_year: float) -> float:
    """ω_s = arccos(-tan φ · tan δ).  Clamped for polar day/night."""
    phi = np.radians(latitude_deg)
    delta = _declination_rad(day_of_year)
    arg = -np.tan(phi) * np.tan(delta)
    return float(np.arccos(np.clip(arg, -1.0, 1.0)))


def collares_pereira_rabl_rt(omega: float | np.ndarray, omega_s: float) -> np.ndarray:
    """Collares-Pereira & Rabl (1979) beam ratio r_t (hourly/daily).

    Form (Eq. 2.198/2.201, Riferimento.md §2.5.2):

        r_t(ω) = (π/24) · (a + b·cos ω) · (cos ω − cos ω_s) /
                 (sin ω_s − ω_s · cos ω_s)

    where ω and ω_s are in radians, and the coefficients depend on ω_s
    (expressed in degrees inside the sine argument, standard CPR form):

        a = 0.409 + 0.5016 · sin(ω_s − 60°)
        b = 0.6609 − 0.4767 · sin(ω_s − 60°)

    Outside [-ω_s, +ω_s] the ratio is zero (night).
    """
    omega = np.asarray(omega, dtype=float)
    omega_s_deg = np.degrees(omega_s)
    a = 0.409 + 0.5016 * np.sin(np.radians(omega_s_deg - 60.0))
    b = 0.6609 - 0.4767 * np.sin(np.radians(omega_s_deg - 60.0))

    denom = np.sin(omega_s) - omega_s * np.cos(omega_s)
    if denom <= 1e-9:
        return np.zeros_like(omega)

    rt = (np.pi / 24.0) * (a + b * np.cos(omega)) * (np.cos(omega) - np.cos(omega_s)) / denom
    return np.where(np.abs(omega) <= omega_s, np.clip(rt, a_min=0.0, a_max=None), 0.0)


def liu_jordan_rd(omega: float | np.ndarray, omega_s: float) -> np.ndarray:
    """Liu & Jordan (1960) diffuse ratio r_d (hourly/daily).

        r_d(ω) = (π/24) · (cos ω − cos ω_s) / (sin ω_s − ω_s · cos ω_s)

    Same domain as r_t; isotropic assumption on the diffuse distribution over
    the day, hence no angular-dependent coefficient.
    """
    omega = np.asarray(omega, dtype=float)
    denom = np.sin(omega_s) - omega_s * np.cos(omega_s)
    if denom <= 1e-9:
        return np.zeros_like(omega)
    rd = (np.pi / 24.0) * (np.cos(omega) - np.cos(omega_s)) / denom
    return np.where(np.abs(omega) <= omega_s, np.clip(rd, a_min=0.0, a_max=None), 0.0)


def _hour_angles_midpoints() -> np.ndarray:
    """24 hour-angles in radians, centred on each clock hour midpoint.

    Hour h ∈ [0, 23] covers clock-time [h:00, h+1:00); midpoint (h+0.5)
    corresponds to ω = 15° · ((h + 0.5) − 12).
    """
    hours = np.arange(24, dtype=float) + 0.5
    return np.radians(15.0 * (hours - 12.0))


def disaggregate_daily_to_hourly(
    h_bh_day: float,
    h_dh_day: float,
    latitude: float,
    day_of_year: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Disaggregate daily horizontal irradiation into 24 hourly samples.

    Parameters
    ----------
    h_bh_day : float
        Daily beam horizontal irradiation (kWh/m²·d).
    h_dh_day : float
        Daily diffuse horizontal irradiation (kWh/m²·d).
    latitude : float
        Site latitude (degrees, positive north).
    day_of_year : float
        DOY of the representative day (e.g. Klein's day for the month).

    Returns
    -------
    (h_bh_hourly, h_dh_hourly) : tuple of np.ndarray, shape (24,)
        Hourly average power (W/m²) over each clock hour.
        Σ_h H_hourly · 1h ≈ H_day · 1000 Wh/m².
    """
    omega_s = _sunset_hour_angle_rad(latitude, day_of_year)
    omega = _hour_angles_midpoints()

    rt = collares_pereira_rabl_rt(omega, omega_s)
    rd = liu_jordan_rd(omega, omega_s)

    h_bh_hourly = rt * float(h_bh_day) * 1000.0
    h_dh_hourly = rd * float(h_dh_day) * 1000.0
    return h_bh_hourly, h_dh_hourly


def expand_monthly_to_yearly(
    h_bh_monthly: list[float] | np.ndarray,
    h_dh_monthly: list[float] | np.ndarray,
    latitude: float,
    year: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Expand 12 monthly-average daily values into a full yearly hourly series.

    Uses Klein's representative day per month; the resulting 24-hour pattern
    is replicated for every day of the corresponding month (vectorised via
    ``np.tile``, no Python loop over 8760 hours).

    Returns
    -------
    (bhi_yearly, dhi_yearly) : tuple of np.ndarray
        Each of length 8760 (non-leap) or 8784 (leap year).
    """
    import calendar

    h_bh_monthly = np.asarray(h_bh_monthly, dtype=float)
    h_dh_monthly = np.asarray(h_dh_monthly, dtype=float)

    bhi_parts: list[np.ndarray] = []
    dhi_parts: list[np.ndarray] = []
    for m in range(1, 13):
        doy_rep = float(KLEIN_REPRESENTATIVE_DOY[m - 1])
        bh_24, dh_24 = disaggregate_daily_to_hourly(
            float(h_bh_monthly[m - 1]),
            float(h_dh_monthly[m - 1]),
            latitude,
            doy_rep,
        )
        days_in_month = calendar.monthrange(year, m)[1]
        bhi_parts.append(np.tile(bh_24, days_in_month))
        dhi_parts.append(np.tile(dh_24, days_in_month))

    return np.concatenate(bhi_parts), np.concatenate(dhi_parts)

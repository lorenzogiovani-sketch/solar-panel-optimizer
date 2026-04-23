"""
GHI → (DNI, DHI) decomposition models.

Three pure, numpy-vectorised implementations:
  - erbs: Erbs et al. (1982) piecewise K_t → K_d, via pvlib
  - skartveit_olseth: Skartveit & Olseth (1987) piecewise with adjusted breakpoints (0.3 / 0.78)
  - ruiz_arias: Ruiz-Arias et al. (2010) sigmoidal with optional airmass correction

All functions share the same signature:
    decompose(ghi, beta_corr_deg, day_of_year, **kwargs) -> tuple[np.ndarray, np.ndarray]
    returning (dni, dhi) in W/m².  No side effects; no global state.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

import numpy as np
import pvlib


class DecompositionModel(str, Enum):
    erbs = "erbs"
    skartveit_olseth = "skartveit_olseth"
    ruiz_arias = "ruiz_arias"


# ─── helpers ──────────────────────────────────────────────────────────────────

def _clearness_index(
    ghi: np.ndarray,
    beta_corr_deg: np.ndarray,
    day_of_year: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (kt, cos_z, I0_h) for the given inputs."""
    cos_z = np.cos(np.radians(90.0 - beta_corr_deg)).clip(min=1e-6)
    I0 = np.asarray(pvlib.irradiance.get_extra_radiation(day_of_year), dtype=float)
    I0_h = I0 * cos_z
    kt = np.where(I0_h > 0, ghi / I0_h, 0.0).clip(0.0, 1.0)
    return kt, cos_z, I0_h


def _dni_from_dhi(ghi: np.ndarray, dhi: np.ndarray, cos_z: np.ndarray) -> np.ndarray:
    """DNI = (GHI - DHI) / cos(z); zero where cos_z is negligible."""
    return np.where(cos_z > 1e-4, ((ghi - dhi) / cos_z).clip(min=0.0), 0.0)


# ─── Erbs (1982) ──────────────────────────────────────────────────────────────

def erbs(
    ghi: np.ndarray,
    beta_corr_deg: np.ndarray,
    day_of_year: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Erbs et al. (1982) piecewise K_t → K_d.  Delegates to pvlib.irradiance.erbs.
    Breakpoints: K_t ≤ 0.22, 0.22 < K_t ≤ 0.80, K_t > 0.80.
    """
    ghi = np.asarray(ghi, dtype=float)
    zenith = 90.0 - np.asarray(beta_corr_deg, dtype=float)
    doy = np.asarray(day_of_year, dtype=float)

    result = pvlib.irradiance.erbs(ghi, zenith, doy)
    dni = np.asarray(result["dni"], dtype=float).clip(min=0.0)
    dhi = np.asarray(result["dhi"], dtype=float).clip(min=0.0)
    return dni, dhi


# ─── Skartveit & Olseth (1987) ────────────────────────────────────────────────

def skartveit_olseth(
    ghi: np.ndarray,
    beta_corr_deg: np.ndarray,
    day_of_year: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Skartveit & Olseth (1987) piecewise decomposition.
    Differs from Erbs in breakpoints: 0.30 and 0.78 instead of 0.22 and 0.80.
    pvlib does not expose this model natively; implemented manually.

    Invariant: for K_t in the middle segment the polynomial is the same as Erbs, but
    the domain is wider → more sky states classified as "partially cloudy".
    For series input, each element is treated independently (no variability term).
    The 1998 extension adds a temporal variability index (Δkt); it is not applied
    here because the function is intended to be pure and stateless.
    """
    ghi = np.asarray(ghi, dtype=float)
    beta_corr_deg = np.asarray(beta_corr_deg, dtype=float)
    doy = np.asarray(day_of_year, dtype=float)

    kt, cos_z, _ = _clearness_index(ghi, beta_corr_deg, doy)

    kd = np.where(
        kt <= 0.30,
        1.0 - 0.09 * kt,
        np.where(
            kt <= 0.78,
            np.maximum(
                0.165,
                0.9511 - 0.1604 * kt + 4.388 * kt**2 - 16.638 * kt**3 + 12.336 * kt**4,
            ),
            0.165,
        ),
    )

    dhi = (kd * ghi).clip(min=0.0)
    dni = _dni_from_dhi(ghi, dhi, cos_z)
    return dni, dhi


# ─── Ruiz-Arias (2010) ────────────────────────────────────────────────────────

def ruiz_arias(
    ghi: np.ndarray,
    beta_corr_deg: np.ndarray,
    day_of_year: np.ndarray,
    airmass_abs: Optional[np.ndarray] = None,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Ruiz-Arias et al. (2010) sigmoidal decomposition.
    kd = 1 / (1 + exp(-5.0033 + 8.6025·K_t - 0.00632·m))

    The airmass term shifts kd upward for low-sun conditions (more scattering),
    matching the physical expectation that diffuse fraction increases at large
    zenith angles even for the same K_t.  When airmass_abs is None, m=1 is used
    (negligible correction, equivalent to the K_t-only model).
    """
    ghi = np.asarray(ghi, dtype=float)
    beta_corr_deg = np.asarray(beta_corr_deg, dtype=float)
    doy = np.asarray(day_of_year, dtype=float)

    kt, cos_z, _ = _clearness_index(ghi, beta_corr_deg, doy)

    m = np.asarray(airmass_abs, dtype=float) if airmass_abs is not None else np.ones_like(kt)

    kd = (1.0 / (1.0 + np.exp(-5.0033 + 8.6025 * kt - 0.00632 * m))).clip(0.0, 1.0)

    dhi = (kd * ghi).clip(min=0.0)
    dni = _dni_from_dhi(ghi, dhi, cos_z)
    return dni, dhi


# ─── factory ──────────────────────────────────────────────────────────────────

def select_decomposition(model: DecompositionModel):
    """Return the decomposition callable for the requested model."""
    return {
        DecompositionModel.erbs: erbs,
        DecompositionModel.skartveit_olseth: skartveit_olseth,
        DecompositionModel.ruiz_arias: ruiz_arias,
    }[model]

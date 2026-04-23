import math
from typing import NamedTuple


class SunGeometry(NamedTuple):
    beta_deg: float       # elevazione geometrica pvlib [°]
    beta_corr_deg: float  # elevazione corretta per rifrazione (Bennett) [°]
    psi_deg: float        # azimut convenzione riferimento: 0°=S, −E, +W [°]
    zenith_deg: float     # angolo zenitale apparente = 90 − beta_corr [°]
    sun_vector: tuple     # (x, y, z) in convenzione backend Y-up


def normalize_sun_geometry(elevation_deg: float, azimuth_deg_pvlib: float) -> SunGeometry:
    """
    Normalizza la posizione solare pvlib alla convenzione del riferimento fisico (§1.2.1, Eq. 1.13–1.14).

    Applica la correzione di rifrazione atmosferica di Saemundsson/Bennett:
        Δβ = 1/tan(β + 7.31/(β+4.4))  [arcminuti]
    con limite per β < −0.575° (zona di divergenza della formula).

    Args:
        elevation_deg:     elevazione geometrica pvlib (colonna 'elevation') [°]
        azimuth_deg_pvlib: azimut pvlib (0°=N, 90°=E, 180°=S, 270°=W) [°]

    Returns:
        SunGeometry namedtuple con beta_deg, beta_corr_deg, psi_deg, zenith_deg, sun_vector.
    """
    beta = elevation_deg
    az = azimuth_deg_pvlib

    # Correzione rifrazione atmosferica Saemundsson/Bennett, Δβ in arcminuti
    if beta < -0.575:
        # Espansione asintotica per angoli sotto orizzonte: evita divergenza della formula
        delta_beta_arcmin = -20.774 / math.tan(math.radians(beta))
    else:
        denom = math.tan(math.radians(beta + 7.31 / (beta + 4.4)))
        delta_beta_arcmin = 1.0 / denom if abs(denom) > 1e-10 else 0.0

    beta_corr = beta + delta_beta_arcmin / 60.0
    psi = az - 180.0          # 0°=S; az_pvlib=90° (E) → psi=−90°; az_pvlib=270° (W) → psi=+90°
    zenith = 90.0 - beta_corr

    az_rad = math.radians(az)
    bc_rad = math.radians(beta_corr)
    sun_vec = (
        math.cos(bc_rad) * math.sin(az_rad),
        math.sin(bc_rad),
        -math.cos(bc_rad) * math.cos(az_rad),  # −Z = Nord
    )

    return SunGeometry(
        beta_deg=beta,
        beta_corr_deg=beta_corr,
        psi_deg=psi,
        zenith_deg=zenith,
        sun_vector=sun_vec,
    )

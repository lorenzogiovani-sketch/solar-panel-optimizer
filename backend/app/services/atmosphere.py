import math
from typing import Optional, Tuple


# β_A e α di default per i profili predefiniti (Tab. 1.1 e §1.2.2.3 del riferimento)
PROFILE_DEFAULTS: dict[str, tuple[float, float]] = {
    "rural":      (0.05, 1.3),
    "urban":      (0.10, 1.3),
    "industrial": (0.20, 1.3),
}


def linke_turbidity_from_angstrom(beta_a: float, alpha: float, airmass: float) -> float:
    """
    Stima il fattore di torbidezza Linke T_L da coefficienti di Ångström e massa d'aria.

    Derivazione: τ_a = β_A · (0.5 μm)^{-α} (profondità ottica aerosol broadband, λ_eff=0.5 μm
    come centroide spettrale solare); τ_R(m) = 1/(9.4+0.9·m) (Kasten 1996, spessore ottico
    Rayleigh integrale broadband). T_L = (τ_R + τ_a + τ_{w,o}) / τ_R con τ_{w,o} ≈ τ_R
    (contributo standard vapore acqueo+ozono, garantisce T_L_base ≈ 2 per aria pulita).
    """
    tau_a = beta_a * (0.5 ** (-alpha))
    tau_R = 1.0 / (9.4 + 0.9 * max(airmass, 1.0))
    tau_w_o = tau_R  # standard: vapore acqueo + ozono ≈ τ_R → T_L_base = 2
    return 1.0 + (tau_a + tau_w_o) / tau_R


def resolve_atmosphere(
    profile: Optional[str],
    beta_a: Optional[float],
    alpha: Optional[float],
) -> Tuple[float, float]:
    """
    Restituisce (β_A, α) effettivi in base al profilo o ai valori custom.

    Priorità:
    - profile in {rural, urban, industrial}: lookup in PROFILE_DEFAULTS (ignora beta_a/alpha)
    - profile == 'custom': usa beta_a e alpha forniti (alpha default 1.3 se None)
    - profile is None e beta_a is not None: usa beta_a e alpha forniti
    - profile is None e beta_a is None: ValueError

    Raises:
        ValueError: se non è possibile determinare i parametri atmosferici.
    """
    profile_key = profile.value if hasattr(profile, "value") else profile

    if profile_key is not None and profile_key in PROFILE_DEFAULTS:
        return PROFILE_DEFAULTS[profile_key]

    if beta_a is not None:
        return (beta_a, alpha if alpha is not None else 1.3)

    raise ValueError(
        "Impossibile determinare i parametri atmosferici: fornire atmosphere_profile "
        "oppure angstrom_beta."
    )


def airmass(beta_corr_deg: float, altitude_m: float = 0.0) -> float:
    """
    Calcola la massa d'aria atmosferica relativa secondo Kasten-Young con correzione altitudinale.

    Eq. 1.27 (Kasten-Young, 1989):
        m0 = 1 / (sin β + 0.50572 · (β + 6.07995)^(−1.6364))
    dove β è l'elevazione solare corretta per rifrazione, in gradi.
    Per β < 0 (sole sotto orizzonte) restituisce math.inf.

    Eq. 1.28 (correzione pressione):
        m = m0 · (p / p0)   con   p/p0 = exp(−altitude / 8434.5)
    La scala barometrica 8434.5 m corrisponde all'atmosfera isoterma standard a 288.15 K
    (H = R_air · T / g ≈ 287 · 288.15 / 9.80665).

    Args:
        beta_corr_deg: elevazione solare corretta per rifrazione [°] (da normalize_sun_geometry)
        altitude_m:    altitudine del sito in metri s.l.m. (default 0 = livello mare)

    Returns:
        Massa d'aria relativa adimensionale (≥ 1.0 per β=90°, → ∞ all'orizzonte).
    """
    if beta_corr_deg < 0:
        return math.inf

    beta_rad = math.radians(beta_corr_deg)
    m0 = 1.0 / (math.sin(beta_rad) + 0.50572 * (beta_corr_deg + 6.07995) ** (-1.6364))

    # Correzione pressione barometrica (Eq. 1.28)
    pressure_ratio = math.exp(-altitude_m / 8434.5)
    return m0 * pressure_ratio

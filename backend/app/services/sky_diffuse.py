"""
Modello di radianza diffusa del cielo di Brunger-Hooper (1993, TCCD) e fattori di
ostruzione geometrica per l'irradianza riflessa (Eq. 4.2 del riferimento).

Sostituisce il trattamento isotropo della radiazione diffusa con una distribuzione
anisotropa a griglia sulla semisfera celeste, catturando:
  - la componente circumsolare (pozzo di radianza attorno al sole)
  - il brightening all'orizzonte (aumento di radianza a grande zenith)
  - un fondo quasi-isotropo

Espone inoltre le griglie e i fattori di ostruzione usati dal modello riflesso:
  - sky_patch_grid   : semisfera celeste θ ∈ [0°, 90°]
  - ground_patch_grid: semisfera terrestre θ ∈ [90°, 180°]
  - compute_surface_obstruction_factors → (F_s,th, F_s,rh)

La griglia di default ha passo 5° in zenith × 10° in azimuth → 18×36 = 648 patch.
Scelta motivata: 5° risolve bene il picco circumsolare (FWHM ~10-20°) e il gradiente
d'orizzonte (~10° di scala), mentre 10° in azimuth è sufficiente data la simmetria
azimutale quasi completa del termine di horizon brightening; griglie più fini
(es. 2°×5° → 4050 patch) non migliorano F_s,d in modo sensibile a fronte di un
costo in ray-casting 6× maggiore.

Coordinate di scena (Y-up):
  - +Y = zenit
  - -Z = Nord, +X = Est, +Z = Sud
  - azimuth di riferimento: 0 = Nord (-Z), 90 = Est (+X), 180 = Sud (+Z)
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import numpy as np

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class SkyPatchGrid:
    """Griglia di patch sulla semisfera celeste, in coordinate Y-up."""
    zenith: np.ndarray        # (N,) rad — angolo di zenith del centro patch
    azimuth: np.ndarray       # (N,) rad — azimuth del centro patch (0=Nord)
    solid_angle: np.ndarray   # (N,) sr  — dΩ = sin(θ)·dθ·dψ
    directions: np.ndarray    # (N, 3) — versore unitario (x,y,z) verso il cielo

    def __len__(self) -> int:
        return len(self.zenith)


def sky_patch_grid(d_zenith_deg: float = 5.0, d_azimuth_deg: float = 10.0) -> SkyPatchGrid:
    """
    Genera la griglia di patch sulla semisfera celeste.

    Il centro di ogni patch è campionato al centro della cella (θ, ψ), così che
    l'integrazione numerica Σ f(θ,ψ)·sin(θ)·dθ·dψ sia di secondo ordine.

    Per θ ∈ [0, 90°] passo `d_zenith_deg` e ψ ∈ [0, 360°) passo `d_azimuth_deg`.
    Con i default (5°, 10°) → 18 × 36 = 648 patch, Σ dΩ ≈ 2π sr (semisfera).
    """
    dz = np.radians(d_zenith_deg)
    dpsi = np.radians(d_azimuth_deg)
    n_z = int(round(90.0 / d_zenith_deg))
    n_psi = int(round(360.0 / d_azimuth_deg))

    z_centers = np.radians(d_zenith_deg * (np.arange(n_z) + 0.5))
    psi_centers = np.radians(d_azimuth_deg * (np.arange(n_psi) + 0.5))

    Z, PSI = np.meshgrid(z_centers, psi_centers, indexing='ij')
    Z = Z.ravel()
    PSI = PSI.ravel()

    solid = np.sin(Z) * dz * dpsi

    # Convenzione Y-up, azimuth 0 = -Z (Nord):
    #   direzione = (sin θ · sin ψ, cos θ, -sin θ · cos ψ)
    dx = np.sin(Z) * np.sin(PSI)
    dy = np.cos(Z)
    dz_dir = -np.sin(Z) * np.cos(PSI)
    directions = np.column_stack([dx, dy, dz_dir])

    return SkyPatchGrid(zenith=Z, azimuth=PSI, solid_angle=solid, directions=directions)


def ground_patch_grid(d_zenith_deg: float = 5.0, d_azimuth_deg: float = 10.0) -> SkyPatchGrid:
    """
    Griglia di patch sulla semisfera terrestre (θ ∈ [90°, 180°]).

    Specchia la griglia celeste rispetto al piano orizzontale: usata per calcolare
    F_s,rh (frazione di orizzonte/terreno ostruita) come by-product del ray-tracing
    dello Step 7. Il centro della cella cade a (θ, ψ) con θ > 90°, direzione rivolta
    verso il basso (y < 0). Σ dΩ ≈ 2π sr (semisfera inferiore).
    """
    dz = np.radians(d_zenith_deg)
    dpsi = np.radians(d_azimuth_deg)
    n_z = int(round(90.0 / d_zenith_deg))
    n_psi = int(round(360.0 / d_azimuth_deg))

    z_centers = np.radians(90.0 + d_zenith_deg * (np.arange(n_z) + 0.5))
    psi_centers = np.radians(d_azimuth_deg * (np.arange(n_psi) + 0.5))

    Z, PSI = np.meshgrid(z_centers, psi_centers, indexing='ij')
    Z = Z.ravel()
    PSI = PSI.ravel()

    solid = np.sin(Z) * dz * dpsi

    dx = np.sin(Z) * np.sin(PSI)
    dy = np.cos(Z)  # < 0 per θ > 90°
    dz_dir = -np.sin(Z) * np.cos(PSI)
    directions = np.column_stack([dx, dy, dz_dir])

    return SkyPatchGrid(zenith=Z, azimuth=PSI, solid_angle=solid, directions=directions)


def brunger_hooper_radiance(
    patch_zenith: np.ndarray,
    patch_directions: np.ndarray,
    sun_direction: np.ndarray,
    K_d: float = 0.35,
) -> np.ndarray:
    """
    Radianza relativa del cielo secondo il modello TCCD di Brunger-Hooper (Eq. 4.45
    e §2.8.4 di docs/Riferimento.md).

    Forma implementata (polinomiale-esponenziale):

        R(θ_p, Θ) = a₀ + a₁·sin(θ_p) + a₂·exp(-a₃·Θ)

    con:
      - θ_p  = zenith della patch
      - Θ    = distanza angolare patch ↔ sole (scattering angle)
      - a₀   = 1/π  (fondo isotropo di Lambert per cielo completamente coperto)
      - a₁   = 0.6 · (1 - K_d)   → horizon brightening (0 per cielo coperto)
      - a₂   = 4.0 · (1 - K_d)   → ampiezza circumsolare
      - a₃   = 8.0               → decadimento circumsolare (rad⁻¹; FWHM ≈ 10°)

    Limite K_d → 1 (cielo coperto): R = 1/π costante → distribuzione isotropa.
    Limite K_d → 0 (cielo sereno):  forte picco circumsolare + horizon brightening.

    La scala assoluta è irrilevante per F_s,d, che è un rapporto di integrali.

    Riferimenti:
      - Brunger & Hooper (1993), Solar Energy 51(1).
      - docs/Riferimento.md §2.8.4, Eq. 4.45.
    """
    cos_Theta = np.clip(patch_directions @ sun_direction, -1.0, 1.0)
    Theta = np.arccos(cos_Theta)

    anisotropy = max(0.0, 1.0 - float(K_d))
    a0 = 1.0 / np.pi
    a1 = 0.6 * anisotropy
    a2 = 4.0 * anisotropy
    a3 = 8.0

    return a0 + a1 * np.sin(patch_zenith) + a2 * np.exp(-a3 * Theta)


def _batch_intersects_any(mesh, origins: np.ndarray, directions: np.ndarray,
                           chunk_size: Optional[int] = None) -> np.ndarray:
    """Ray-intersection vettorializzato a chunk (stesso contratto di shadow_service)."""
    if chunk_size is None:
        chunk_size = getattr(settings, 'RAYCASTING_CHUNK_SIZE', 50000)
    n = len(origins)
    if n == 0:
        return np.zeros(0, dtype=bool)
    if n <= chunk_size:
        return mesh.ray.intersects_any(ray_origins=origins, ray_directions=directions)
    out = np.empty(n, dtype=bool)
    for i in range(0, n, chunk_size):
        end = min(i + chunk_size, n)
        out[i:end] = mesh.ray.intersects_any(
            ray_origins=origins[i:end], ray_directions=directions[i:end]
        )
    return out


def compute_diffuse_shading_factor(
    cell_points: np.ndarray,
    cell_normals: np.ndarray,
    ray_mesh,
    sun_vectors: np.ndarray,
    K_d: float = 0.35,
    d_zenith_deg: float = 5.0,
    d_azimuth_deg: float = 10.0,
    normal_offset: float = 0.05,
    chunk_size: Optional[int] = None,
) -> np.ndarray:
    """
    Calcola F_s,d (fattore di ombreggiamento diffuso) per ogni cella:

        F_s,d[i] = Σ_patch visibili R·cos(γ)·dΩ  /  Σ_patch tutte R·cos(γ)·dΩ

    dove γ è l'angolo fra direzione patch e normale cella.

    Visibilità: una volta per coppia (cella, patch) — indipendente dal sole.
    Radianza: R mediata sulle posizioni solari dell'anno (o posizione fornita).
    """
    n_cells = len(cell_points)
    if n_cells == 0:
        return np.ones(0)

    grid = sky_patch_grid(d_zenith_deg, d_azimuth_deg)
    patch_dirs = grid.directions
    patch_zenith = grid.zenith
    dOmega = grid.solid_angle
    n_patches = len(grid)

    # Escludi patch con y <= 0 (sotto l'orizzonte); per θ < 90° tutti hanno y > 0
    # ma teniamo il filtro per sicurezza numerica.
    above_horizon = patch_dirs[:, 1] > 1e-6

    # cos(γ) per ogni (cella, patch)
    cos_gamma = cell_normals @ patch_dirs.T  # (N_cells, N_patches)
    above_surface = (cos_gamma > 0.01) & above_horizon[np.newaxis, :]

    # Radianza mediata sulle posizioni del sole (l'anisotropia annuale emerge qui).
    if sun_vectors is not None and len(sun_vectors) > 0:
        R = np.zeros(n_patches)
        for sv in sun_vectors:
            R += brunger_hooper_radiance(patch_zenith, patch_dirs, sv, K_d=K_d)
        R /= len(sun_vectors)
    else:
        R = np.full(n_patches, 1.0 / np.pi)

    weights = cos_gamma * dOmega[np.newaxis, :] * R[np.newaxis, :]
    weights = np.where(above_surface, weights, 0.0)

    denom = weights.sum(axis=1)  # (N_cells,)

    # Ray-casting di visibilità: per patch, raggi da tutte le celle con cos(γ)>0.
    start_points = cell_points + cell_normals * normal_offset
    numer = np.zeros(n_cells)

    for p in range(n_patches):
        if not above_horizon[p]:
            continue
        cell_mask = above_surface[:, p]
        if not np.any(cell_mask):
            continue
        idx = np.where(cell_mask)[0]
        origins = start_points[idx]
        dirs = np.broadcast_to(patch_dirs[p], (len(idx), 3))
        hit = _batch_intersects_any(ray_mesh, origins, np.ascontiguousarray(dirs),
                                     chunk_size=chunk_size)
        visible = ~hit
        numer[idx] += weights[idx, p] * visible

    with np.errstate(divide='ignore', invalid='ignore'):
        f_sd = np.where(denom > 1e-12, numer / denom, 1.0)

    return np.clip(f_sd, 0.0, 1.0)


def compute_surface_obstruction_factors(
    cell_points: np.ndarray,
    cell_normals: np.ndarray,
    ray_mesh,
    d_zenith_deg: float = 5.0,
    d_azimuth_deg: float = 10.0,
    normal_offset: float = 0.05,
    chunk_size: Optional[int] = None,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Calcola per ogni cella le frazioni di emisfero oscurate (Eq. 4.2 del riferimento).

    Restituisce (F_s_th, F_s_rh):
      - F_s_th: frazione di volta celeste (θ ∈ [0°, 90°]) oscurata da ostacoli,
        pesata geometricamente (cos γ · dΩ) senza radianza anisotropa. Usata come
        ingresso al modello riflesso di Eq. 4.2.
      - F_s_rh: frazione di emisfero terrestre (θ ∈ [90°, 180°]) oscurata da altri
        ostacoli (edificio, alberi, strutture) dal punto di vista della superficie,
        pesata da cos γ · dΩ rispetto alla normale "riflessa" verso il basso.

    Entrambi i valori sono adimensionali in [0, 1]: 0 = nessuna ostruzione,
    1 = emisfero completamente bloccato. In scena aperta F_s_th ≈ F_s_rh ≈ 0.

    Il costo computazionale è lo stesso di compute_diffuse_shading_factor ma con
    le due emisfere: il ray-cast di visibilità viene eseguito una volta per patch,
    senza dipendenza dalla posizione solare (by-product del ray-tracing Step 7).

    Mappatura dei simboli del riferimento → Python:
      - F_s,th → f_s_th (sky-hemisphere obstruction)
      - F_s,rh → f_s_rh (ground-hemisphere obstruction)
    """
    n_cells = len(cell_points)
    if n_cells == 0:
        empty = np.zeros(0)
        return empty, empty

    sky = sky_patch_grid(d_zenith_deg, d_azimuth_deg)
    ground = ground_patch_grid(d_zenith_deg, d_azimuth_deg)
    start_points = cell_points + cell_normals * normal_offset

    def _fraction_obstructed(grid: SkyPatchGrid, flip_normal_for_ground: bool) -> np.ndarray:
        dirs = grid.directions
        dOmega = grid.solid_angle

        # cos γ con la normale della superficie (sky) o con la normale riflessa
        # rispetto al piano orizzontale (ground: specchia la componente y).
        if flip_normal_for_ground:
            # Per il terreno, la "visibilità geometrica" è verso il basso: prendiamo
            # cos γ con la direzione speculare rispetto all'orizzonte (normale che
            # guarda verso terra). Qui approssimiamo con -n.y sulla componente y:
            # una cella orizzontale ha cos γ = -dir.y > 0 (patch direzione verso giù).
            n_eff = cell_normals.copy()
            n_eff[:, 1] = -np.abs(n_eff[:, 1])
            cos_gamma = n_eff @ dirs.T
        else:
            cos_gamma = cell_normals @ dirs.T

        valid = cos_gamma > 0.01
        weights = np.where(valid, cos_gamma * dOmega[np.newaxis, :], 0.0)
        denom = weights.sum(axis=1)

        blocked = np.zeros(n_cells)
        for p in range(len(grid)):
            mask = valid[:, p]
            if not np.any(mask):
                continue
            idx = np.where(mask)[0]
            origins = start_points[idx]
            dirs_p = np.broadcast_to(dirs[p], (len(idx), 3))
            hit = _batch_intersects_any(
                ray_mesh, origins, np.ascontiguousarray(dirs_p), chunk_size=chunk_size
            )
            blocked[idx] += weights[idx, p] * hit

        with np.errstate(divide='ignore', invalid='ignore'):
            frac = np.where(denom > 1e-12, blocked / denom, 0.0)
        return np.clip(frac, 0.0, 1.0)

    f_s_th = _fraction_obstructed(sky, flip_normal_for_ground=False)
    f_s_rh = _fraction_obstructed(ground, flip_normal_for_ground=True)
    return f_s_th, f_s_rh

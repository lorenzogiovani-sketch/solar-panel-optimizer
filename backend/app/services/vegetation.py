"""
Trasmissività mensile della chioma per ostacoli di tipo 'tree'.

Implementa la tabella normativa di opacità stagionale (Tab. 6.2 riferimento,
docs/Riferimento.md §6.8.3) e il mapping fra le 4 forme UI della chioma e le
due famiglie canoniche del riferimento (troncoconica, ellissoidale).

Note sui valori — Tab. 6.2 riferimento:
  Il riferimento riporta l'opacità mensile in percentuale. Per il calcolo di
  estinzione del raggio nel ray-casting serve la trasmissività τ = 1 - opacità.
  I valori qui tabellati (deciduous e evergreen) seguono la forma stagionale
  del riferimento (massima trasparenza in inverno, minima in piena estate per
  le caducifoglie; ~costante 80% ≈ 20% opacità per sempreverdi, coerente con
  "si consiglia un valore di opacità pari all'80% per tutto l'arco dell'anno"
  una volta normalizzato al contratto interno τ ∈ [0,1] usato da shadow_service).
"""
from typing import Literal, Optional, Sequence

TreeCategory = Literal['truncated_cone', 'ellipsoidal']
FoliageType = Literal['deciduous', 'evergreen']

# Tab. 6.2 riferimento — trasmissività mensile τ ∈ [0,1] (Gen..Dic)
TREE_TRANSMISSIVITY_TABLE: dict[str, list[float]] = {
    'deciduous': [0.80, 0.80, 0.75, 0.60, 0.40, 0.40,
                  0.40, 0.40, 0.45, 0.60, 0.75, 0.80],
    'evergreen': [0.80] * 12,
}

# Mapping forma UI → famiglia canonica del riferimento
UI_SHAPE_TO_CATEGORY: dict[str, TreeCategory] = {
    'cone': 'truncated_cone',
    'cono': 'truncated_cone',
    'umbrella': 'truncated_cone',
    'ombrello': 'truncated_cone',
    'sphere': 'ellipsoidal',
    'sfera': 'ellipsoidal',
    'columnar': 'ellipsoidal',
    'colonnare': 'ellipsoidal',
}


def resolve_tree_category(
    shape: Optional[str],
    category_override: Optional[TreeCategory] = None,
) -> TreeCategory:
    """Deriva la famiglia canonica (troncoconica/ellissoidale) dalla forma UI,
    con eventuale override esplicito."""
    if category_override in ('truncated_cone', 'ellipsoidal'):
        return category_override
    return UI_SHAPE_TO_CATEGORY.get((shape or 'cone').lower(), 'truncated_cone')


def resolve_tree_transmissivity(
    shape: Optional[str],
    foliage_type: FoliageType,
    override: Optional[Sequence[float]],
    month_index: int,
) -> float:
    """Ritorna la trasmissività della chioma per il mese `month_index` (0=Gen..11=Dic).

    Precedenza:
      1. `override[month_index]` se `override` è una sequenza di 12 valori in [0,1].
      2. `TREE_TRANSMISSIVITY_TABLE[foliage_type][month_index]` (Tab. 6.2 riferimento).

    Il parametro `shape` è accettato per futuri raffinamenti forma-specifici e per
    simmetria con `resolve_tree_category`; attualmente la tabella dipende solo
    da `foliage_type`, in linea con il riferimento.
    """
    if not 0 <= month_index <= 11:
        raise ValueError(f"month_index fuori range [0,11]: {month_index}")

    if override is not None and len(override) == 12:
        return float(override[month_index])

    table = TREE_TRANSMISSIVITY_TABLE.get(foliage_type)
    if table is None:
        table = TREE_TRANSMISSIVITY_TABLE['deciduous']
    return float(table[month_index])


def resolve_monthly_transmissivity(
    shape: Optional[str],
    foliage_type: FoliageType,
    override: Optional[Sequence[float]],
) -> list[float]:
    """Versione vettoriale: ritorna i 12 valori mensili τ[0..11] usando la stessa
    precedenza di `resolve_tree_transmissivity`. Utile nel ray-casting vettoriale."""
    if override is not None and len(override) == 12:
        return [float(v) for v in override]
    table = TREE_TRANSMISSIVITY_TABLE.get(foliage_type)
    if table is None:
        table = TREE_TRANSMISSIVITY_TABLE['deciduous']
    return list(table)

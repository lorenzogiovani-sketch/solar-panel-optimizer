// Coefficienti di trasmissività mensile [Gen..Dic]
// 0.0 = completamente opaco (chioma estiva densa), 1.0 = completamente trasparente (rami spogli)
export const TREE_TRANSMISSIVITY = {
  deciduous: [0.80, 0.80, 0.65, 0.40, 0.15, 0.10, 0.10, 0.10, 0.15, 0.40, 0.70, 0.80],
  evergreen: [0.18, 0.18, 0.18, 0.18, 0.15, 0.15, 0.15, 0.15, 0.18, 0.18, 0.18, 0.18],
};

// i18n keys — use t(`obstacles.${value}`) in components
export const FOLIAGE_TYPE_OPTIONS = [
  { value: 'deciduous', labelKey: 'obstacles.deciduous' },
  { value: 'evergreen', labelKey: 'obstacles.evergreen' },
];

// Forme della chioma disponibili per gli alberi
// i18n keys — use t(`obstacles.${value}`) in components
export const TREE_SHAPES = {
  cone:     { labelKey: 'obstacles.cone',     icon: '\u{1F332}' },
  sphere:   { labelKey: 'obstacles.sphere',   icon: '\u{1F333}' },
  umbrella: { labelKey: 'obstacles.umbrella', icon: '\u{1F334}' },
  columnar: { labelKey: 'obstacles.columnar', icon: '\u{1F335}' },
};

export const TREE_SHAPE_OPTIONS = Object.entries(TREE_SHAPES).map(([value, { labelKey }]) => ({
  value,
  labelKey,
}));

// i18n keys — use t(`obstacles.${key}`) in components for labels
export const OBSTACLE_DEFAULTS = {
  chimney:  { type: 'chimney',  labelKey: 'obstacles.chimney',           placement: 'roof',   dimensions: [0.6, 2, 0.6] },
  dormer:   { type: 'box',      labelKey: 'obstacles.dormer',            placement: 'roof',   dimensions: [1.5, 1, 1] },
  antenna:  { type: 'antenna',  labelKey: 'obstacles.antenna',           placement: 'roof',   dimensions: [0.3, 3, 0.3] },
  box:      { type: 'box',      labelKey: 'obstacles.box',               placement: 'roof',   dimensions: [1, 1.5, 1] },
  cylinder: { type: 'cylinder', labelKey: 'obstacles.cylinder',          placement: 'roof',   dimensions: [1, 1.5, 1] },
  tree:     { type: 'tree',     labelKey: 'obstacles.tree',              placement: 'ground', dimensions: [0.3, 10, 0.3], trunkHeight: 4, canopyRadius: 3, treeShape: 'cone', foliageType: 'deciduous', foliage_type: 'deciduous', transmissivity: [0.80, 0.80, 0.65, 0.40, 0.15, 0.10, 0.10, 0.10, 0.15, 0.40, 0.70, 0.80] },
  building: { type: 'building', labelKey: 'obstacles.adjacent_building', placement: 'ground', dimensions: [4, 8, 4] },
};

export const OBSTACLE_TYPE_OPTIONS = Object.entries(OBSTACLE_DEFAULTS).map(([key, val]) => ({
  value: key,
  labelKey: val.labelKey,
}));

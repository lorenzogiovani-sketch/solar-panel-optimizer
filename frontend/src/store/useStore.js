import { create } from 'zustand'
import { api } from '../utils/api'
import { OBSTACLE_DEFAULTS } from '../utils/obstacleDefaults'
import { computeRoofParams, computeRoofPanelTransform, computeEffectiveTiltAzimuth, computeRoofSurfaces } from '../utils/roofGeometry'
import { computeTotalLosses } from '../utils/energy'

const useStore = create((set, get) => ({
  // ─── UI State ─────────────────────────────────────────────
  ui: {
    activeTab: 'model',      // 'model' | 'obstacles' | 'simulation' | 'optimization' | 'results'
    activeCardId: 'model',   // card attualmente espansa (stesso dominio di activeTab)
    measureMode: false,
    measurements: [],         // { id, pointA: [x,y,z], pointB: [x,y,z], distance }
    pendingMeasurePoint: null, // [x,y,z] del primo click
    panelGateOpen: false,     // modale selezione pannello obbligatoria
    catalogDropdownOpen: false, // dropdown catalogo componenti nella navbar
    catalogTab: 'panels',      // 'panels' | 'inverters'
    infoOpen: false,           // modale informazioni app
    projectsModalOpen: false,  // modale gestione progetti
    sceneLocked: false,        // blocco manuale spostamento ostacoli nella scena 3D
  },
  setActiveTab: (tab) => {
    set((s) => ({ ui: { ...s.ui, activeTab: tab, activeCardId: tab } }));
  },
  setActiveCard: (cardId) => {
    const state = get();
    const next = state.ui.activeCardId === cardId ? null : cardId;
    set((s) => ({ ui: { ...s.ui, activeCardId: next, activeTab: next || s.ui.activeTab } }));
  },
  setPanelGateOpen: (open) =>
    set((state) => ({ ui: { ...state.ui, panelGateOpen: open } })),
  setCatalogDropdownOpen: (open) =>
    set((state) => ({ ui: { ...state.ui, catalogDropdownOpen: open } })),
  setCatalogTab: (tab) =>
    set((state) => ({ ui: { ...state.ui, catalogTab: tab } })),
  setInfoOpen: (open) =>
    set((state) => ({ ui: { ...state.ui, infoOpen: open } })),
  setProjectsModalOpen: (open) =>
    set((state) => ({ ui: { ...state.ui, projectsModalOpen: open } })),
  toggleSceneLock: () =>
    set((state) => ({ ui: { ...state.ui, sceneLocked: !state.ui.sceneLocked } })),

  // ─── Project Persistence (localStorage) ─────────────────
  listProjects: () => {
    try {
      const raw = localStorage.getItem('solar_optimizer_projects');
      return raw ? JSON.parse(raw).projects || [] : [];
    } catch { return []; }
  },

  saveProject: (name) => {
    const state = get();
    const projectName = name?.trim() || new Date().toLocaleDateString('it-IT');
    const savedState = {
      project: state.project,
      building: {
        width: state.building.width,
        depth: state.building.depth,
        height: state.building.height,
        roofType: state.building.roofType,
        roofAngle: state.building.roofAngle,
        ridgeHeight: state.building.ridgeHeight,
        ridgeLength: state.building.ridgeLength,
        obstacles: state.building.obstacles,
        modelAxisCorrection: state.building.modelAxisCorrection,
        modelRotationY: state.building.modelRotationY,
        modelOffsetY: state.building.modelOffsetY,
        deletedFaces: state.building.deletedFaces,
        deletionHistory: state.building.deletionHistory,
        installationPlaneY: state.building.installationPlaneY,
        hadImportedMesh: !!state.building.importedMesh,
      },
      optimization: {
        panelSpecs: state.optimization.panelSpecs,
        otherBosLosses: state.optimization.otherBosLosses,
        maxPeakPower: state.optimization.maxPeakPower,
        panels: state.optimization.panels,
        installationZones: state.optimization.installationZones,
        panelType: state.optimization.panelType,
      },
    };

    const projects = get().listProjects();
    const entry = {
      id: Date.now().toString(36),
      name: projectName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state: savedState,
    };
    projects.unshift(entry);
    localStorage.setItem('solar_optimizer_projects', JSON.stringify({ projects }));
    return entry;
  },

  loadProject: (id) => {
    const projects = get().listProjects();
    const project = projects.find((p) => p.id === id);
    if (!project) return false;
    const s = project.state;

    set((state) => ({
      project: { ...state.project, ...s.project },
      building: {
        ...state.building,
        ...s.building,
        importedMesh: state.building.importedMesh, // preserva mesh attuale
      },
      optimization: {
        ...state.optimization,
        ...s.optimization,
        status: 'idle',
        result: null,
        jobId: null,
        progress: 0,
        viewMode: 'manual',
      },
    }));
    return s.building.hadImportedMesh || false;
  },

  deleteProject: (id) => {
    const projects = get().listProjects().filter((p) => p.id !== id);
    localStorage.setItem('solar_optimizer_projects', JSON.stringify({ projects }));
  },

  // Measure Tool Actions
  toggleMeasureMode: () =>
    set((state) => ({
      ui: {
        ...state.ui,
        measureMode: !state.ui.measureMode,
        pendingMeasurePoint: state.ui.measureMode ? null : state.ui.pendingMeasurePoint,
      },
    })),
  setMeasureMode: (enabled) =>
    set((state) => ({
      ui: {
        ...state.ui,
        measureMode: enabled,
        pendingMeasurePoint: enabled ? state.ui.pendingMeasurePoint : null,
      },
    })),
  setPendingMeasurePoint: (point) =>
    set((state) => ({
      ui: { ...state.ui, pendingMeasurePoint: point },
    })),
  addMeasurement: (measurement) =>
    set((state) => ({
      ui: {
        ...state.ui,
        measurements: [...state.ui.measurements, { id: Date.now(), ...measurement }],
        pendingMeasurePoint: null,
      },
    })),
  removeLastMeasurement: () =>
    set((state) => ({
      ui: {
        ...state.ui,
        measurements: state.ui.measurements.slice(0, -1),
      },
    })),
  clearMeasurements: () =>
    set((state) => ({
      ui: { ...state.ui, measurements: [], pendingMeasurePoint: null },
    })),

  // ─── Project Parameters ───────────────────────────────────
  project: {
    latitude: 41.9,       // Roma default
    longitude: 12.5,
    tilt: 0,              // gradi
    azimuth: 180,         // gradi (180 = sud)
    timezone: 'Europe/Rome',
  },
  setProject: (params) =>
    set((state) => {
      // Invalidate per_surface irradiance when azimuth or location changes
      // (these affect the POA irradiance calculation for each roof face)
      const irrKeys = ['azimuth', 'latitude', 'longitude', 'tilt'];
      const irrChanged = irrKeys.some((k) => k in params && params[k] !== state.project[k]);
      const nextSolar = irrChanged && state.solar.irradiance?.per_surface
        ? { ...state.solar, irradiance: { ...state.solar.irradiance, per_surface: null } }
        : state.solar;

      // When azimuth changes, recalculate effective_tilt/effective_azimuth for all panels
      // so that per-face energy calculation uses the correct orientation
      const azChanged = 'azimuth' in params && params.azimuth !== state.project.azimuth;
      let nextPanels = state.optimization.panels;
      if (azChanged && nextPanels.length > 0) {
        const newAz = params.azimuth;
        nextPanels = nextPanels.map((p) => {
          const posX = p.position ? p.position[0] : (p.x ?? 0);
          const posZ = p.position ? p.position[2] : (p.z ?? 0);
          const eta = computeEffectiveTiltAzimuth(posX, posZ, state.building, newAz);
          return { ...p, effective_tilt: eta.tilt, effective_azimuth: eta.azimuth, face: eta.face };
        });
      }

      // Invalidate adopted energy when azimuth/location changes (it was computed for the old azimuth)
      const nextOptimization = irrChanged
        ? { ...state.optimization, adoptedEnergyKwh: null, panels: nextPanels }
        : azChanged
          ? { ...state.optimization, panels: nextPanels }
          : state.optimization;
      return { project: { ...state.project, ...params }, solar: nextSolar, optimization: nextOptimization };
    }),

  // ─── Building State ───────────────────────────────────────
  building: {
    width: 12,            // metri
    depth: 10,
    height: 6,
    roofType: 'flat',     // 'flat' | 'gable' | 'hip'
    roofAngle: 15,        // gradi
    ridgeHeight: 3,       // metri (solo per tetto a padiglione / hip)
    ridgeLength: 8,       // metri (solo per tetto a padiglione / hip)
    obstacles: [],
    importedMesh: null,   // mesh importato da file
    modelAxisCorrection: 'auto', // 'auto' | 'none'
    modelRotationY: 0,    // rotazione manuale aggiuntiva in gradi
    deletedFaces: [],     // indici delle facce rimosse dal modello importato
    deletionHistory: [],  // array di array, ogni entry è un gruppo di facce eliminate in una selezione
    modelOffsetY: 0,      // offset verticale modello importato (metri)
    installationPlaneY: 0, // quota piano installazione (valore numerico esplicito)
    isSelectingFaces: false, // modalità selezione area attiva
    pendingSelectionRect: null, // {x1, y1, x2, y2} in pixel relativi al canvas
    isLoading: false,
    error: null,
  },
  setBuilding: (params) =>
    set((state) => {
      // Invalidate irradiance per_surface when roof geometry changes
      const roofKeys = ['roofType', 'roofAngle', 'ridgeHeight', 'ridgeLength'];
      const roofChanged = roofKeys.some((k) => k in params && params[k] !== state.building[k]);
      const nextSolar = roofChanged && state.solar.irradiance?.per_surface
        ? { ...state.solar, irradiance: { ...state.solar.irradiance, per_surface: null } }
        : state.solar;
      return { building: { ...state.building, ...params }, solar: nextSolar };
    }),
  setModelRotation: (degrees) =>
    set((state) => {
      const newAz = ((state.project.azimuth + degrees) % 360 + 360) % 360;
      // Recalculate effective_tilt/effective_azimuth for all panels with the new rotation
      let nextPanels = state.optimization.panels;
      if (nextPanels.length > 0) {
        nextPanels = nextPanels.map((p) => {
          const posX = p.position ? p.position[0] : (p.x ?? 0);
          const posZ = p.position ? p.position[2] : (p.z ?? 0);
          const eta = computeEffectiveTiltAzimuth(posX, posZ, state.building, newAz);
          return { ...p, effective_tilt: eta.tilt, effective_azimuth: eta.azimuth, face: eta.face };
        });
      }
      return {
        building: { ...state.building, modelRotationY: degrees },
        // Invalidate per_surface irradiance and adopted energy (will be refetched by App.jsx effect)
        solar: state.solar.irradiance?.per_surface
          ? { ...state.solar, irradiance: { ...state.solar.irradiance, per_surface: null } }
          : state.solar,
        optimization: {
          ...state.optimization,
          panels: nextPanels,
          adoptedEnergyKwh: null,
        },
      };
    }),
  setModelOffsetY: (value) =>
    set((state) => ({ building: { ...state.building, modelOffsetY: value } })),
  setInstallationPlaneY: (value) =>
    set((state) => ({ building: { ...state.building, installationPlaneY: value } })),

  addObstacle: (obstacle) =>
    set((state) => {
      const defaults = OBSTACLE_DEFAULTS[obstacle.name] || OBSTACLE_DEFAULTS[obstacle.type] || {};
      const merged = {
        id: Date.now(),
        dimensions: defaults.dimensions || [1, 1, 1],
        rotation: [0, 0, 0],
        tiltAngle: 0,
        ...obstacle,
      };
      if (defaults.trunkHeight !== undefined && merged.trunkHeight === undefined) {
        merged.trunkHeight = defaults.trunkHeight;
      }
      if (defaults.canopyRadius !== undefined && merged.canopyRadius === undefined) {
        merged.canopyRadius = defaults.canopyRadius;
      }
      if (defaults.treeShape !== undefined && merged.treeShape === undefined) {
        merged.treeShape = defaults.treeShape;
      }
      if (defaults.foliageType !== undefined && merged.foliageType === undefined) {
        merged.foliageType = defaults.foliageType;
      }
      if (defaults.transmissivity !== undefined && merged.transmissivity === undefined) {
        merged.transmissivity = [...defaults.transmissivity];
      }
      return {
        building: {
          ...state.building,
          obstacles: [...state.building.obstacles, merged],
        },
      };
    }),

  removeObstacle: (id) =>
    set((state) => ({
      building: {
        ...state.building,
        obstacles: state.building.obstacles.filter((o) => o.id !== id),
      },
    })),

  updateObstacle: (id, updates) =>
    set((state) => ({
      building: {
        ...state.building,
        obstacles: state.building.obstacles.map((o) =>
          o.id === id ? { ...o, ...updates } : o
        ),
      },
    })),

  toggleFaceSelection: () =>
    set((state) => ({
      building: {
        ...state.building,
        isSelectingFaces: !state.building.isSelectingFaces,
      },
    })),

  batchDeleteFaces: (faceIndices) =>
    set((state) => {
      const existing = new Set(state.building.deletedFaces);
      const newFaces = faceIndices.filter((i) => !existing.has(i));
      if (newFaces.length === 0) return state;
      return {
        building: {
          ...state.building,
          deletedFaces: [...state.building.deletedFaces, ...newFaces],
          deletionHistory: [...state.building.deletionHistory, newFaces],
        },
      };
    }),

  undoLastSelection: () =>
    set((state) => {
      const history = state.building.deletionHistory;
      if (history.length === 0) return state;
      const lastBatch = history[history.length - 1];
      const lastBatchSet = new Set(lastBatch);
      return {
        building: {
          ...state.building,
          deletedFaces: state.building.deletedFaces.filter((i) => !lastBatchSet.has(i)),
          deletionHistory: history.slice(0, -1),
        },
      };
    }),

  resetDeletedFaces: () =>
    set((state) => ({
      building: {
        ...state.building,
        deletedFaces: [],
        deletionHistory: [],
      },
    })),

  setSelectionRect: (rect) =>
    set((state) => ({
      building: { ...state.building, pendingSelectionRect: rect },
    })),

  clearSelectionRect: () =>
    set((state) => ({
      building: { ...state.building, pendingSelectionRect: null },
    })),

  uploadModel: async (file) => {
    const { building } = get();
    set((state) => ({ building: { ...state.building, isLoading: true, error: null } }));
    try {
      const data = await api.building.uploadModel(file, building.modelAxisCorrection);
      // Calcola installationPlaneY dai bounds della mesh
      let planeY = 0;
      if (data?.vertices?.length) {
        let minY = Infinity, maxY = -Infinity;
        for (const v of data.vertices) {
          if (v[1] < minY) minY = v[1];
          if (v[1] > maxY) maxY = v[1];
        }
        planeY = maxY + 0.15;
      }
      set((state) => ({
        building: {
          ...state.building,
          importedMesh: data,
          installationPlaneY: planeY,
          isLoading: false
        }
      }));
    } catch (error) {
      set((state) => ({
        building: {
          ...state.building,
          isLoading: false,
          error: error.message
        }
      }));
    }
  },

  // ─── Solar Simulation State ───────────────────────────────
  solar: {
    sunPath: null,
    irradiance: null,
    shadows: null,
    selectedMonth: 6,     // Giugno default (1-12)
    selectedHour: 12,     // Mezzogiorno default (0-23)
    analysisMode: 'annual',     // 'annual' | 'monthly' | 'instant'
    analysisMonth: 6,           // 1-12
    analysisDay: 15,            // 1-31
    analysisHour: 12,           // 0-23 (step 0.5)
    shadowResolution: 'bassa',  // 'bassa' | 'media'
    showSunPath: false,
    showShadowHeatmap: true,
    isLoading: false,
    startTime: null,            // timestamp inizio calcolo ombre
    computationTime: null,      // tempo calcolo backend (secondi)
    error: null,
  },
  setSolar: (params) =>
    set((state) => ({ solar: { ...state.solar, ...params } })),
  toggleSunPath: () =>
    set((state) => ({ solar: { ...state.solar, showSunPath: !state.solar.showSunPath } })),
  toggleShadowHeatmap: () =>
    set((state) => ({ solar: { ...state.solar, showShadowHeatmap: !state.solar.showShadowHeatmap } })),

  setSolarTime: (month, hour) =>
    set((state) => ({
      solar: {
        ...state.solar,
        selectedMonth: month,
        selectedHour: hour
      }
    })),

  fetchSunPath: async () => {
    const { project, solar } = get();
    set({ solar: { ...solar, isLoading: true, error: null } });
    try {
      const data = await api.solar.getSunPath(project);
      set((state) => ({
        solar: { ...state.solar, sunPath: data, isLoading: false }
      }));
    } catch (error) {
      set((state) => ({
        solar: { ...state.solar, isLoading: false, error: error.message }
      }));
    }
  },

  fetchIrradiance: async () => {
    const { project, building, solar } = get();
    const effectiveBuildingAzimuth = ((project.azimuth + (building.modelRotationY || 0)) % 360 + 360) % 360;
    set({ solar: { ...solar, isLoading: true, error: null } });
    try {
      let params;
      if (!building.importedMesh && (building.roofType === 'gable' || building.roofType === 'hip')) {
        const surfaces = computeRoofSurfaces(building, effectiveBuildingAzimuth);
        params = {
          ...project,
          tilt: surfaces[0].tilt,
          azimuth: surfaces[0].azimuth,
          roof_surfaces: surfaces.map(({ tilt, azimuth, weight, face }) => ({ tilt, azimuth, weight, face })),
        };
      } else {
        params = project;
      }
      const data = await api.solar.getIrradiance(params);
      set((state) => ({
        solar: { ...state.solar, irradiance: data, isLoading: false }
      }));
    } catch (error) {
      set((state) => ({
        solar: { ...state.solar, isLoading: false, error: error.message }
      }));
    }
  },

  fetchShadows: async () => {
    const { building, project, solar, optimization } = get();
    set({ solar: { ...solar, isLoading: true, error: null, startTime: Date.now(), computationTime: null } });

    let buildingGeom;
    if (building.importedMesh) {
      buildingGeom = {
        ...building.importedMesh,
        deleted_faces: building.deletedFaces.length > 0 ? building.deletedFaces : undefined,
      };
    } else {
      buildingGeom = {
        width: building.width,
        depth: building.depth,
        height: building.height,
        roofType: building.roofType,
        roofAngle: building.roofAngle,
        ridgeHeight: building.ridgeHeight,
        ridgeLength: building.ridgeLength,
      };
    }

    const payload = {
      building: buildingGeom,
      obstacles: building.obstacles || [],
      latitude: Number(project.latitude) || 0,
      longitude: Number(project.longitude) || 0,
      grid_resolution: { bassa: 30, media: 50 }[solar.shadowResolution] || 30,
      timezone: project.timezone,
      azimuth: project.azimuth,
      model_rotation: building.modelRotationY || 0,
      model_offset_y: building.modelOffsetY || 0,
      installation_polygons: optimization.installationZones
        .filter((z) => z.vertices.length >= 3)
        .map((z) => z.vertices),
      analysis_mode: solar.analysisMode || 'annual',
      analysis_month: solar.analysisMonth || null,
      analysis_day: solar.analysisDay || null,
      analysis_hour: solar.analysisHour != null ? solar.analysisHour : null,
      ...(building.importedMesh && building.installationPlaneY != null ? { installation_plane_y: building.installationPlaneY } : {}),
    };

    try {
      const data = await api.solar.getShadows(payload);
      set((state) => ({
        solar: { ...state.solar, shadows: data, isLoading: false, computationTime: data.computation_time_s ?? null }
      }));
    } catch (error) {
      set((state) => ({
        solar: { ...state.solar, isLoading: false, startTime: null, error: error.message }
      }));
    }
  },

  // ─── Daily Simulation State ─────────────────────────────
  dailySimulation: {
    data: null,           // DailySimulationResponse dal backend
    simMonth: 6,          // Mese da simulare (1-12)
    simDay: 21,           // Giorno da simulare (1-31)
    isPlaying: false,     // Animazione play/pause
    playbackIndex: 0,     // Indice corrente nell'array hourly
    playbackSpeed: 1,     // Velocità animazione (1 = 1 step/sec)
    isLoading: false,
    startTime: null,
    computationTime: null,
    error: null,
    // Annual Surface 3D
    surfaceData: null,
    surfaceJobId: null,
    surfaceStatus: 'idle', // 'idle' | 'running' | 'completed' | 'error'
    surfaceError: null,
  },
  setDailySimulation: (params) =>
    set((state) => ({ dailySimulation: { ...state.dailySimulation, ...params } })),

  setCurrentDay: async () => {
    const now = new Date();
    set((state) => ({
      dailySimulation: { ...state.dailySimulation, simMonth: now.getMonth() + 1, simDay: now.getDate() },
    }));
    await get().fetchDailySimulation();
  },

  fetchDailySimulation: async () => {
    const { project, building, optimization, dailySimulation, inverter, solar } = get();
    set((state) => ({
      dailySimulation: { ...state.dailySimulation, isLoading: true, error: null, data: null, startTime: Date.now(), computationTime: null },
    }));

    let buildingGeom;
    if (building.importedMesh) {
      buildingGeom = {
        ...building.importedMesh,
        deleted_faces: building.deletedFaces.length > 0 ? building.deletedFaces : undefined,
      };
    } else {
      buildingGeom = {
        width: building.width,
        depth: building.depth,
        height: building.height,
        roofType: building.roofType,
        roofAngle: building.roofAngle,
        ridgeHeight: building.ridgeHeight,
        ridgeLength: building.ridgeLength,
      };
    }

    // Raccogli pannelli (manuali o ottimizzati)
    // Formato manuale: { position: [x, y, z], ... }
    // Formato ottimizzato (backend): { x, y (=z in 3D), irradiance_factor }
    const isOptimized = optimization.viewMode === 'optimized' && optimization.result;
    let panelsPayload = [];
    if (isOptimized && optimization.result.panels) {
      panelsPayload = optimization.result.panels.map((p) => ({
        x: p.x,
        y: 0, // altezza calcolata dal backend via raycast sul tetto
        z: p.y, // backend y = 3D z (North-South)
        width: optimization.panelSpecs.width,
        height: optimization.panelSpecs.height,
      }));
    } else if (optimization.panels.length > 0) {
      panelsPayload = optimization.panels.map((p) => ({
        x: p.position ? p.position[0] : (p.x ?? 0),
        y: p.position ? p.position[1] : (p.y ?? 0),
        z: p.position ? p.position[2] : (p.z ?? 0),
        width: optimization.panelSpecs.width,
        height: optimization.panelSpecs.height,
      }));
    }

    // Azimuth effettivo dell'edificio: project.azimuth + modelRotationY
    const effBuildingAz = ((project.azimuth + (building.modelRotationY || 0)) % 360 + 360) % 360;

    // Calcola tilt/azimuth effettivo dalla geometria del tetto
    // Usa la falda con migliore irradianza (per_surface dal backend) o il primo pannello
    let effectiveTilt = project.tilt;
    let effectiveAzimuth = effBuildingAz;
    if (!building.importedMesh && (building.roofType === 'gable' || building.roofType === 'hip')) {
      const perSurface = solar.irradiance?.per_surface;
      if (perSurface && perSurface.length > 0) {
        // Usa la falda con irradianza annua massima
        const best = perSurface.reduce((a, b) => a.annual_total >= b.annual_total ? a : b);
        effectiveTilt = best.tilt;
        effectiveAzimuth = best.azimuth;
      } else if (panelsPayload.length > 0) {
        const p0 = panelsPayload[0];
        const eta = computeEffectiveTiltAzimuth(p0.x, p0.z, building, effBuildingAz);
        effectiveTilt = eta.tilt;
        effectiveAzimuth = eta.azimuth;
      } else {
        const surfaces = computeRoofSurfaces(building, effBuildingAz);
        effectiveTilt = surfaces[0].tilt;
        effectiveAzimuth = surfaces[0].azimuth;
      }
    }

    // Raggruppa pannelli per effective_tilt/effective_azimuth (per-falda)
    let panelGroups = undefined;
    const allPanels = isOptimized ? optimization.result.panels : optimization.panels;
    if (allPanels && allPanels.length > 0) {
      const groupsMap = {};
      for (const p of allPanels) {
        const t = p.effective_tilt ?? effectiveTilt;
        const a = p.effective_azimuth ?? effectiveAzimuth;
        const key = `${t.toFixed(1)}_${a.toFixed(1)}`;
        if (!groupsMap[key]) groupsMap[key] = { tilt: t, azimuth: a, count: 0 };
        groupsMap[key].count++;
      }
      const groups = Object.values(groupsMap);
      if (groups.length > 1) {
        panelGroups = groups;
      }
    }

    const payload = {
      latitude: Number(project.latitude) || 0,
      longitude: Number(project.longitude) || 0,
      timezone: project.timezone,
      month: Number(dailySimulation.simMonth) || 1,
      day: Number(dailySimulation.simDay) || 1,
      tilt: effectiveTilt,
      panel_azimuth: effectiveAzimuth,
      building_azimuth: effBuildingAz,
      model_rotation: building.modelRotationY || 0,
      model_offset_y: building.modelOffsetY || 0,
      building: buildingGeom,
      obstacles: building.obstacles || [],
      panels: panelsPayload,
      panel_power_w: optimization.panelSpecs.power,
      panel_efficiency: optimization.panelSpecs.efficiency,
      temp_coefficient: optimization.panelSpecs.temp_coefficient ?? -0.4,
      noct_temperature: optimization.panelSpecs.noct_temperature ?? 45.0,
      system_losses: computeTotalLosses(optimization.otherBosLosses, inverter.datasheets, inverter.selectedId),
      installation_polygons: optimization.installationZones
        .filter((z) => z.vertices.length >= 3)
        .map((z) => z.vertices),
      panel_groups: panelGroups,
    };

    try {
      const data = await api.solar.getDailySimulation(payload);
      set((state) => ({
        dailySimulation: { ...state.dailySimulation, data, isLoading: false, playbackIndex: 0, computationTime: data.computation_time_s ?? null },
      }));
    } catch (error) {
      set((state) => ({
        dailySimulation: { ...state.dailySimulation, isLoading: false, startTime: null, error: error.message },
      }));
    }
  },

  generateAnnualSurface: async () => {
    const { project, building, optimization, inverter, solar, dailySimulation } = get();
    set((state) => ({
      dailySimulation: { ...state.dailySimulation, surfaceStatus: 'running', surfaceError: null, surfaceData: null, surfaceJobId: null },
    }));

    let buildingGeom;
    if (building.importedMesh) {
      buildingGeom = {
        ...building.importedMesh,
        deleted_faces: building.deletedFaces.length > 0 ? building.deletedFaces : undefined,
      };
    } else {
      buildingGeom = {
        width: building.width, depth: building.depth, height: building.height,
        roofType: building.roofType, roofAngle: building.roofAngle,
        ridgeHeight: building.ridgeHeight, ridgeLength: building.ridgeLength,
      };
    }

    const isOptimized = optimization.viewMode === 'optimized' && optimization.result;
    let panelsPayload = [];
    if (isOptimized && optimization.result.panels) {
      panelsPayload = optimization.result.panels.map((p) => ({
        x: p.x, y: 0, z: p.y,
        width: optimization.panelSpecs.width, height: optimization.panelSpecs.height,
      }));
    } else if (optimization.panels.length > 0) {
      panelsPayload = optimization.panels.map((p) => ({
        x: p.position ? p.position[0] : (p.x ?? 0),
        y: p.position ? p.position[1] : (p.y ?? 0),
        z: p.position ? p.position[2] : (p.z ?? 0),
        width: optimization.panelSpecs.width, height: optimization.panelSpecs.height,
      }));
    }

    const effBuildingAz = ((project.azimuth + (building.modelRotationY || 0)) % 360 + 360) % 360;
    let effectiveTilt = project.tilt;
    let effectiveAzimuth = effBuildingAz;
    if (!building.importedMesh && (building.roofType === 'gable' || building.roofType === 'hip')) {
      const perSurface = solar.irradiance?.per_surface;
      if (perSurface && perSurface.length > 0) {
        const best = perSurface.reduce((a, b) => a.annual_total >= b.annual_total ? a : b);
        effectiveTilt = best.tilt;
        effectiveAzimuth = best.azimuth;
      } else {
        const surfaces = computeRoofSurfaces(building, effBuildingAz);
        effectiveTilt = surfaces[0].tilt;
        effectiveAzimuth = surfaces[0].azimuth;
      }
    }

    let panelGroups = undefined;
    const allPanels = isOptimized ? optimization.result.panels : optimization.panels;
    if (allPanels && allPanels.length > 0) {
      const groupsMap = {};
      for (const p of allPanels) {
        const t = p.effective_tilt ?? effectiveTilt;
        const a = p.effective_azimuth ?? effectiveAzimuth;
        const key = `${t.toFixed(1)}_${a.toFixed(1)}`;
        if (!groupsMap[key]) groupsMap[key] = { tilt: t, azimuth: a, count: 0 };
        groupsMap[key].count++;
      }
      const groups = Object.values(groupsMap);
      if (groups.length > 1) panelGroups = groups;
    }

    const payload = {
      latitude: Number(project.latitude) || 0,
      longitude: Number(project.longitude) || 0,
      timezone: project.timezone,
      tilt: effectiveTilt,
      panel_azimuth: effectiveAzimuth,
      building_azimuth: effBuildingAz,
      model_rotation: building.modelRotationY || 0,
      model_offset_y: building.modelOffsetY || 0,
      building: buildingGeom,
      obstacles: building.obstacles || [],
      panels: panelsPayload,
      panel_power_w: optimization.panelSpecs.power,
      panel_efficiency: optimization.panelSpecs.efficiency,
      temp_coefficient: optimization.panelSpecs.temp_coefficient ?? -0.4,
      noct_temperature: optimization.panelSpecs.noct_temperature ?? 45.0,
      system_losses: computeTotalLosses(optimization.otherBosLosses, inverter.datasheets, inverter.selectedId),
      installation_polygons: optimization.installationZones
        .filter((z) => z.vertices.length >= 3)
        .map((z) => z.vertices),
      panel_groups: panelGroups,
    };

    try {
      const { job_id } = await api.annualSurface.run(payload);
      set((state) => ({ dailySimulation: { ...state.dailySimulation, surfaceJobId: job_id } }));

      // Polling ogni 3s
      const poll = setInterval(async () => {
        try {
          const status = await api.annualSurface.getStatus(job_id);
          if (status.status === 'completed') {
            clearInterval(poll);
            const result = await api.annualSurface.getResult(job_id);
            set((state) => ({
              dailySimulation: { ...state.dailySimulation, surfaceData: result, surfaceStatus: 'completed' },
            }));
          } else if (status.status === 'error') {
            clearInterval(poll);
            set((state) => ({
              dailySimulation: { ...state.dailySimulation, surfaceStatus: 'error', surfaceError: status.error_message || 'Errore' },
            }));
          }
        } catch (err) {
          clearInterval(poll);
          set((state) => ({
            dailySimulation: { ...state.dailySimulation, surfaceStatus: 'error', surfaceError: err.message },
          }));
        }
      }, 3000);
    } catch (error) {
      set((state) => ({
        dailySimulation: { ...state.dailySimulation, surfaceStatus: 'error', surfaceError: error.message },
      }));
    }
  },

  resetSurface: () =>
    set((state) => ({
      dailySimulation: { ...state.dailySimulation, surfaceData: null, surfaceJobId: null, surfaceStatus: 'idle', surfaceError: null },
    })),

  // ─── Economic Analysis State ─────────────────────────────
  economic: {
    annualConsumption_kWh: 3500,
    consumptionMode: 'annual',          // 'annual' | 'monthly' | 'hourly'
    monthlyConsumption_kWh: Array(12).fill(0),
    hourlyConsumption_kWh: null,        // array 8760 valori o null
    hourlyFileName: null,
    energyPrice_eur: 0.25,
    feedInTariff_eur: 0.08,
    systemCost_eur: null,
    result: null,
    isLoading: false,
    error: null,
  },
  setEconomicParams: (params) =>
    set((state) => ({ economic: { ...state.economic, ...params } })),

  fetchEconomics: async () => {
    const { economic, optimization, solar } = get();
    const isOptimized = optimization.viewMode === 'optimized' && optimization.result;
    const specs = optimization.panelSpecs;
    const totalPanels = isOptimized ? (optimization.result?.total_panels || 0) : optimization.panels.length;
    const annualEnergyKWh = isOptimized
      ? (optimization.result?.total_energy_kwh || 0)
      : (totalPanels * specs.power / 1000) * (solar.irradiance?.annual_total || 1700) * specs.efficiency;

    const MONTHLY_DIST = [0.05, 0.06, 0.08, 0.09, 0.10, 0.11, 0.11, 0.10, 0.09, 0.08, 0.07, 0.06];
    const monthlyProduction = MONTHLY_DIST.map((d) => annualEnergyKWh * d);

    set((state) => ({ economic: { ...state.economic, isLoading: true, error: null } }));

    try {
      const payload = {
        monthly_production_kwh: monthlyProduction,
        energy_price_eur: economic.energyPrice_eur,
        feed_in_tariff_eur: economic.feedInTariff_eur,
        system_cost_eur: economic.systemCost_eur || undefined,
      };
      if (economic.consumptionMode === 'hourly' && economic.hourlyConsumption_kWh) {
        payload.hourly_consumption_kwh = economic.hourlyConsumption_kWh;
      } else if (economic.consumptionMode === 'monthly') {
        payload.monthly_consumption_kwh = economic.monthlyConsumption_kWh;
      } else {
        payload.annual_consumption_kwh = economic.annualConsumption_kWh;
      }
      const data = await api.solar.getEconomics(payload);
      const updates = { result: data, isLoading: false };
      if (data.annual_consumption_kwh != null) {
        updates.annualConsumption_kWh = Math.round(data.annual_consumption_kwh);
      }
      set((state) => ({ economic: { ...state.economic, ...updates } }));
    } catch (error) {
      set((state) => ({ economic: { ...state.economic, isLoading: false, error: error.message } }));
    }
  },

  // ─── Panel Catalog State ─────────────────────────────────
  panels: {
    datasheets: [],       // Array di PanelRead dal catalogo manuale
    selectedIds: [],      // ID dei pannelli selezionati per ottimizzazione (multi-select)
    comparison: null,     // PanelComparisonResponse dal backend
    multiResults: null,   // Array di {panelId, label, panelData, result} per confronto multi-pannello GA
    isAdding: false,
    isComparing: false,
    isRunningMulti: false, // true durante ottimizzazione multi-pannello
    error: null,
  },
  setPanels: (params) =>
    set((state) => ({ panels: { ...state.panels, ...params } })),

  fetchPanels: async () => {
    try {
      const data = await api.panels.listPanels();
      set((state) => ({
        panels: { ...state.panels, datasheets: data },
      }));
    } catch (error) {
      set((state) => ({
        panels: { ...state.panels, error: error.message },
      }));
    }
  },

  addManualPanel: async (panelData) => {
    set((state) => ({ panels: { ...state.panels, isAdding: true, error: null } }));
    try {
      const data = await api.panels.addPanel(panelData);
      set((state) => ({
        panels: {
          ...state.panels,
          datasheets: [...state.panels.datasheets, data],
          isAdding: false,
        },
      }));
      return data;
    } catch (error) {
      set((state) => ({
        panels: { ...state.panels, isAdding: false, error: error.message },
      }));
      throw error;
    }
  },

  removeDatasheet: async (id) => {
    try {
      await api.panels.deletePanel(id);
    } catch {
      // Rimuoviamo dallo store anche se la delete fallisce
    }
    set((state) => ({
      panels: {
        ...state.panels,
        datasheets: state.panels.datasheets.filter((d) => d.id !== id),
        selectedIds: state.panels.selectedIds.filter((x) => x !== id),
        comparison: null,
        multiResults: null,
      },
    }));
  },

  selectPanelDatasheet: (id) => {
    const { panels } = get();
    const ds = panels.datasheets.find((d) => d.id === id);
    const current = panels.selectedIds;
    // Toggle: se già selezionato, deseleziona; altrimenti aggiungi
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    set((state) => ({ panels: { ...state.panels, selectedIds: next, multiResults: null } }));
    // Se esattamente 1 selezionato, aggiorna panelSpecs per il GA
    if (next.length === 1) {
      const selected = panels.datasheets.find((d) => d.id === next[0]);
      if (selected) {
        get().setPanelSpecs({
          width: selected.width_m,
          height: selected.height_m,
          power: selected.power_w,
          efficiency: selected.efficiency_pct / 100,
          temp_coefficient: selected.temp_coefficient ?? -0.4,
          noct_temperature: 45.0,
        });
        set((state) => ({
          optimization: { ...state.optimization, panelType: 'datasheet' },
        }));
      }
    }
  },

  compareDatasheets: async () => {
    const { panels, solar, building } = get();
    if (panels.datasheets.length < 2) return;

    const shadowGrid = solar.shadows?.shadow_grid;
    let avgShadow = 1.0;
    if (shadowGrid) {
      const flat = shadowGrid.flat();
      avgShadow = 1.0 - (flat.reduce((a, b) => a + b, 0) / flat.length);
    }

    const roofArea = building.width * building.depth;

    set((state) => ({ panels: { ...state.panels, isComparing: true, error: null } }));
    try {
      const data = await api.panels.compare({
        panel_ids: panels.datasheets.map((d) => d.id),
        annual_irradiance_kwh_m2: solar.irradiance?.annual_total || 1700,
        avg_shadow_factor: avgShadow,
        roof_area_m2: roofArea,
      });
      set((state) => ({
        panels: { ...state.panels, comparison: data, isComparing: false },
      }));
    } catch (error) {
      set((state) => ({
        panels: { ...state.panels, isComparing: false, error: error.message },
      }));
    }
  },

  // ─── Inverter Catalog State ──────────────────────────────
  inverter: {
    datasheets: [],       // lista inverter dal backend
    selectedId: null,     // inverter selezionato per il dimensionamento
    isLoading: false,
    error: null,
  },
  setInverter: (params) =>
    set((state) => ({ inverter: { ...state.inverter, ...params } })),

  fetchInverters: async () => {
    set((state) => ({ inverter: { ...state.inverter, isLoading: true, error: null } }));
    try {
      const data = await api.inverters.list();
      set((state) => ({
        inverter: { ...state.inverter, datasheets: data, isLoading: false },
      }));
    } catch (error) {
      set((state) => ({
        inverter: { ...state.inverter, isLoading: false, error: error.message },
      }));
    }
  },

  addInverter: async (inverterData) => {
    set((state) => ({ inverter: { ...state.inverter, isLoading: true, error: null } }));
    try {
      const data = await api.inverters.create(inverterData);
      set((state) => ({
        inverter: {
          ...state.inverter,
          datasheets: [...state.inverter.datasheets, data],
          isLoading: false,
        },
      }));
      return data;
    } catch (error) {
      set((state) => ({
        inverter: { ...state.inverter, isLoading: false, error: error.message },
      }));
      throw error;
    }
  },

  removeInverter: async (id) => {
    try {
      await api.inverters.delete(id);
    } catch {
      // Rimuoviamo dallo store anche se la delete fallisce
    }
    set((state) => ({
      inverter: {
        ...state.inverter,
        datasheets: state.inverter.datasheets.filter((d) => d.id !== id),
        selectedId: state.inverter.selectedId === id ? null : state.inverter.selectedId,
      },
    }));
  },

  selectInverter: (id) =>
    set((state) => ({
      inverter: { ...state.inverter, selectedId: state.inverter.selectedId === id ? null : id },
    })),

  // ─── Stringing State ────────────────────────────────────────
  stringing: {
    mode: 'auto',            // 'auto' | 'manual'
    tMinC: -10,
    tMaxC: 40,
    panelsPerString: null,   // solo per mode manuale
    stringsPerMppt: null,    // solo per mode manuale
    result: null,            // StringingResponse dal backend
    isLoading: false,
    error: null,
  },
  setStringing: (params) =>
    set((state) => ({ stringing: { ...state.stringing, ...params } })),

  calculateStringing: async () => {
    const { panels: panelsState, inverter, optimization, stringing } = get();
    // Pannello selezionato (primo della selezione)
    const selectedPanel = panelsState.datasheets.find((d) =>
      panelsState.selectedIds.includes(d.id)
    );
    const selectedInverter = inverter.datasheets.find((d) => d.id === inverter.selectedId);

    if (!selectedPanel || !selectedInverter) return;

    // Conta pannelli posizionati
    const isOptimized = optimization.viewMode === 'optimized' && optimization.result;
    const totalPanels = isOptimized
      ? (optimization.result?.total_panels || 0)
      : optimization.panels.length;

    if (totalPanels < 1) return;

    set((state) => ({ stringing: { ...state.stringing, isLoading: true, error: null, result: null } }));

    const payload = {
      mode: stringing.mode,
      voc_v: selectedPanel.voc_v,
      isc_a: selectedPanel.isc_a,
      vmpp_v: selectedPanel.vmpp_v,
      impp_a: selectedPanel.impp_a,
      power_w: selectedPanel.power_w,
      temp_coeff_voc: selectedPanel.temp_coeff_voc ?? -0.27,
      temp_coeff_isc: selectedPanel.temp_coeff_isc ?? 0.05,
      mppt_channels: selectedInverter.mppt_channels,
      mppt_voltage_min_v: selectedInverter.mppt_voltage_min_v,
      mppt_voltage_max_v: selectedInverter.mppt_voltage_max_v,
      max_input_voltage_v: selectedInverter.max_input_voltage_v,
      max_input_current_a: selectedInverter.max_input_current_a,
      max_dc_power_kw: selectedInverter.max_dc_power_kw,
      inverter_power_kw: selectedInverter.power_kw,
      t_min_c: stringing.tMinC,
      t_max_c: stringing.tMaxC,
      total_panels: totalPanels,
      ...(stringing.mode === 'manual' ? {
        panels_per_string: stringing.panelsPerString,
        strings_per_mppt: stringing.stringsPerMppt,
      } : {}),
    };

    try {
      const data = await api.stringing.calculate(payload);
      set((state) => ({ stringing: { ...state.stringing, result: data, isLoading: false } }));
    } catch (error) {
      set((state) => ({ stringing: { ...state.stringing, isLoading: false, error: error.message } }));
    }
  },

  // ─── Optimization State ───────────────────────────────────
  optimization: {
    panels: [],
    selectedPanelId: null,
    panelType: 'mono_400w',
    panelSpecs: {
      width: 1.0,          // metri
      height: 1.7,
      power: 400,          // Watt
      efficiency: 0.21,
      temp_coefficient: -0.4,  // %/°C (valore tipico pannelli monocristallini)
      noct_temperature: 45.0,  // °C (NOCT standard)
    },
    maxPeakPower: 6.0,       // limite massimo potenza di picco (kWp) per ottimizzazione
    otherBosLosses: 0.11,    // perdite BOS non-inverter: cablaggio, mismatch, sporcizia (11% default)
    adoptedEnergyKwh: null,  // energia dal backend, preservata dopo adozione layout
    jobId: null,
    status: 'idle',       // 'idle' | 'running' | 'completed' | 'error'
    progress: 0,
    result: null,
    errorMessage: null,
    startTime: null,
    computationTime: null,
    elapsedTime: null,
    estimatedRemaining: null,
    viewMode: 'manual',   // 'manual' | 'optimized'
    hasManualLayout: false,     // true se l'utente ha posizionato almeno un pannello manualmente
    manualPanelsSnapshot: [],   // snapshot dei pannelli manuali prima dell'ottimizzazione
    installationZones: [],      // [{ id, vertices: [{x,y,z}], label }]
    activeZoneId: null,         // id zona selezionata/in editing
    isDrawingPolygon: false,    // true quando l'utente sta disegnando
  },
  setOptimization: (params) =>
    set((state) => ({ optimization: { ...state.optimization, ...params } })),

  // Polygon / Zone Actions
  startDrawingPolygon: () =>
    set((state) => {
      const newZone = {
        id: Date.now(),
        vertices: [],
        label: `Zona ${state.optimization.installationZones.length + 1}`,
      };
      return {
        optimization: {
          ...state.optimization,
          isDrawingPolygon: true,
          installationZones: [...state.optimization.installationZones, newZone],
          activeZoneId: newZone.id,
        },
      };
    }),

  addPolygonVertex: (point) =>
    set((state) => ({
      optimization: {
        ...state.optimization,
        installationZones: state.optimization.installationZones.map((z) =>
          z.id === state.optimization.activeZoneId
            ? { ...z, vertices: [...z.vertices, point] }
            : z
        ),
      },
    })),

  closePolygon: () =>
    set((state) => ({
      optimization: {
        ...state.optimization,
        isDrawingPolygon: false,
      },
    })),

  clearPolygon: () =>
    set((state) => {
      const { activeZoneId, isDrawingPolygon, installationZones } = state.optimization;
      if (isDrawingPolygon && activeZoneId) {
        // Rimuovi la zona incompleta
        return {
          optimization: {
            ...state.optimization,
            installationZones: installationZones.filter((z) => z.id !== activeZoneId),
            activeZoneId: null,
            isDrawingPolygon: false,
          },
        };
      }
      return {
        optimization: { ...state.optimization, activeZoneId: null, isDrawingPolygon: false },
      };
    }),

  removeZone: (id) =>
    set((state) => ({
      optimization: {
        ...state.optimization,
        installationZones: state.optimization.installationZones.filter((z) => z.id !== id),
        activeZoneId: state.optimization.activeZoneId === id ? null : state.optimization.activeZoneId,
      },
    })),

  selectZone: (id) =>
    set((state) => ({
      optimization: { ...state.optimization, activeZoneId: id },
    })),

  clearAllZones: () =>
    set((state) => ({
      optimization: {
        ...state.optimization,
        installationZones: [],
        activeZoneId: null,
        isDrawingPolygon: false,
      },
    })),

  addPanel: (panel) =>
    set((state) => ({
      optimization: {
        ...state.optimization,
        panels: [...state.optimization.panels, { id: Date.now(), isRotated: false, ...panel }],
        adoptedEnergyKwh: null,
        hasManualLayout: true,
      },
    })),

  updatePanel: (id, updates) =>
    set((state) => ({
      optimization: {
        ...state.optimization,
        panels: state.optimization.panels.map((p) =>
          p.id === id ? { ...p, ...updates } : p
        ),
      },
    })),

  removePanel: (id) =>
    set((state) => ({
      optimization: {
        ...state.optimization,
        panels: state.optimization.panels.filter((p) => p.id !== id),
        selectedPanelId: state.optimization.selectedPanelId === id ? null : state.optimization.selectedPanelId,
        adoptedEnergyKwh: null,
      },
    })),

  clearPanels: () =>
    set((state) => ({
      optimization: {
        ...state.optimization,
        panels: [],
        selectedPanelId: null,
        result: null,
        adoptedEnergyKwh: null,
        status: 'idle',
        jobId: null,
        progress: 0,
        hasManualLayout: false,
        manualPanelsSnapshot: [],
      },
    })),

  setPanelSpecs: (specs) =>
    set((state) => ({
      optimization: {
        ...state.optimization,
        panelSpecs: { ...state.optimization.panelSpecs, ...specs },
      },
    })),

  togglePanelRotation: (id) =>
    set((state) => {
      const { panelSpecs } = state.optimization;
      return {
        optimization: {
          ...state.optimization,
          panels: state.optimization.panels.map((p) => {
            if (p.id !== id) return p;
            const isRotated = !p.isRotated;
            return {
              ...p,
              isRotated,
              dimensions: {
                ...p.dimensions,
                width: isRotated ? panelSpecs.height : panelSpecs.width,
                height: isRotated ? panelSpecs.width : panelSpecs.height,
              },
            };
          }),
        },
      };
    }),

  setViewMode: (mode) =>
    set((state) => {
      const updates = { viewMode: mode };
      if (mode === 'manual' && state.optimization.manualPanelsSnapshot.length > 0) {
        updates.panels = state.optimization.manualPanelsSnapshot;
      }
      return { optimization: { ...state.optimization, ...updates } };
    }),

  adoptOptimizedPanels: () =>
    set((state) => {
      const { result, panelSpecs } = state.optimization;
      if (!result?.panels) return state;

      const isImported = !!state.building.importedMesh;
      const roofParams = isImported ? null : computeRoofParams(state.building);
      const baseId = Date.now() * 1000;

      const adoptedPanels = [];
      for (let i = 0; i < result.panels.length; i++) {
        const p = result.panels[i];
        const posX = p.x ?? 0;
        const posZ = p.y ?? 0;

        const isLandscape = p.orientation === 'landscape';
        const pw = isLandscape ? panelSpecs.height : panelSpecs.width;
        const ph = isLandscape ? panelSpecs.width : panelSpecs.height;

        let posY, rotation;
        if (isImported) {
          posY = state.building.installationPlaneY;
          rotation = [-Math.PI / 2, 0, 0];
        } else {
          const transform = computeRoofPanelTransform(posX, posZ, pw, ph, roofParams);
          if (!transform) continue;
          posY = transform.posY;
          rotation = transform.rotation;
        }

        adoptedPanels.push({
          id: baseId + i,
          position: [posX, posY, posZ],
          rotation,
          dimensions: { width: pw, height: ph },
          isRotated: isLandscape,
          type: state.optimization.panelType,
          irradiance_factor: p.irradiance_factor ?? 1.0,
          effective_tilt: p.effective_tilt ?? null,
          effective_azimuth: p.effective_azimuth ?? null,
          source: 'adopted',
        });
      }

      return {
        optimization: {
          ...state.optimization,
          panels: adoptedPanels,
          viewMode: 'manual',
          adoptedEnergyKwh: result.total_energy_kwh ?? null,
        },
      };
    }),

  // ─── Optimization Actions ──────────────────────────────────

  runOptimization: async (params = {}) => {
    let { building, optimization, solar, inverter, project } = get();

    // Guard: ensure per-face irradiance is available for non-flat roofs
    const needsPerSurface = !building.importedMesh
      && (building.roofType === 'gable' || building.roofType === 'hip')
      && !solar.irradiance?.per_surface;
    if (needsPerSurface) {
      await get().fetchIrradiance();
      // Re-read fresh state after async fetch
      ({ solar } = get());
    }

    const payload = {
      building_geometry: {
        width: building.width,
        depth: building.depth,
        height: building.height,
        roof_type: building.roofType,
        roof_angle: building.roofAngle,
        ridge_height: building.ridgeHeight,
        ridge_length: building.ridgeLength,
      },
      shadow_grid: solar.shadows?.shadow_grid || null,
      grid_bounds: solar.shadows?.grid_bounds || null,
      obstacles: building.obstacles || [],
      panel_specs: {
        width: optimization.panelSpecs.width,
        height: optimization.panelSpecs.height,
        power: optimization.panelSpecs.power,
        efficiency: optimization.panelSpecs.efficiency,
        temp_coefficient: optimization.panelSpecs.temp_coefficient ?? -0.4,
        noct_temperature: optimization.panelSpecs.noct_temperature ?? 45.0,
      },
      constraints: {
        min_panels: 1,
        max_peak_power: params.maxPeakPower || optimization.maxPeakPower,
        min_distance: 0.1,
        roof_margin: 0.3,
      },
      annual_irradiance: solar.irradiance?.annual_total || 1700.0,
      building_azimuth: ((project.azimuth + (building.modelRotationY || 0)) % 360 + 360) % 360,
      face_irradiances: solar.irradiance?.per_surface
        ? Object.fromEntries(solar.irradiance.per_surface.map((s) => [s.face, s.annual_total]))
        : null,
      latitude: Number(project.latitude) || null,
      longitude: Number(project.longitude) || null,
      timezone: project.timezone || 'Europe/Rome',
      system_losses: computeTotalLosses(optimization.otherBosLosses, inverter.datasheets, inverter.selectedId),
      installation_polygons: optimization.installationZones
        .filter((z) => z.vertices.length >= 3)
        .map((z) => z.vertices),
      strategy: 'seed_and_grow',
    };

    set((state) => ({
      optimization: {
        ...state.optimization,
        status: 'running',
        progress: 0,
        result: null,
        errorMessage: null,
        manualPanelsSnapshot: state.optimization.hasManualLayout
          ? [...state.optimization.panels]
          : state.optimization.manualPanelsSnapshot,
        panels: [],
        jobId: null,
        startTime: Date.now(),
        computationTime: null,
        elapsedTime: null,
        estimatedRemaining: null,
      },
    }));

    try {
      const data = await api.optimize.run(payload);
      set((state) => ({
        optimization: { ...state.optimization, jobId: data.job_id },
      }));
      return data.job_id;
    } catch (error) {
      set((state) => ({
        optimization: { ...state.optimization, status: 'error', progress: 0 },
      }));
      throw error;
    }
  },

  pollOptimizationStatus: async () => {
    const { optimization } = get();
    if (!optimization.jobId) return null;

    try {
      const data = await api.optimize.getStatus(optimization.jobId);
      set((state) => ({
        optimization: {
          ...state.optimization,
          status: data.status,
          progress: data.progress,
          currentGeneration: data.current_generation ?? null,
          totalGenerations: data.total_generations ?? null,
          bestFitness: data.best_fitness ?? null,
          errorMessage: data.error_message ?? null,
          elapsedTime: data.elapsed_time_s ?? null,
          estimatedRemaining: data.estimated_remaining_s ?? null,
        },
      }));

      // Auto-fetch risultato quando l'ottimizzazione è completata
      if (data.status === 'completed') {
        await get().fetchOptimizationResult();
      }

      return data;
    } catch (error) {
      set((state) => ({
        optimization: { ...state.optimization, status: 'error' },
      }));
      return null;
    }
  },

  fetchOptimizationResult: async () => {
    const { optimization } = get();
    if (!optimization.jobId) return null;

    try {
      const data = await api.optimize.getResult(optimization.jobId);
      set((state) => ({
        optimization: {
          ...state.optimization,
          result: data,
          status: 'completed',
          progress: 100,
          viewMode: 'optimized',
          computationTime: state.optimization.elapsedTime ?? null,
        },
      }));
      return data;
    } catch (error) {
      set((state) => ({
        optimization: { ...state.optimization, status: 'error' },
      }));
      return null;
    }
  },

  applyMultiResult: (panelId) => {
    const entry = get().panels.multiResults?.find((r) => r.panelId === panelId);
    if (!entry || !entry.result) return;
    const ds = entry.panelData;
    set((state) => ({
      optimization: {
        ...state.optimization,
        result: entry.result,
        viewMode: 'optimized',
        panelSpecs: ds ? {
          width: ds.width_m,
          height: ds.height_m,
          power: ds.power_w,
          efficiency: ds.efficiency_pct / 100,
          temp_coefficient: ds.temp_coefficient ?? -0.4,
          noct_temperature: 45.0,
        } : state.optimization.panelSpecs,
      },
      panels: { ...state.panels, selectedIds: [panelId] },
    }));
  },

  // ─── Multi-Panel Optimization ────────────────────────────
  runMultiPanelOptimization: async (params = {}) => {
    const { building, optimization, solar, panels: panelsState, inverter } = get();
    const selectedPanels = panelsState.datasheets.filter((d) =>
      panelsState.selectedIds.includes(d.id)
    );
    if (selectedPanels.length === 0) return;

    set((state) => ({
      panels: { ...state.panels, isRunningMulti: true, multiResults: null, error: null },
      optimization: { ...state.optimization, status: 'running', progress: 0, result: null },
    }));

    const results = [];

    for (let i = 0; i < selectedPanels.length; i++) {
      const ds = selectedPanels[i];
      const panelSpecs = {
        width: ds.width_m,
        height: ds.height_m,
        power: ds.power_w,
        efficiency: ds.efficiency_pct / 100,
        temp_coefficient: ds.temp_coefficient ?? -0.4,
        noct_temperature: 45.0,
      };

      const payload = {
        building_geometry: {
          width: building.width,
          depth: building.depth,
          height: building.height,
          roof_type: building.roofType,
          roof_angle: building.roofAngle,
          ridge_height: building.ridgeHeight,
          ridge_length: building.ridgeLength,
        },
        shadow_grid: solar.shadows?.shadow_grid || null,
        grid_bounds: solar.shadows?.grid_bounds || null,
        obstacles: building.obstacles || [],
        panel_specs: panelSpecs,
        constraints: {
          min_panels: 1,
          max_peak_power: params.maxPeakPower || optimization.maxPeakPower,
          min_distance: 0.1,
          roof_margin: 0.3,
        },
        annual_irradiance: solar.irradiance?.annual_total || 1700.0,
        system_losses: computeTotalLosses(optimization.otherBosLosses, inverter.datasheets, inverter.selectedId),
        installation_polygons: optimization.installationZones
          .filter((z) => z.vertices.length >= 3)
          .map((z) => z.vertices),
        strategy: 'seed_and_grow',
      };

      try {
        const { job_id } = await api.optimize.run(payload);
        let done = false;

        while (!done) {
          await new Promise((r) => setTimeout(r, 2000));
          const status = await api.optimize.getStatus(job_id);
          const overallProgress = ((i + (status.progress / 100)) / selectedPanels.length) * 100;
          set((state) => ({
            optimization: {
              ...state.optimization,
              progress: Math.round(overallProgress),
              currentGeneration: status.current_generation ?? null,
              totalGenerations: status.total_generations ?? null,
              bestFitness: status.best_fitness ?? null,
            },
          }));

          if (status.status === 'completed') {
            const result = await api.optimize.getResult(job_id);
            results.push({
              panelId: ds.id,
              label: `${ds.constructor} ${ds.model}`,
              panelData: ds,
              result,
            });
            done = true;
          } else if (status.status === 'error') {
            results.push({
              panelId: ds.id,
              label: `${ds.constructor} ${ds.model}`,
              panelData: ds,
              result: null,
              error: status.error_message,
            });
            done = true;
          }
        }
      } catch (error) {
        results.push({
          panelId: ds.id,
          label: `${ds.constructor} ${ds.model}`,
          panelData: ds,
          result: null,
          error: error.message,
        });
      }
    }

    // Usa il risultato del primo pannello con successo come result principale
    const firstSuccess = results.find((r) => r.result);
    set((state) => ({
      panels: { ...state.panels, isRunningMulti: false, multiResults: results },
      optimization: {
        ...state.optimization,
        status: 'completed',
        progress: 100,
        result: firstSuccess?.result || null,
        viewMode: firstSuccess ? 'optimized' : state.optimization.viewMode,
      },
    }));
  },
}));

// Selector helpers per subscription granulari
export const useUI = () => useStore((s) => s.ui);
export const useSolar = () => useStore((s) => s.solar);
export const useBuilding = () => useStore((s) => s.building);
export const useProject = () => useStore((s) => s.project);
export const useOptimization = () => useStore((s) => s.optimization);
export const usePanels = () => useStore((s) => s.panels);
export const useDailySimulation = () => useStore((s) => s.dailySimulation);
export const useInverter = () => useStore((s) => s.inverter);
export const useStringing = () => useStore((s) => s.stringing);

export default useStore;

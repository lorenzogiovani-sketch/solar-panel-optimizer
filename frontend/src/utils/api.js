const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000') + '/api/v1';

export { API_BASE_URL };

/**
 * Helper generico per le chiamate API
 */
async function request(endpoint, method = 'GET', body = null) {
  const headers = {
    'Content-Type': 'application/json',
  };

  const config = {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  };

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `API Error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('API Request failed:', error);
    throw error;
  }
}

export const api = {
  solar: {
    getSunPath: (params) => request('/solar/sun-path', 'POST', params),
    getIrradiance: (params) => request('/solar/irradiance', 'POST', params),
    getShadows: (params) => request('/solar/shadows', 'POST', params),
    getDailySimulation: (params) => request('/solar/daily-simulation', 'POST', params),
    getEconomics: (params) => request('/solar/economics', 'POST', params),
  },
  annualSurface: {
    run: (params) => request('/annual-surface/run', 'POST', params),
    getStatus: (jobId) => request(`/annual-surface/status/${jobId}`),
    getResult: (jobId) => request(`/annual-surface/result/${jobId}`),
  },
  building: {
    uploadModel: async (file, axisCorrection = 'auto') => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('axis_correction', axisCorrection);

      const response = await fetch(`${API_BASE_URL}/building/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Upload failed: ${response.status}`);
      }
      return await response.json();
    }
  },
  optimize: {
    run: (params) => request('/optimize/run', 'POST', params),
    getStatus: (jobId) => request(`/optimize/status/${jobId}`),
    getResult: (jobId) => request(`/optimize/result/${jobId}`),
  },
  panels: {
    addPanel: (panel) => request('/panels', 'POST', panel),
    listPanels: () => request('/panels'),
    deletePanel: (id) => request(`/panels/${id}`, 'DELETE'),
    compare: (params) => request('/panels/compare', 'POST', params),
  },
  inverters: {
    list: () => request('/inverters'),
    create: (data) => request('/inverters', 'POST', data),
    delete: (id) => request(`/inverters/${id}`, 'DELETE'),
  },
  stringing: {
    calculate: (data) => request('/stringing/calculate', 'POST', data),
  },
};

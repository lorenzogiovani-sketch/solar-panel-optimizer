import React, { useEffect, useRef, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Navbar from './components/layout/Navbar'
import MainContent from './components/layout/MainContent'
import useStore from './store/useStore'
import ErrorBoundary from './components/ui/ErrorBoundary'

/* ── Toast component ───────────────────────────────────────── */
const Toast = ({ message, onClose }) => {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 9999,
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--red)',
        borderRadius: 8,
        padding: '10px 16px',
        maxWidth: 340,
        fontSize: 12,
        color: 'var(--text)',
        fontFamily: "'Outfit', sans-serif",
        backdropFilter: 'blur(12px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        animation: 'toast-in 0.3s ease-out',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--red)', fontWeight: 700, fontSize: 14 }}>✕</span>
        <span>{message}</span>
      </div>
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

function App() {
  const { t } = useTranslation()
  const fetchPanels = useStore((s) => s.fetchPanels)
  const fetchSunPath = useStore((s) => s.fetchSunPath)
  const fetchIrradiance = useStore((s) => s.fetchIrradiance)
  const latitude = useStore((s) => s.project.latitude)
  const longitude = useStore((s) => s.project.longitude)
  const roofType = useStore((s) => s.building.roofType)
  const roofAngle = useStore((s) => s.building.roofAngle)
  const ridgeHeight = useStore((s) => s.building.ridgeHeight)
  const ridgeLength = useStore((s) => s.building.ridgeLength)
  const projectTilt = useStore((s) => s.project.tilt)
  const projectAzimuth = useStore((s) => s.project.azimuth)
  const modelRotationY = useStore((s) => s.building.modelRotationY)
  const selectedMonth = useStore((s) => s.solar.selectedMonth)
  const selectedHour = useStore((s) => s.solar.selectedHour)
  const solarError = useStore((s) => s.solar.error)
  const panelsError = useStore((s) => s.panels.error)
  const buildingError = useStore((s) => s.building.error)
  const optimizationStatus = useStore((s) => s.optimization.status)

  const [toasts, setToasts] = useState([])
  const addToast = useCallback((msg) => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message: msg }])
  }, [])
  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // Track errors for toast
  const prevErrors = useRef({})
  useEffect(() => {
    const errors = { solarError, panelsError, buildingError }
    for (const [key, val] of Object.entries(errors)) {
      if (val && val !== prevErrors.current[key]) {
        addToast(val)
      }
    }
    if (optimizationStatus === 'error' && prevErrors.current.optimizationStatus !== 'error') {
      addToast(t('app.optimization_error'))
    }
    prevErrors.current = { ...errors, optimizationStatus }
  }, [solarError, panelsError, buildingError, optimizationStatus, addToast])

  // Startup: fetch panels
  useEffect(() => {
    fetchPanels()
  }, [])

  // Auto-fetch sun-path + irradiance when lat/lng change (debounced)
  const debounceRef = useRef(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchSunPath()
      fetchIrradiance()
    }, 800)
    return () => clearTimeout(debounceRef.current)
  }, [latitude, longitude])

  // Auto-fetch irradiance when roof geometry, project tilt/azimuth, or time selection changes (debounced)
  const irrDebounceRef = useRef(null)
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (irrDebounceRef.current) clearTimeout(irrDebounceRef.current)
    irrDebounceRef.current = setTimeout(() => {
      fetchIrradiance()
    }, 600)
    return () => clearTimeout(irrDebounceRef.current)
  }, [selectedMonth, selectedHour, roofType, roofAngle, ridgeHeight, ridgeLength, projectTilt, projectAzimuth, modelRotationY])

  return (
    <ErrorBoundary fallbackMessage="Si è verificato un errore critico nell'applicazione.">
      <div className="flex flex-col h-screen" style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }}>
        <Navbar />
        <div className="flex flex-1 overflow-hidden">
          <MainContent />
        </div>

        {/* Error toasts */}
        {toasts.map((t) => (
          <Toast key={t.id} message={t.message} onClose={() => removeToast(t.id)} />
        ))}
      </div>
    </ErrorBoundary>
  )
}

export default App

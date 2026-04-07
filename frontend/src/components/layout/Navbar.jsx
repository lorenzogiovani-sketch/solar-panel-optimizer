import React, { useState, useRef, useEffect } from 'react';
import { Save, Info, FolderOpen, Check, Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useStore from '../../store/useStore';
import CatalogDropdown from './CatalogDropdown';

const STEP_KEYS = [
  { id: 'model', key: 'navbar.model', num: 1 },
  { id: 'obstacles', key: 'navbar.obstacles', num: 2 },
  { id: 'simulation', key: 'navbar.simulation', num: 3 },
  { id: 'optimization', key: 'navbar.optimization', num: 4 },
  { id: 'results', key: 'navbar.results', num: 5 },
];

const Separator = () => (
  <div style={{ width: 1, height: 24, background: 'var(--border)', flexShrink: 0 }} />
);

const LanguageToggle = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('en') ? 'en' : 'it';

  const btnStyle = (active) => ({
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 600,
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : 'var(--text3)',
    transition: 'all 0.2s',
  });

  return (
    <div style={{
      display: 'flex',
      borderRadius: 6,
      border: '1px solid var(--border)',
      padding: 2,
      background: 'var(--surface2)',
      flexShrink: 0,
    }}>
      <button onClick={() => i18n.changeLanguage('it')} style={btnStyle(lang === 'it')}>IT</button>
      <button onClick={() => i18n.changeLanguage('en')} style={btnStyle(lang === 'en')}>EN</button>
    </div>
  );
};

const Navbar = () => {
  const { t } = useTranslation();
  const activeTab = useStore((s) => s.ui.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const setInfoOpen = useStore((s) => s.setInfoOpen);
  const setProjectsModalOpen = useStore((s) => s.setProjectsModalOpen);
  const saveProject = useStore((s) => s.saveProject);
  const catalogDropdownOpen = useStore((s) => s.ui.catalogDropdownOpen);
  const setCatalogDropdownOpen = useStore((s) => s.setCatalogDropdownOpen);
  const panelCount = useStore((s) => s.panels.selectedIds.length);
  const inverterId = useStore((s) => s.inverter.selectedId);
  const catalogBadge = panelCount + (inverterId ? 1 : 0);
  const catalogBtnRef = useRef(null);

  const [showNameInput, setShowNameInput] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [saved, setSaved] = useState(false);
  const inputRef = useRef(null);

  const activeIndex = STEP_KEYS.findIndex((s) => s.id === activeTab);

  useEffect(() => {
    if (showNameInput && inputRef.current) inputRef.current.focus();
  }, [showNameInput]);

  const handleSave = () => {
    saveProject(projectName);
    setProjectName('');
    setShowNameInput(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <nav
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 50,
        background: 'rgba(250,246,239,0.92)',
        borderBottom: '1px solid rgba(160,105,55,0.18)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        paddingInline: 16,
        gap: 14,
        fontFamily: "'Outfit', sans-serif",
      }}
    >
      {/* 1. Pulsante Salva Progetto */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, position: 'relative' }}>
        {showNameInput ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              ref={inputRef}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') { setShowNameInput(false); setProjectName(''); }
              }}
              placeholder={t('navbar.placeholder')}
              style={{
                width: 140,
                padding: '5px 8px',
                borderRadius: 6,
                background: 'var(--surface2)',
                border: '1px solid var(--accent)',
                color: 'var(--text1)',
                fontSize: 11,
                fontFamily: "'Outfit', sans-serif",
                outline: 'none',
              }}
            />
            <button
              onClick={handleSave}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, borderRadius: 6,
                background: 'rgba(217,119,87,0.12)', border: '1px solid var(--accent)',
                color: 'var(--accent)', cursor: 'pointer',
              }}
            >
              <Check size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowNameInput(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 6,
              background: saved ? 'rgba(184,92,53,0.1)' : 'var(--accent)',
              border: `1px solid ${saved ? 'var(--teal)' : 'var(--accent)'}`,
              color: saved ? 'var(--teal)' : '#fff',
              fontSize: 11, fontWeight: 500, cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (!saved) { e.currentTarget.style.background = 'var(--teal)'; e.currentTarget.style.borderColor = 'var(--teal)'; }
            }}
            onMouseLeave={(e) => {
              if (!saved) { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)'; }
            }}
          >
            {saved ? <Check size={14} /> : <Save size={14} />}
            {saved ? t('navbar.saved') : t('navbar.save')}
          </button>
        )}

        {/* Pulsante Progetti */}
        <button
          onClick={() => setProjectsModalOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 6,
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            color: 'var(--text2)',
            fontSize: 11, fontWeight: 500, cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent)';
            e.currentTarget.style.color = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.color = 'var(--text2)';
          }}
        >
          <FolderOpen size={14} />
          {t('navbar.projects')}
        </button>
      </div>

      <Separator />

      {/* 2. Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
        <img src="/icons/logo.png" alt="SolarOptimizer3D"
          style={{ width: 28, height: 28, borderRadius: 7, objectFit: 'contain' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.2px' }}>
          Solar<span style={{ color: 'var(--accent)' }}>Optimizer</span>
          <span style={{ color: 'var(--solar)', fontWeight: 700 }}>3D</span>
        </span>
      </div>

      <Separator />

      {/* 3. Step Indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {STEP_KEYS.map((step, i) => {
          const isActive = step.id === activeTab;
          const isCompleted = i < activeIndex;

          return (
            <button
              key={step.id}
              onClick={() => setActiveTab(step.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 6,
                border: 'none',
                background: isActive ? 'rgba(217,119,87,0.08)' : 'transparent',
                cursor: 'pointer',
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'all 0.2s',
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  fontSize: 10,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: isActive
                    ? 'var(--accent)'
                    : isCompleted
                      ? 'rgba(217,119,87,0.2)'
                      : 'var(--surface2)',
                  color: isActive
                    ? '#fff'
                    : isCompleted
                      ? 'var(--accent)'
                      : 'var(--text3)',
                  transition: 'all 0.2s',
                }}
              >
                {isCompleted ? '✓' : step.num}
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--accent)' : 'var(--text2)',
                  transition: 'color 0.2s',
                }}
              >
                {t(step.key)}
              </span>
            </button>
          );
        })}
      </div>

      {/* 4. Pulsante Catalogo Componenti */}
      <Separator />
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button
          ref={catalogBtnRef}
          onClick={() => setCatalogDropdownOpen(!catalogDropdownOpen)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 6,
            background: catalogDropdownOpen ? 'rgba(217,119,87,0.08)' : 'var(--surface2)',
            border: `1px solid ${catalogDropdownOpen ? 'var(--accent)' : 'var(--border)'}`,
            color: catalogDropdownOpen ? 'var(--accent)' : 'var(--text2)',
            fontSize: 11,
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            if (!catalogDropdownOpen) {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.color = 'var(--accent)';
            }
          }}
          onMouseLeave={(e) => {
            if (!catalogDropdownOpen) {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--text2)';
            }
          }}
        >
          <Package size={14} />
          {t('navbar.catalog')}
          {catalogBadge > 0 && (
            <span style={{
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 9,
              fontWeight: 700,
              borderRadius: 10,
              padding: '1px 6px',
              lineHeight: '14px',
            }}>
              {catalogBadge}
            </span>
          )}
        </button>
        <CatalogDropdown anchorRef={catalogBtnRef} />
      </div>

      {/* 5. Spacer */}
      <div style={{ flex: 1 }} />

      {/* 5. Language Toggle */}
      <LanguageToggle />

      {/* 6. Pulsante Info */}
      <button
        onClick={() => setInfoOpen(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 6,
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          color: 'var(--text2)',
          fontSize: 11,
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'all 0.2s',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--accent)';
          e.currentTarget.style.color = 'var(--accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--border)';
          e.currentTarget.style.color = 'var(--text2)';
        }}
      >
        <Info size={14} />
        {t('navbar.info')}
      </button>
    </nav>
  );
};

export default Navbar;

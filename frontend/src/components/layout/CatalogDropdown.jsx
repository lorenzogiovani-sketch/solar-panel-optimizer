import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Sun, Zap, Trash2, ChevronDown } from 'lucide-react';
import useStore from '../../store/useStore';
import PanelManualForm from '../optimization/PanelManualForm';
import InverterManualForm from '../optimization/InverterManualForm';

// ─── Tab button ──────────────────────────────────────────────

const TabButton = ({ active, icon: Icon, label, onClick }) => (
  <button
    onClick={onClick}
    style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      padding: '8px 0',
      border: 'none',
      borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
      background: active ? 'rgba(217,119,87,0.06)' : 'transparent',
      color: active ? 'var(--accent)' : 'var(--text3)',
      fontSize: 12,
      fontWeight: active ? 600 : 400,
      cursor: 'pointer',
      transition: 'all 0.2s',
      fontFamily: "'Outfit', sans-serif",
    }}
  >
    <Icon size={14} />
    {label}
  </button>
);

// ─── Detail grid (accordion body) ────────────────────────────

const detailGridStyle = {
  background: 'rgba(79,156,249,0.04)',
  borderTop: '1px solid var(--border)',
  padding: '8px 12px',
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '3px 16px',
};

const DetailRow = ({ label, value, unit }) => {
  if (value == null || value === '' || value === undefined) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 10, color: 'var(--text3)' }}>{label}</span>
      <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: 'var(--text2)' }}>
        {value}{unit ? ` ${unit}` : ''}
      </span>
    </div>
  );
};

const PanelDetailGrid = ({ ds }) => {
  const { t } = useTranslation();
  return (
    <div style={detailGridStyle}>
      <DetailRow label={t('catalog.detail_manufacturer')} value={ds.constructor} />
      <DetailRow label={t('catalog.detail_model')} value={ds.model} />
      <DetailRow label={t('catalog.detail_power')} value={ds.power_w} unit="W" />
      <DetailRow label={t('catalog.detail_efficiency')} value={ds.efficiency_pct} unit="%" />
      <DetailRow label={t('catalog.detail_dimensions')} value={ds.width_m && ds.height_m ? `${ds.width_m} × ${ds.height_m}` : null} unit="m" />
      <DetailRow label={t('catalog.detail_weight')} value={ds.weight_kg} unit="kg" />
      <DetailRow label={t('catalog.detail_op_temp')} value={ds.op_temperature_c} />
      <DetailRow label={t('catalog.detail_temp_coeff')} value={ds.temp_coefficient} unit="%/°C" />
      <DetailRow label={t('catalog.detail_degradation')} value={ds.degradation_pct} unit="%/a" />
      <DetailRow label={t('catalog.detail_warranty')} value={ds.warranty_years} unit={t('common.years')} />
      <DetailRow label={t('catalog.detail_voc')} value={ds.voc_v} unit="V" />
      <DetailRow label={t('catalog.detail_isc')} value={ds.isc_a} unit="A" />
      <DetailRow label={t('catalog.detail_vmpp')} value={ds.vmpp_v} unit="V" />
      <DetailRow label={t('catalog.detail_impp')} value={ds.impp_a} unit="A" />
      <DetailRow label={t('catalog.detail_temp_coeff_voc')} value={ds.temp_coeff_voc} unit="%/°C" />
      <DetailRow label={t('catalog.detail_temp_coeff_isc')} value={ds.temp_coeff_isc} unit="%/°C" />
    </div>
  );
};

const InverterDetailGrid = ({ inv }) => {
  const { t } = useTranslation();
  return (
    <div style={detailGridStyle}>
      <DetailRow label={t('catalog.detail_manufacturer')} value={inv.constructor} />
      <DetailRow label={t('catalog.detail_model')} value={inv.model} />
      <DetailRow label={t('catalog.detail_power_ac')} value={inv.power_kw} unit="kW" />
      <DetailRow label={t('catalog.detail_max_dc_power')} value={inv.max_dc_power_kw} unit="kW" />
      <DetailRow label={t('catalog.detail_mppt_channels')} value={inv.mppt_channels} />
      <DetailRow label={t('catalog.detail_mppt_range')} value={inv.mppt_voltage_min_v && inv.mppt_voltage_max_v ? `${inv.mppt_voltage_min_v}–${inv.mppt_voltage_max_v}` : null} unit="V" />
      <DetailRow label={t('catalog.detail_max_voltage')} value={inv.max_input_voltage_v} unit="V" />
      <DetailRow label={t('catalog.detail_max_current')} value={inv.max_input_current_a} unit="A" />
      <DetailRow label={t('catalog.detail_efficiency')} value={inv.efficiency_pct} unit="%" />
      <DetailRow label={t('catalog.detail_weight')} value={inv.weight_kg} unit="kg" />
      <DetailRow label={t('catalog.detail_warranty')} value={inv.warranty_years} unit={t('common.years')} />
    </div>
  );
};

// ─── Panels List ─────────────────────────────────────────────

const PanelsList = () => {
  const { t } = useTranslation();
  const datasheets = useStore((s) => s.panels.datasheets);
  const selectedIds = useStore((s) => s.panels.selectedIds);
  const selectPanelDatasheet = useStore((s) => s.selectPanelDatasheet);
  const removeDatasheet = useStore((s) => s.removeDatasheet);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  if (showForm) {
    return (
      <div style={{ padding: 12 }}>
        <PanelManualForm onClose={() => setShowForm(false)} />
      </div>
    );
  }

  return (
    <>
      <div style={{ padding: '0 14px', flex: 1, overflowY: 'auto' }}>
        {datasheets.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text3)', fontSize: 11 }}>
            {t('gate.no_panels')}
            <br />
            {t('gate.no_panels_hint')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBlock: 6 }}>
            {datasheets.map((ds) => {
              const isSelected = selectedIds.includes(ds.id);
              const isExpanded = expandedId === ds.id;
              return (
                <div
                  key={ds.id}
                  style={{
                    border: `1px solid ${isSelected ? 'rgba(184,92,53,0.4)' : 'var(--border)'}`,
                    background: isSelected ? 'rgba(184,92,53,0.06)' : 'transparent',
                    borderRadius: 8,
                    overflow: 'hidden',
                    transition: 'all 0.15s',
                  }}
                >
                  <div
                    style={{
                      padding: '8px 10px',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div
                      style={{ minWidth: 0, flex: 1 }}
                      onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : ds.id); }}
                    >
                      <div style={{
                        fontSize: 11, fontWeight: 600, color: 'var(--text)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        <ChevronDown size={10} style={{
                          transition: 'transform 0.2s',
                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          flexShrink: 0, color: 'var(--text3)',
                        }} />
                        {ds.constructor} {ds.model}
                      </div>
                      <div style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 9, color: 'var(--text2)', marginTop: 2, paddingLeft: 14,
                      }}>
                        {ds.efficiency_pct}% eff · {ds.width_m} x {ds.height_m} m
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 12, fontWeight: 700, color: 'var(--solar)',
                      }}>
                        {ds.power_w} W
                      </span>
                      <div
                        onClick={(e) => { e.stopPropagation(); selectPanelDatasheet(ds.id); }}
                        style={{
                          width: 16, height: 16, borderRadius: 4,
                          border: `1.5px solid ${isSelected ? 'var(--teal)' : 'var(--border-hi)'}`,
                          background: isSelected ? 'var(--teal)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 9, color: '#fff', transition: 'all 0.15s', cursor: 'pointer',
                        }}
                      >
                        {isSelected && '✓'}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeDatasheet(ds.id); }}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--text3)', padding: 2, display: 'flex',
                          transition: 'color 0.2s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text3)'; }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  {isExpanded && <PanelDetailGrid ds={ds} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ padding: '8px 14px 12px' }}>
        <button
          onClick={() => setShowForm(true)}
          style={{
            width: '100%',
            padding: '8px 0',
            borderRadius: 8,
            border: '1px dashed var(--border-hi)',
            background: 'transparent',
            color: 'var(--text2)',
            fontFamily: "'Outfit', sans-serif",
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {t('catalog.add_panel')}
        </button>
      </div>
    </>
  );
};

// ─── Inverters List ──────────────────────────────────────────

const InvertersList = () => {
  const { t } = useTranslation();
  const datasheets = useStore((s) => s.inverter.datasheets);
  const selectedId = useStore((s) => s.inverter.selectedId);
  const selectInverter = useStore((s) => s.selectInverter);
  const removeInverter = useStore((s) => s.removeInverter);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  if (showForm) {
    return (
      <div style={{ padding: 12 }}>
        <InverterManualForm onClose={() => setShowForm(false)} />
      </div>
    );
  }

  return (
    <>
      <div style={{ padding: '0 14px', flex: 1, overflowY: 'auto' }}>
        {datasheets.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text3)', fontSize: 11 }}>
            {t('catalog.no_inverters')}
            <br />
            {t('catalog.no_inverters_hint')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBlock: 6 }}>
            {datasheets.map((inv) => {
              const isSelected = selectedId === inv.id;
              const isExpanded = expandedId === inv.id;
              return (
                <div
                  key={inv.id}
                  style={{
                    border: `1px solid ${isSelected ? 'rgba(167,139,250,0.4)' : 'var(--border)'}`,
                    background: isSelected ? 'rgba(167,139,250,0.06)' : 'transparent',
                    borderRadius: 8,
                    overflow: 'hidden',
                    transition: 'all 0.15s',
                  }}
                >
                  <div
                    style={{
                      padding: '8px 10px',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div
                      style={{ minWidth: 0, flex: 1 }}
                      onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : inv.id); }}
                    >
                      <div style={{
                        fontSize: 11, fontWeight: 600, color: 'var(--text)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        <ChevronDown size={10} style={{
                          transition: 'transform 0.2s',
                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          flexShrink: 0, color: 'var(--text3)',
                        }} />
                        {inv.constructor} {inv.model}
                      </div>
                      <div style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 9, color: 'var(--text2)', marginTop: 2, paddingLeft: 14,
                      }}>
                        {inv.mppt_channels} MPPT · {inv.efficiency_pct}% eff
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 12, fontWeight: 700, color: '#A78BFA',
                      }}>
                        {inv.power_kw} kW
                      </span>
                      <div
                        onClick={(e) => { e.stopPropagation(); selectInverter(inv.id); }}
                        style={{
                          width: 16, height: 16, borderRadius: 4,
                          border: `1.5px solid ${isSelected ? '#A78BFA' : 'var(--border-hi)'}`,
                          background: isSelected ? '#A78BFA' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 9, color: '#fff', transition: 'all 0.15s', cursor: 'pointer',
                        }}
                      >
                        {isSelected && '✓'}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeInverter(inv.id); }}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--text3)', padding: 2, display: 'flex',
                          transition: 'color 0.2s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text3)'; }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  {isExpanded && <InverterDetailGrid inv={inv} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ padding: '8px 14px 12px' }}>
        <button
          onClick={() => setShowForm(true)}
          style={{
            width: '100%',
            padding: '8px 0',
            borderRadius: 8,
            border: '1px dashed var(--border-hi)',
            background: 'transparent',
            color: 'var(--text2)',
            fontFamily: "'Outfit', sans-serif",
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {t('catalog.add_inverter')}
        </button>
      </div>
    </>
  );
};

// ─── Main Dropdown ───────────────────────────────────────────

const CatalogDropdown = ({ anchorRef }) => {
  const { t } = useTranslation();
  const open = useStore((s) => s.ui.catalogDropdownOpen);
  const activeTab = useStore((s) => s.ui.catalogTab);
  const setCatalogDropdownOpen = useStore((s) => s.setCatalogDropdownOpen);
  const setCatalogTab = useStore((s) => s.setCatalogTab);
  const fetchPanels = useStore((s) => s.fetchPanels);
  const fetchInverters = useStore((s) => s.fetchInverters);
  const dropdownRef = useRef(null);

  // Fetch data on open
  useEffect(() => {
    if (open) {
      fetchPanels();
      fetchInverters();
    }
  }, [open, fetchPanels, fetchInverters]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        anchorRef?.current && !anchorRef.current.contains(e.target)
      ) {
        setCatalogDropdownOpen(false);
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setCatalogDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, setCatalogDropdownOpen, anchorRef]);

  if (!open) return null;

  return (
    <div
      ref={dropdownRef}
      style={{
        position: 'absolute',
        top: '100%',
        marginTop: 6,
        right: 0,
        width: 400,
        maxHeight: 520,
        background: 'rgba(250,246,239,0.97)',
        border: '1px solid rgba(160,105,55,0.18)',
        borderRadius: 12,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 12px 40px rgba(100,60,20,0.15)',
        zIndex: 300,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: "'Outfit', sans-serif",
      }}
    >
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
        <TabButton
          active={activeTab === 'panels'}
          icon={Sun}
          label={t('catalog.panels_tab')}
          onClick={() => setCatalogTab('panels')}
        />
        <TabButton
          active={activeTab === 'inverters'}
          icon={Zap}
          label={t('catalog.inverters_tab')}
          onClick={() => setCatalogTab('inverters')}
        />
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: 460, overflowY: 'auto' }}>
        {activeTab === 'panels' ? <PanelsList /> : <InvertersList />}
      </div>
    </div>
  );
};

export default CatalogDropdown;

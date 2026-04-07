import React, { createContext, useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Loader2 } from 'lucide-react';
import useStore from '../../store/useStore';

// ─── Form context ────────────────────────────────────────────

const INITIAL = {
  constructor: '',
  model: '',
  power_kw: '',
  max_dc_power_kw: '',
  mppt_channels: '',
  mppt_voltage_min_v: '',
  mppt_voltage_max_v: '',
  max_input_voltage_v: '',
  max_input_current_a: '',
  efficiency_pct: '',
  weight_kg: '',
  warranty_years: '',
};

const FormContext = createContext(null);

const useFormContext = () => {
  const ctx = useContext(FormContext);
  if (!ctx) throw new Error('InverterManualForm compound component must be used inside InverterManualForm');
  return ctx;
};

// ─── Style helpers ───────────────────────────────────────────

const inputStyle = {
  width: '100%',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 12,
  color: 'var(--text)',
  outline: 'none',
  fontFamily: "'Outfit', sans-serif",
  boxSizing: 'border-box',
  transition: 'border-color 0.2s',
};

const labelStyle = {
  fontSize: 11,
  color: 'var(--text2)',
  display: 'block',
  marginBottom: 3,
};

const sectionLabel = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '1px',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  margin: 0,
  paddingTop: 4,
};

// ─── Compound sub-components ─────────────────────────────────

const Header = ({ onClose }) => {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
        {t('inverter_form.title')}
      </h3>
      <button
        onClick={onClose}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text3)', padding: 2, display: 'flex',
          transition: 'color 0.2s',
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
};

const Field = ({ label, name, type = 'text', placeholder, step, required }) => {
  const { fields, setField } = useFormContext();
  return (
    <div>
      <label style={labelStyle}>
        {label}{required && <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span>}
      </label>
      <input
        type={type}
        value={fields[name]}
        onChange={(e) => setField(name, e.target.value)}
        placeholder={placeholder}
        step={step}
        style={inputStyle}
      />
    </div>
  );
};

const Fields = () => {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Identificazione */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field name="constructor" label={t('inverter_form.manufacturer')} placeholder={t('inverter_form.manufacturer_placeholder')} required />
        <Field name="model"       label={t('inverter_form.model')}        placeholder={t('inverter_form.model_placeholder')} required />
      </div>

      {/* Potenza */}
      <p style={sectionLabel}>{t('panel_form.electrical_data')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field name="power_kw"        label={t('inverter_form.power_ac')}      type="number" placeholder="6"   step="0.1" required />
        <Field name="max_dc_power_kw" label={t('inverter_form.max_dc_power')}  type="number" placeholder="9"   step="0.1" required />
      </div>
      <Field name="mppt_channels" label={t('inverter_form.mppt_channels')} type="number" placeholder="2" step="1" required />

      {/* Limiti tensione/corrente */}
      <p style={sectionLabel}>{t('inverter_form.mppt_section')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field name="mppt_voltage_min_v" label={t('inverter_form.mppt_voltage_min')} type="number" placeholder="140" step="1" required />
        <Field name="mppt_voltage_max_v" label={t('inverter_form.mppt_voltage_max')} type="number" placeholder="580" step="1" required />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field name="max_input_voltage_v" label={t('inverter_form.max_input_voltage')} type="number" placeholder="600" step="1" required />
        <Field name="max_input_current_a" label={t('inverter_form.max_input_current')} type="number" placeholder="11" step="0.1" required />
      </div>

      {/* Altro */}
      <p style={sectionLabel}>{t('panel_form.physical_data')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field name="efficiency_pct" label={t('inverter_form.efficiency')} type="number" placeholder="97.5" step="0.1" />
        <Field name="weight_kg"      label={t('inverter_form.weight')}     type="number" placeholder="15"   step="0.1" />
      </div>
      <Field name="warranty_years" label={t('inverter_form.warranty')} type="number" placeholder="10" step="1" />

      {/* Legenda asterischi */}
      <div style={{ display: 'flex', gap: 12, fontSize: 9, color: 'var(--text3)', paddingTop: 4 }}>
        <span><span style={{ color: 'var(--red)' }}>*</span> {t('inverter_form.legend_required')}</span>
      </div>
    </div>
  );
};

const ErrorMessage = () => {
  const { error } = useFormContext();
  if (!error) return null;
  return (
    <div style={{
      fontSize: 11, color: 'var(--red)',
      background: 'rgba(201,64,48,0.08)',
      border: '1px solid rgba(201,64,48,0.2)',
      borderRadius: 6, padding: '6px 10px',
    }}>
      {error}
    </div>
  );
};

const Actions = ({ onClose }) => {
  const { handleSubmit, isAdding } = useFormContext();
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', gap: 8, paddingTop: 8 }}>
      <button
        onClick={onClose}
        style={{
          flex: 1, padding: '8px 0', borderRadius: 6,
          border: '1px solid var(--border-hi)',
          background: 'transparent', color: 'var(--text2)',
          fontSize: 12, cursor: 'pointer', transition: 'all 0.2s',
          fontFamily: "'Outfit', sans-serif",
        }}
      >
        {t('inverter_form.cancel')}
      </button>
      <button
        onClick={handleSubmit}
        disabled={isAdding}
        style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '8px 0', borderRadius: 6,
          background: 'var(--accent)', color: '#fff',
          border: '1px solid var(--accent)',
          fontSize: 12, fontWeight: 500, cursor: isAdding ? 'not-allowed' : 'pointer',
          opacity: isAdding ? 0.6 : 1, transition: 'all 0.2s',
          fontFamily: "'Outfit', sans-serif",
        }}
      >
        {isAdding ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />}
        {isAdding ? t('inverter_form.adding') : t('inverter_form.add')}
      </button>
    </div>
  );
};

// ─── Root component (provider) ───────────────────────────────

const InverterManualForm = ({ onClose }) => {
  const { t } = useTranslation();
  const addInverter = useStore((s) => s.addInverter);
  const inverterState = useStore((s) => s.inverter);
  const [fields, setFields] = useState(INITIAL);
  const [localError, setLocalError] = useState(null);

  const setField = (name, value) => setFields((prev) => ({ ...prev, [name]: value }));

  const handleSubmit = async () => {
    setLocalError(null);
    if (!fields.constructor.trim() || !fields.model.trim()) {
      setLocalError(t('inverter_form.error_required'));
      return;
    }
    const power = parseFloat(fields.power_kw);
    const maxDc = parseFloat(fields.max_dc_power_kw);
    const mppt  = parseInt(fields.mppt_channels, 10);
    const vMin  = parseFloat(fields.mppt_voltage_min_v);
    const vMax  = parseFloat(fields.mppt_voltage_max_v);
    const maxV  = parseFloat(fields.max_input_voltage_v);
    const maxI  = parseFloat(fields.max_input_current_a);
    if (!power || !maxDc || !mppt || !vMin || !vMax || !maxV || !maxI) {
      setLocalError(t('inverter_form.error_numbers'));
      return;
    }

    const payload = {
      constructor:        fields.constructor.trim(),
      model:              fields.model.trim(),
      power_kw:           power,
      max_dc_power_kw:    maxDc,
      mppt_channels:      mppt,
      mppt_voltage_min_v: vMin,
      mppt_voltage_max_v: vMax,
      max_input_voltage_v: maxV,
      max_input_current_a: maxI,
      efficiency_pct:     fields.efficiency_pct ? parseFloat(fields.efficiency_pct) : null,
      weight_kg:          fields.weight_kg      ? parseFloat(fields.weight_kg)      : null,
      warranty_years:     fields.warranty_years  ? parseInt(fields.warranty_years, 10) : null,
    };

    try {
      await addInverter(payload);
      onClose();
    } catch {
      // errore già in inverter.error
    }
  };

  const contextValue = {
    fields,
    setField,
    handleSubmit,
    isAdding: inverterState.isLoading,
    error: localError || inverterState.error,
  };

  return (
    <FormContext.Provider value={contextValue}>
      <div style={{
        background: 'var(--glass-hi)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid var(--border)',
        borderRadius: 10, padding: 16,
        display: 'flex', flexDirection: 'column', gap: 12,
        boxShadow: '0 0 0 1px rgba(160,105,55,0.1), 0 20px 60px rgba(100,60,20,0.18)',
      }}>
        <Header onClose={onClose} />
        <Fields />
        <ErrorMessage />
        <Actions onClose={onClose} />
      </div>
    </FormContext.Provider>
  );
};

InverterManualForm.Header  = Header;
InverterManualForm.Fields  = Fields;
InverterManualForm.Actions = Actions;

export default InverterManualForm;

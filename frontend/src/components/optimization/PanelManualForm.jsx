import React, { createContext, useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Loader2 } from 'lucide-react';
import useStore from '../../store/useStore';

// ─── Form context ────────────────────────────────────────────

const INITIAL = {
  constructor: '',
  model: '',
  power_w: '',
  efficiency_pct: '',
  width_m: '',
  height_m: '',
  weight_kg: '',
  op_temperature_c: '',
  temp_coefficient: '',
  warranty_years: '',
  degradation_pct: '',
  voc_v: '',
  isc_a: '',
  vmpp_v: '',
  impp_a: '',
  temp_coeff_voc: '',
  temp_coeff_isc: '',
};

const FormContext = createContext(null);

const useFormContext = () => {
  const ctx = useContext(FormContext);
  if (!ctx) throw new Error('PanelManualForm compound component must be used inside PanelManualForm');
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
        {t('panel_form.title')}
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

const Field = ({ label, name, type = 'text', placeholder, step, required, stringing }) => {
  const { fields, setField } = useFormContext();
  const { t } = useTranslation();
  return (
    <div>
      <label style={labelStyle}>
        {label}
        {required && <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span>}
        {stringing && (
          <span
            style={{ color: 'var(--solar)', marginLeft: 2, cursor: 'help' }}
            title={t('tooltips.stringing_field')}
          >*</span>
        )}
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
        <Field name="constructor" label={t('panel_form.manufacturer')} placeholder={t('panel_form.manufacturer_placeholder')} required />
        <Field name="model"       label={t('panel_form.model')}        placeholder={t('panel_form.model_placeholder')} required />
      </div>

      {/* Elettrica */}
      <p style={sectionLabel}>{t('panel_form.electrical_data')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field name="power_w"        label={t('panel_form.power')}      type="number" placeholder="400"  step="1"    required />
        <Field name="efficiency_pct" label={t('panel_form.efficiency')} type="number" placeholder="21.4" step="0.1"  required />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field name="temp_coefficient" label={t('panel_form.temp_coeff')}  type="number" placeholder="-0.35" step="0.01" />
        <Field name="degradation_pct"  label={t('panel_form.degradation')} type="number" placeholder="0.5"   step="0.05" />
      </div>

      {/* Parametri elettrici IV */}
      <p style={sectionLabel}>{t('panel_form.iv_section')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field name="voc_v"  label={t('panel_form.voc')}  type="number" placeholder="41.5" step="0.1" stringing />
        <Field name="isc_a"  label={t('panel_form.isc')}  type="number" placeholder="11.2" step="0.1" stringing />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field name="vmpp_v" label={t('panel_form.vmpp')} type="number" placeholder="34.8" step="0.1" stringing />
        <Field name="impp_a" label={t('panel_form.impp')} type="number" placeholder="11.0" step="0.1" stringing />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field name="temp_coeff_voc" label={t('panel_form.temp_coeff_voc')} type="number" placeholder="-0.27" step="0.01" stringing />
        <Field name="temp_coeff_isc" label={t('panel_form.temp_coeff_isc')} type="number" placeholder="0.05"  step="0.01" stringing />
      </div>
      <p style={{ fontSize: 10, color: 'var(--text3)', margin: 0, fontStyle: 'italic' }}>
        {t('panel_form.iv_hint')}
      </p>

      {/* Fisica */}
      <p style={sectionLabel}>{t('panel_form.physical_data')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field name="width_m"  label={t('panel_form.width')}  type="number" placeholder="1.13" step="0.01" required />
        <Field name="height_m" label={t('panel_form.height')} type="number" placeholder="1.72" step="0.01" required />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field name="weight_kg"       label={t('panel_form.weight')}   type="number" placeholder="21.3" step="0.1" />
        <Field name="op_temperature_c" label={t('panel_form.op_temp')} type="text"   placeholder={t('panel_form.op_temp_placeholder')} />
      </div>

      {/* Garanzia */}
      <p style={sectionLabel}>{t('panel_form.warranty_section')}</p>
      <Field name="warranty_years" label={t('panel_form.warranty')} type="number" placeholder="25" step="1" />

      {/* Legenda asterischi */}
      <div style={{ display: 'flex', gap: 12, fontSize: 9, color: 'var(--text3)', paddingTop: 4 }}>
        <span><span style={{ color: 'var(--red)' }}>*</span> {t('panel_form.legend_required')}</span>
        <span><span style={{ color: 'var(--solar)' }}>*</span> {t('panel_form.legend_stringing')}</span>
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
        {t('panel_form.cancel')}
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
        {isAdding ? t('panel_form.adding') : t('panel_form.add')}
      </button>
    </div>
  );
};

// ─── Root component (provider) ───────────────────────────────

const PanelManualForm = ({ onClose }) => {
  const { t } = useTranslation();
  const { addManualPanel, panels } = useStore();
  const [fields, setFields] = useState(INITIAL);
  const [localError, setLocalError] = useState(null);

  const setField = (name, value) => setFields((prev) => ({ ...prev, [name]: value }));

  const handleSubmit = async () => {
    setLocalError(null);
    // Validazione campi obbligatori
    if (!fields.constructor.trim() || !fields.model.trim()) {
      setLocalError(t('panel_form.error_required'));
      return;
    }
    const power = parseFloat(fields.power_w);
    const eff   = parseFloat(fields.efficiency_pct);
    const w     = parseFloat(fields.width_m);
    const h     = parseFloat(fields.height_m);
    if (!power || !eff || !w || !h) {
      setLocalError(t('panel_form.error_numbers'));
      return;
    }

    const payload = {
      constructor:      fields.constructor.trim(),
      model:            fields.model.trim(),
      power_w:          power,
      efficiency_pct:   eff,
      width_m:          w,
      height_m:         h,
      weight_kg:        fields.weight_kg         ? parseFloat(fields.weight_kg)         : null,
      op_temperature_c: fields.op_temperature_c.trim() || null,
      temp_coefficient: fields.temp_coefficient  ? parseFloat(fields.temp_coefficient)  : null,
      warranty_years:   fields.warranty_years    ? parseInt(fields.warranty_years, 10)  : null,
      degradation_pct:  fields.degradation_pct   ? parseFloat(fields.degradation_pct)   : null,
      voc_v:            fields.voc_v             ? parseFloat(fields.voc_v)             : null,
      isc_a:            fields.isc_a             ? parseFloat(fields.isc_a)             : null,
      vmpp_v:           fields.vmpp_v            ? parseFloat(fields.vmpp_v)            : null,
      impp_a:           fields.impp_a            ? parseFloat(fields.impp_a)            : null,
      temp_coeff_voc:   fields.temp_coeff_voc    ? parseFloat(fields.temp_coeff_voc)    : null,
      temp_coeff_isc:   fields.temp_coeff_isc    ? parseFloat(fields.temp_coeff_isc)    : null,
    };

    try {
      await addManualPanel(payload);
      onClose();
    } catch {
      // l'errore è già in panels.error
    }
  };

  const contextValue = {
    fields,
    setField,
    handleSubmit,
    isAdding: panels.isAdding,
    error: localError || panels.error,
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

// Esponi i sub-component per composizione esterna (opzionale)
PanelManualForm.Header  = Header;
PanelManualForm.Fields  = Fields;
PanelManualForm.Actions = Actions;

export default PanelManualForm;

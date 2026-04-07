import React from 'react';
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useStore from '../../store/useStore';

const InfoModal = () => {
  const { t } = useTranslation();
  const infoOpen = useStore((s) => s.ui.infoOpen);
  const setInfoOpen = useStore((s) => s.setInfoOpen);

  if (!infoOpen) return null;

  const SECTIONS = [
    {
      title: t('info.app_title'),
      accent: '#D97757',
      content: (
        <>
          <p
            style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text1)', lineHeight: 1.6 }}
            dangerouslySetInnerHTML={{ __html: t('info.app_desc') }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {['React + Vite', 'FastAPI', 'Three.js', 'pvlib', 'ReportLab', 'Zustand', 'Recharts'].map((tech) => (
              <span
                key={tech}
                style={{
                  padding: '3px 10px',
                  borderRadius: 20,
                  background: 'rgba(217,119,87,0.08)',
                  border: '1px solid rgba(217,119,87,0.2)',
                  fontSize: 10,
                  fontWeight: 600,
                  color: '#D97757',
                }}
              >
                {tech}
              </span>
            ))}
          </div>
        </>
      ),
    },
    {
      title: t('info.algorithms_title'),
      accent: '#E08C1A',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            {
              name: t('info.algo_sag_name'),
              desc: t('info.algo_sag_desc'),
            },
            {
              name: t('info.algo_ray_name'),
              desc: t('info.algo_ray_desc'),
            },
            {
              name: t('info.algo_noct_name'),
              desc: t('info.algo_noct_desc'),
            },
          ].map((algo) => (
            <div
              key={algo.name}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                background: 'rgba(224,140,26,0.04)',
                border: '1px solid rgba(224,140,26,0.12)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: '#E08C1A', marginBottom: 2 }}>
                {algo.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.5 }}>
                {algo.desc}
              </div>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: t('info.repo_title'),
      accent: '#B85C35',
      content: (
        <a
          href="https://github.com/LorenzoGiovani/solar-optimizer"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            borderRadius: 8,
            background: 'rgba(184,92,53,0.06)',
            border: '1px solid rgba(184,92,53,0.2)',
            color: '#B85C35',
            fontSize: 12,
            fontWeight: 600,
            textDecoration: 'none',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(184,92,53,0.12)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(184,92,53,0.06)';
          }}
        >
          github.com/LorenzoGiovani/solar-optimizer
          <ExternalLink size={13} />
        </a>
      ),
    },
    {
      title: t('info.contacts_title'),
      accent: '#8B5E3C',
      content: (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          {t('info.contacts_desc')}{' '}
          <a
            href="https://github.com/LorenzoGiovani/solar-optimizer/issues"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#8B5E3C', textDecoration: 'underline' }}
          >
            {t('info.contacts_link')}
          </a>{' '}
          {t('info.contacts_suffix')}
        </p>
      ),
    },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        fontFamily: "'Outfit', sans-serif",
        animation: 'info-backdrop 0.3s ease forwards',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setInfoOpen(false);
      }}
    >
      <style>{`
        @keyframes info-backdrop {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes info-reveal {
          from { opacity: 0; transform: translateY(-20px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      <div
        style={{
          width: '90%',
          maxWidth: 620,
          maxHeight: '80vh',
          overflowY: 'auto',
          borderRadius: 16,
          background: 'var(--glass-hi)',
          border: '1px solid var(--border-hi)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          padding: 24,
          animation: 'info-reveal 0.4s cubic-bezier(0.4,0,0.2,1) forwards',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img
              src="/icons/logo.png"
              alt="SolarOptimizer3D"
              style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'contain' }}
            />
            <div>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text1)' }}>
                Solar<span style={{ color: 'var(--accent)' }}>Optimizer</span>
                <span style={{ color: 'var(--solar)', fontWeight: 700 }}>3D</span>
              </h2>
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>{t('info.subtitle')}</span>
            </div>
          </div>
          <button
            onClick={() => setInfoOpen(false)}
            style={{
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              width: 32,
              height: 32,
              cursor: 'pointer',
              color: 'var(--text2)',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        {/* Sections */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h3
                style={{
                  margin: '0 0 8px',
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '1.2px',
                  textTransform: 'uppercase',
                  color: section.accent,
                }}
              >
                {section.title}
              </h3>
              {section.content}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default InfoModal;

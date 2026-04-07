import React, { useState, useEffect } from 'react';
import { Trash2, Upload, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useStore from '../../store/useStore';

const ProjectsModal = () => {
  const { t, i18n } = useTranslation();
  const projectsModalOpen = useStore((s) => s.ui.projectsModalOpen);
  const setProjectsModalOpen = useStore((s) => s.setProjectsModalOpen);
  const listProjects = useStore((s) => s.listProjects);
  const loadProject = useStore((s) => s.loadProject);
  const deleteProject = useStore((s) => s.deleteProject);

  const [projects, setProjects] = useState([]);
  const [meshWarning, setMeshWarning] = useState(false);

  useEffect(() => {
    if (projectsModalOpen) {
      setProjects(listProjects());
      setMeshWarning(false);
    }
  }, [projectsModalOpen, listProjects]);

  if (!projectsModalOpen) return null;

  const handleLoad = (id) => {
    const hadMesh = loadProject(id);
    if (hadMesh) {
      setMeshWarning(true);
      setTimeout(() => setMeshWarning(false), 4000);
    }
    setProjectsModalOpen(false);
  };

  const handleDelete = (id) => {
    deleteProject(id);
    setProjects(listProjects());
  };

  const formatDate = (iso) => {
    try {
      return new Date(iso).toLocaleString(i18n.language === 'en' ? 'en-GB' : 'it-IT', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso; }
  };

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
        animation: 'projects-backdrop 0.3s ease forwards',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setProjectsModalOpen(false);
      }}
    >
      <style>{`
        @keyframes projects-backdrop {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes projects-reveal {
          from { opacity: 0; transform: translateY(-20px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      <div
        style={{
          width: '90%',
          maxWidth: 520,
          maxHeight: '80vh',
          overflowY: 'auto',
          borderRadius: 16,
          background: 'var(--glass-hi)',
          border: '1px solid var(--border-hi)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          padding: 24,
          animation: 'projects-reveal 0.4s cubic-bezier(0.4,0,0.2,1) forwards',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>📂</span> {t('projects.title')}
          </h2>
          <button
            onClick={() => setProjectsModalOpen(false)}
            style={{
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              width: 32, height: 32,
              cursor: 'pointer',
              color: 'var(--text2)',
              fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        {/* Mesh Warning */}
        {meshWarning && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 12,
            background: 'rgba(224,140,26,0.08)', border: '1px solid rgba(224,140,26,0.25)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <AlertTriangle size={14} style={{ color: '#E08C1A', flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: '#E08C1A', lineHeight: 1.4 }}>
              {t('projects.mesh_warning')}
            </span>
          </div>
        )}

        {/* Lista Progetti */}
        {projects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text3)' }}>
            <p style={{ fontSize: 13, margin: 0 }}>{t('projects.empty')}</p>
            <p style={{ fontSize: 11, margin: '8px 0 0' }}>
              {t('projects.empty_hint')}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {projects.map((p) => (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: 'var(--glass)',
                  border: '1px solid var(--border)',
                  transition: 'border-color 0.2s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-hi)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                    {formatDate(p.createdAt)}
                    {p.state?.building?.hadImportedMesh && (
                      <span style={{ marginLeft: 8, color: '#E08C1A' }}>{t('projects.imported_model')}</span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => handleLoad(p.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '5px 12px', borderRadius: 6,
                    background: 'rgba(217,119,87,0.08)', border: '1px solid rgba(217,119,87,0.25)',
                    color: '#D97757', fontSize: 10, fontWeight: 600,
                    cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(217,119,87,0.15)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(217,119,87,0.08)'; }}
                >
                  <Upload size={12} />
                  {t('projects.load')}
                </button>

                <button
                  onClick={() => handleDelete(p.id)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 28, height: 28, borderRadius: 6,
                    background: 'rgba(201,64,48,0.06)', border: '1px solid rgba(201,64,48,0.2)',
                    color: '#C94030', cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(201,64,48,0.15)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(201,64,48,0.06)'; }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectsModal;

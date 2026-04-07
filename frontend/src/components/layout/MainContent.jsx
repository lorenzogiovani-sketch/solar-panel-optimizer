import React from 'react';
import useStore from '../../store/useStore';
import Scene3D from '../3d/Scene3D';
import SceneHUD from './SceneHUD';
import FlashCard from '../cards/FlashCard';
import ModelCard from '../cards/ModelCard';
import ObstaclesCard from '../cards/ObstaclesCard';
import SimulationCard from '../cards/SimulationCard';
import OptimizationCard from '../cards/OptimizationCard';
import ResultsCard from '../cards/ResultsCard';
import InfoModal from './InfoModal';
import ProjectsModal from './ProjectsModal';

const LEFT_CARDS = [
  { id: 'model', icon: '/icons/logo_modello.png', title: 'Modello', accent: '#D97757' },
  { id: 'obstacles', icon: '/icons/logo_ostacoli.png', title: 'Ostacoli', accent: '#B85C35' },
  { id: 'simulation', icon: '/icons/logo_simulazione.png', title: 'Simulazione', accent: '#E08C1A' },
];

const RIGHT_CARDS = [
  { id: 'optimization', icon: '/icons/logo_ottimizzazione.png', title: 'Installazione', accent: '#8B5E3C' },
  { id: 'results', icon: '/icons/logo_risultati.png', title: 'Risultati', accent: '#C94030' },
];

const CARD_CONTENT = {
  model: <ModelCard />,
  obstacles: <ObstaclesCard />,
  simulation: <SimulationCard />,
  optimization: <OptimizationCard />,
};

const MainContent = () => {
  const activeCardId = useStore((s) => s.ui.activeCardId);
  const setActiveCard = useStore((s) => s.setActiveCard);
  const isResults = activeCardId === 'results';

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      {/* Keyframes CSS */}
      <style>{`
        @keyframes card-reveal-left {
          from { opacity: 0; transform: translateX(-20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes card-reveal-right {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes results-enter {
          from { opacity: 0; transform: translateY(-20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes scene-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      {/* Scena 3D — sfondo sempre visibile, fade-in */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          opacity: 0,
          animation: 'scene-fade-in 0.8s ease-out forwards',
        }}
      >
        <Scene3D />
      </div>

      {/* HUD sovrapposti alla scena */}
      <SceneHUD />

      {/* Colonna sinistra — Modello, Ostacoli, Simulazione */}
      <div
        style={{
          position: 'absolute',
          top: 64,
          bottom: 16,
          left: 16,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 8,
          zIndex: 50,
          pointerEvents: 'none',
        }}
      >
        {LEFT_CARDS.map((card, i) => {
          const dimmed = isResults;
          return (
            <div
              key={card.id}
              style={{
                opacity: dimmed ? 0.3 : 0,
                pointerEvents: dimmed ? 'none' : undefined,
                animation: dimmed
                  ? 'none'
                  : `card-reveal-left 0.5s cubic-bezier(0.4,0,0.2,1) ${0.1 * i}s forwards`,
                transition: dimmed ? 'opacity 0.3s ease' : undefined,
              }}
            >
              <FlashCard
                id={card.id}
                icon={card.icon}
                title={card.title}
                accentColor={card.accent}
                isActive={activeCardId === card.id}
                onClick={() => setActiveCard(card.id)}
              >
                {CARD_CONTENT[card.id]}
              </FlashCard>
            </div>
          );
        })}
      </div>

      {/* Colonna destra — Ottimizzazione, Risultati */}
      <div
        style={{
          position: 'absolute',
          top: 64,
          bottom: 16,
          right: 16,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 8,
          zIndex: 50,
          pointerEvents: 'none',
        }}
      >
        {RIGHT_CARDS.map((card, i) => {
          const isResultsFlash = card.id === 'results';
          const dimmed = isResults && !isResultsFlash;
          return (
            <div
              key={card.id}
              style={{
                opacity: dimmed ? 0.3 : 0,
                pointerEvents: dimmed ? 'none' : undefined,
                animation: dimmed
                  ? 'none'
                  : `card-reveal-right 0.5s cubic-bezier(0.4,0,0.2,1) ${0.1 * i}s forwards`,
                transition: dimmed ? 'opacity 0.3s ease' : undefined,
              }}
            >
              <FlashCard
                id={card.id}
                icon={card.icon}
                title={card.title}
                accentColor={card.accent}
                isActive={activeCardId === card.id && !isResultsFlash}
                onClick={() => setActiveCard(card.id)}
              >
                {CARD_CONTENT[card.id] || (
                  <div style={{ color: 'var(--text2)', fontSize: 11 }}>
                    Clicca per vedere i risultati
                  </div>
                )}
              </FlashCard>
            </div>
          );
        })}
      </div>

      {/* Results Overlay — renderizzato solo quando activeCardId === 'results' */}
      {isResults && (
        <ResultsCard onClose={() => setActiveCard(null)} />
      )}

      {/* Info Modal */}
      <InfoModal />

      {/* Projects Modal */}
      <ProjectsModal />
    </div>
  );
};

export default MainContent;

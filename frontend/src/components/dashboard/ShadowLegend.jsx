import React from 'react';
import useStore from '../../store/useStore';

const MONTH_NAMES = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

const ShadowLegend = () => {
    const { analysisMode, analysisMonth, analysisDay, analysisHour } = useStore((s) => s.solar);

    let title = 'Ombreggiatura Annua';
    if (analysisMode === 'monthly') {
        title = `Ombreggiatura — ${MONTH_NAMES[(analysisMonth || 1) - 1]}`;
    } else if (analysisMode === 'instant') {
        const m = MONTH_NAMES[(analysisMonth || 1) - 1];
        const d = analysisDay || 15;
        const h = analysisHour != null ? analysisHour : 12;
        const hh = String(Math.floor(h)).padStart(2, '0');
        const mm = String(Math.round((h % 1) * 60)).padStart(2, '0');
        title = `Ombreggiatura — ${d} ${m} ore ${hh}:${mm}`;
    }

    return (
        <div className="absolute bottom-4 right-4 bg-slate-900/90 p-3 rounded-lg border border-slate-700 w-48 shadow-2xl backdrop-blur-sm pointer-events-none">
            <h4 className="text-xs font-semibold text-slate-300 mb-2 uppercase tracking-wider text-center">
                {title}
            </h4>

            <div className="flex justify-between text-[10px] text-slate-400 mb-1 px-1">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
            </div>

            {/* Gradient Bar */}
            {/* 0.0 (Green) -> 0.3 (Yellow) -> 0.7 (Red) -> 1.0 (Purple) */}
            <div
                className="h-4 w-full rounded border border-slate-600 mb-2"
                style={{
                    background: 'linear-gradient(to right, #22c55e, #eab308, #ef4444, #a855f7)'
                }}
            />

            <div className="flex justify-between text-[10px] text-slate-500">
                <span>Soleggiato</span>
                <span>Ombra</span>
            </div>
        </div>
    );
};

export default ShadowLegend;

import React from 'react';
import useStore from '../../store/useStore';
import { estimateCalories, formatSessionClock } from '../../utils/fitnessMetrics';
import { useFitnessSessionElapsed } from '../../hooks/useFitnessSessionElapsed';
import { exportSessionJson } from '../../utils/exportSessionJson';

/**
 * DesktopStatusBar
 * Barra inferior de ancho completo — wording adapta a Normal vs Fitness.
 */
const DesktopStatusBar: React.FC = () => {
  const isConnected = useStore(s => s.isConnected);
  const historyOffset = useStore(s => s.historyOffset);
  const desktopLayout = useStore(s => s.desktopLayout);
  const vitals = useStore(s => s.vitals);
  const activity = useStore(s => s.activity);
  const fitnessSessionStatus = useStore(s => s.fitnessSessionStatus);
  const sessionElapsed = useFitnessSessionElapsed();

  const [monitorElapsed, setMonitorElapsed] = React.useState(0);

  React.useEffect(() => {
    if (!isConnected || desktopLayout === 'fitness') return;
    const start = Date.now();
    const id = setInterval(() => {
      setMonitorElapsed(Math.floor((Date.now() - start + historyOffset * 1000) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isConnected, historyOffset, desktopLayout]);

  const hours = Math.floor(monitorElapsed / 3600);
  const minutes = Math.floor((monitorElapsed % 3600) / 60);
  const isFitness = desktopLayout === 'fitness';
  const calories = estimateCalories(sessionElapsed, vitals.heartRate.value, activity.steps);

  const recordingLabel = isConnected
    ? `Recording: ${hours}h ${minutes}m`
    : 'Recording: —';

  const sessionLabel =
    fitnessSessionStatus === 'idle' ? '—'
      : `${formatSessionClock(sessionElapsed)}${
        fitnessSessionStatus === 'paused' ? ' (paused)'
          : fitnessSessionStatus === 'ended' ? ' (ended)'
            : ''
      }`;

  return (
    <footer className="flex-shrink-0 border-t border-slate-800/80 bg-slate-950/80 backdrop-blur-sm">
      <div className="px-6 py-2 flex items-center justify-between gap-4 text-[10px]">
        {isFitness ? (
          <div className="flex items-center gap-4 text-slate-500">
            <span className="tabular-nums">
              Session Data: {sessionLabel}
            </span>
            <span className="text-slate-700">•</span>
            <span className="tabular-nums">
              Calories Est: {fitnessSessionStatus !== 'idle' ? `~${calories.toLocaleString()}` : '—'}
            </span>
            <span className="text-slate-700">•</span>
            <span>AI Analysis: {fitnessSessionStatus === 'recording' ? 'Real-time' : '—'}</span>
            <span className="text-slate-700">•</span>
            <button
              type="button"
              onClick={() => exportSessionJson('fitness')}
              className="text-slate-600 hover:text-teal-400 cursor-pointer transition-colors"
              title="Download session snapshot as JSON"
            >
              Export: JSON
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-4 text-slate-500">
            <span className="tabular-nums">{recordingLabel}</span>
            <span className="text-slate-700">•</span>
            <span>Total Data: —</span>
            <span className="text-slate-700">•</span>
            <span>AI Last Analyzed: {isConnected ? '2 min ago' : '—'}</span>
            <span className="text-slate-700">•</span>
            <button
              type="button"
              onClick={() => exportSessionJson('clinical')}
              className="text-slate-600 hover:text-teal-400 cursor-pointer transition-colors"
              title="Download monitoring snapshot as JSON"
            >
              Export: JSON
            </button>
          </div>
        )}

        <p className="text-[9px] text-slate-600 uppercase tracking-wider text-right">
          The Patch is in development — Not yet FDA approved or cleared
        </p>
      </div>
    </footer>
  );
};

export default DesktopStatusBar;

import React from 'react';
import useStore from '../../store/useStore';
import { formatSessionClock } from '../../utils/fitnessMetrics';
import { formatRelativeAgo } from '../../utils/formatRelativeAgo';
import { useFitnessSessionElapsed } from '../../hooks/useFitnessSessionElapsed';
import { exportSessionJson } from '../../utils/exportSessionJson';
import WeightPrompt from '../WeightPrompt';

/**
 * DesktopStatusBar
 * Full-width bottom bar — wording adapts to Normal vs Fitness.
 */
interface DesktopStatusBarProps {
  /** Lead II points received since the current stream session started. null = no session yet. */
  sessionSampleCount?: number | null;
  /** ISO timestamp from the last successful /api/coach/insights response. */
  lastAnalyzedAt?: string | null;
}

const DesktopStatusBar: React.FC<DesktopStatusBarProps> = ({
  sessionSampleCount = null,
  lastAnalyzedAt = null,
}) => {
  const isConnected = useStore(s => s.isConnected);
  const historyOffset = useStore(s => s.historyOffset);
  const desktopLayout = useStore(s => s.desktopLayout);
  const fitnessSessionStatus = useStore(s => s.fitnessSessionStatus);
  const sessionElapsed = useFitnessSessionElapsed();

  const [monitorElapsed, setMonitorElapsed] = React.useState(0);
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!isConnected || desktopLayout === 'fitness') return;
    const start = Date.now();
    const id = setInterval(() => {
      setMonitorElapsed(Math.floor((Date.now() - start + historyOffset * 1000) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isConnected, historyOffset, desktopLayout]);

  React.useEffect(() => {
    if (!lastAnalyzedAt) return;
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [lastAnalyzedAt]);

  const hours = Math.floor(monitorElapsed / 3600);
  const minutes = Math.floor((monitorElapsed % 3600) / 60);
  const isFitness = desktopLayout === 'fitness';

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

  const analyzedLabel = lastAnalyzedAt
    ? formatRelativeAgo(lastAnalyzedAt, nowMs)
    : '—';

  return (
    <footer className="flex-shrink-0 border-t border-slate-800/80 bg-slate-950/80 backdrop-blur-sm">
      <div className="px-6 py-2 flex items-center justify-between gap-4 text-[10px]">
        {isFitness ? (
          <div className="flex items-center gap-4 text-slate-500">
            <span className="tabular-nums">
              Session Data: {sessionLabel}
            </span>
            <span className="text-slate-700">•</span>
            <WeightPrompt layout="bar" />
            <span className="text-slate-700">•</span>
            <span>AI Last Analyzed: {analyzedLabel}</span>
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
            <span className="tabular-nums">
              {sessionSampleCount == null
                ? 'Total Data: —'
                : `Total Data: ${sessionSampleCount.toLocaleString()} pts`}
            </span>
            <span className="text-slate-700">•</span>
            <span>AI Last Analyzed: {analyzedLabel}</span>
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

import React, { useEffect, useState } from 'react';
import useStore from '../store/useStore';
import { cn } from '../utils/cn';
import {
  isMockPatchMac,
  isMockSignalRunning,
  startMockPatchSignal,
  stopMockPatchSignal,
  subscribeMockSignal,
} from '../lib/mockPatchSignal';

/**
 * Start / stop simulated Patch packets. Rendered only while the selected
 * device is The Patch Mock (AA:BB:CC:DD:EE:FF). Opening that device does
 * not start the stream.
 */
const MockSignalButton: React.FC<{ className?: string }> = ({ className }) => {
  const deviceMac = useStore((s) => s.deviceMac);
  const visible = isMockPatchMac(deviceMac);
  const [running, setRunning] = useState(isMockSignalRunning);

  useEffect(() => subscribeMockSignal(setRunning), []);

  useEffect(() => {
    if (!visible) stopMockPatchSignal();
  }, [visible]);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => (running ? stopMockPatchSignal() : startMockPatchSignal())}
      aria-pressed={running}
      title={
        running
          ? 'Stop the simulated Patch signal'
          : 'Send simulated ECG from The Patch Mock'
      }
      className={cn(
        'flex items-center justify-center whitespace-nowrap h-7 xl:h-10 px-2 xl:px-3.5 rounded-lg border text-[10px] xl:text-[11px] font-bold uppercase tracking-wider transition-colors',
        running
          ? 'border-rose-500/40 bg-rose-500/15 text-rose-300 hover:text-rose-200'
          : 'border-teal-500/40 bg-teal-500/15 text-teal-300 hover:text-teal-200',
        className
      )}
    >
      {running ? 'Stop mock data' : 'Start mock data'}
    </button>
  );
};

export default MockSignalButton;

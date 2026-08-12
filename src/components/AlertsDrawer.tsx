import React from 'react';
import { X, Activity, Droplets, Thermometer, Wind, Heart, Clock, ArrowLeft, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, where, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import useStore from '../store/useStore';
import type { ChestEvent } from '../store/useStore';
import { cn } from '../utils/cn';

const EN_LOCALE = 'en-US';

interface AlertsDrawerProps {
  open: boolean;
  onClose: () => void;
}

const severityStyles: Record<string, { border: string; dot: string; label: string }> = {
  high: {
    border: 'border-rose-500/30',
    dot: 'bg-rose-400',
    label: 'text-rose-400',
  },
  medium: {
    border: 'border-yellow-500/25',
    dot: 'bg-yellow-400',
    label: 'text-yellow-400',
  },
  low: {
    border: 'border-slate-800/80',
    dot: 'bg-slate-500',
    label: 'text-slate-500',
  },
};

const eventTypeIcon: Record<string, React.ReactNode> = {
  tachycardia:  <Activity size={13} />,
  bradycardia:  <Activity size={13} />,
  spo2_drop:    <Droplets size={13} />,
  hyperthermia: <Thermometer size={13} />,
  hypothermia:  <Thermometer size={13} />,
  tachypnea:    <Wind size={13} />,
  bradypnea:    <Wind size={13} />,
  hypertension: <Heart size={13} />,
  hypotension:  <Heart size={13} />,
};

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(EN_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getDayLabel(epochMs: number): string {
  const d = new Date(epochMs);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(EN_LOCALE, { weekday: 'long', month: 'short', day: 'numeric' });
}

function groupByDay(events: ChestEvent[]): { label: string; events: ChestEvent[] }[] {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = events.filter(e => e.timestampEpoch >= cutoff);
  const map = new Map<string, ChestEvent[]>();
  for (const e of recent) {
    const label = getDayLabel(e.timestampEpoch);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(e);
  }
  return Array.from(map.entries()).map(([label, evts]) => ({
    label,
    events: evts.sort((a, b) => b.timestampEpoch - a.timestampEpoch),
  }));
}

interface VitalsSnap {
  hr?: number;
  spo2?: number;
  temp?: number;
  rr?: number;
  bp?: string;
}

const VitalsRow: React.FC<{ vitals?: VitalsSnap }> = ({ vitals }) => {
  if (!vitals) return null;
  const items = [
    { icon: <Activity size={10} />,    value: vitals.hr   ? `${vitals.hr} BPM` : null },
    { icon: <Droplets size={10} />,    value: vitals.spo2 ? `${vitals.spo2}%`  : null },
    { icon: <Thermometer size={10} />, value: vitals.temp ? `${vitals.temp}°C` : null },
    { icon: <Wind size={10} />,        value: vitals.rr   ? `${vitals.rr} rpm` : null },
    { icon: <Heart size={10} />,       value: vitals.bp   ?? null },
  ].filter(i => i.value !== null);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {items.map((item, idx) => (
        <div key={idx} className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-900/60 border border-slate-700/50">
          <span className="text-[#A0A0A8]">{item.icon}</span>
          <span className="text-[10px] font-medium text-[#A0A0A8] tabular-nums">{item.value}</span>
        </div>
      ))}
    </div>
  );
};

interface EventCardProps {
  event: ChestEvent & { vitals?: VitalsSnap };
  onJump: (event: ChestEvent) => void;
}

const EventCard: React.FC<EventCardProps> = ({ event, onJump }) => {
  const styles = severityStyles[event.severity] ?? severityStyles.low;
  const icon   = eventTypeIcon[event.type] ?? <Activity size={13} />;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'relative flex flex-col gap-1 px-3.5 py-3 rounded-2xl border bg-slate-800/40 hover:bg-slate-800/60 transition-colors',
        styles.border
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0 mt-0.5', styles.dot)} />
          <span className={cn('flex-shrink-0', styles.label)}>{icon}</span>
          <span className="text-[13px] font-semibold text-[#F5F5F5] truncate leading-[1.45]">{event.label}</span>
        </div>
        <button
          type="button"
          onClick={() => onJump(event)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-transparent hover:bg-teal-500/10 border border-teal-500/35 text-teal-400 transition-colors flex-shrink-0"
          title="Jump to this moment"
        >
          <ArrowLeft size={11} />
          <span className="text-[9px] font-bold uppercase tracking-wider">View</span>
        </button>
      </div>
      <div className="flex items-center gap-1 ml-[18px]">
        <Clock size={10} className="text-[#6B7280]" />
        <span className="text-[10px] text-[#6B7280] tabular-nums">{formatTime(event.timestampEpoch)}</span>
      </div>
      <div className="ml-[18px]">
        <VitalsRow vitals={(event as ChestEvent & { vitals?: VitalsSnap }).vitals} />
      </div>
    </motion.div>
  );
};

const DayHeader: React.FC<{ label: string; count: number }> = ({ label, count }) => (
  <div className="flex items-center gap-2 pt-2 pb-1">
    <span className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-[0.2em]">{label}</span>
    <span className="text-[10px] font-semibold text-[#A0A0A8] bg-slate-900/60 border border-slate-700/50 px-1.5 py-0.5 rounded-md">{count}</span>
    <div className="flex-1 h-px bg-slate-800/80" />
  </div>
);

async function clearUserEvents(userId: string, clearStore: () => void) {
  try {
    const q = query(
      collection(db, 'events'),
      where('userId', '==', userId)
    );
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map(doc => deleteDoc(doc.ref)));
    clearStore();
  } catch (err) {
    console.error('[clearUserEvents] Error:', err);
  }
}

const AlertsDrawer: React.FC<AlertsDrawerProps> = ({ open, onClose }) => {
  const events                = useStore(s => s.events);
  const jumpToEvent           = useStore(s => s.jumpToEvent);
  const setIsAdvancedMenuOpen = useStore(s => s.setIsAdvancedMenuOpen);
  const currentUser           = useStore(s => s.currentUser);

  const [clearing, setClearing] = React.useState(false);
  const [showConfirmClear, setShowConfirmClear] = React.useState(false);

  const grouped    = React.useMemo(() => groupByDay(events), [events]);
  const totalShown = grouped.reduce((acc, g) => acc + g.events.length, 0);

  const handleJump = (event: ChestEvent) => {
    jumpToEvent(event);
    onClose();
    setIsAdvancedMenuOpen(false);
  };

  const handleConfirmClear = async () => {
    if (!currentUser) return;
    setClearing(true);
    setShowConfirmClear(false);
    await clearUserEvents(currentUser.uid, () => {
      useStore.setState({ events: [], alerts: [], activeEventBanner: null });
    });
    setClearing(false);
  };

  React.useEffect(() => {
    if (!open) setShowConfirmClear(false);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            key="drawer-panel"
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-full max-w-[28rem] sm:max-w-[32rem] z-[70] flex flex-col bg-slate-950/95 backdrop-blur-2xl shadow-2xl border-l border-slate-800/80"
          >
            {/* Header — same family as AI Coach */}
            <div className="relative flex items-center justify-between px-5 pt-6 pb-4 border-b border-slate-800/80 flex-shrink-0 gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-[0.22em]">
                  Clinical history
                </p>
                <p className="text-base font-bold text-[#F5F5F5] mt-0.5 leading-tight">
                  Events
                  {totalShown > 0 && (
                    <span className="ml-2 align-middle text-[10px] font-semibold text-[#A0A0A8] bg-slate-900/60 border border-slate-700/50 px-1.5 py-0.5 rounded-md">
                      {totalShown}
                    </span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 p-0.5 rounded-xl bg-slate-900/50 border border-slate-800/90">
                {totalShown > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowConfirmClear(true)}
                    disabled={clearing}
                    className="w-9 h-9 flex items-center justify-center rounded-lg text-[#A0A0A8] hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-40"
                    title="Clear all events"
                  >
                    <Trash2 size={14} />
                  </button>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  className="w-9 h-9 flex items-center justify-center rounded-lg text-[#A0A0A8] hover:text-[#F5F5F5] hover:bg-slate-800/80 transition-colors"
                  aria-label="Close alerts"
                >
                  <X size={15} />
                </button>
              </div>

              <AnimatePresence>
                {showConfirmClear && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="absolute left-5 right-5 top-full mt-2 z-10 p-3.5 rounded-2xl border border-slate-700/60 bg-slate-950 shadow-xl"
                  >
                    <p className="text-[12px] text-[#A0A0A8] leading-[1.45] mb-3">
                      Do you want to delete all events?
                    </p>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowConfirmClear(false)}
                        className="px-3 py-1.5 rounded-lg border border-slate-700/60 bg-slate-900/60 text-[10px] font-medium uppercase tracking-wider text-[#A0A0A8] hover:text-[#F5F5F5] transition-colors"
                      >
                        No
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmClear}
                        disabled={clearing}
                        className="px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-[10px] font-medium uppercase tracking-wider text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-40"
                      >
                        {clearing ? '…' : 'Yes'}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide px-5 py-5">
              {grouped.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-900/60 border border-slate-700/50 flex items-center justify-center">
                    <Activity size={18} className="text-[#6B7280]" />
                  </div>
                  <p className="text-[12px] text-[#6B7280] text-center leading-[1.5]">
                    No clinical events in the last 7 days.<br />They&apos;ll appear here in real time.
                  </p>
                </div>
              ) : (
                grouped.map(({ label, events: dayEvents }) => (
                  <div key={label}>
                    <DayHeader label={label} count={dayEvents.length} />
                    <div className="flex flex-col gap-2.5 mb-3">
                      {dayEvents.map(event => (
                        <EventCard key={event.id} event={event} onJump={handleJump} />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            {grouped.length > 0 && (
              <div className="px-5 py-4 border-t border-slate-800/80 flex-shrink-0">
                <p className="text-[9px] text-[#6B7280] text-center uppercase tracking-widest">
                  Tap View to jump to that moment in history
                </p>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default AlertsDrawer;

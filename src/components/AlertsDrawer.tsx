import React from 'react';
import { X, Activity, Droplets, Thermometer, Wind, Heart, Clock, ArrowLeft, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, where, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import useStore from '../store/useStore';
import type { ChestEvent } from '../store/useStore';

// ─── Props ────────────────────────────────────────────────────────────────────

/**
 * Properties for the AlertsDrawer component.
 */
interface AlertsDrawerProps {
  /** Indicates whether the drawer is open. */
  open: boolean;
  /** Callback function to close the drawer. */
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const severityStyles: Record<string, { border: string; dot: string; label: string }> = {
  high: {
    border: 'border-red-500/30',
    dot: 'bg-red-400',
    label: 'text-red-400',
  },
  medium: {
    border: 'border-yellow-500/25',
    dot: 'bg-yellow-400',
    label: 'text-yellow-400',
  },
  low: {
    border: 'border-white/8',
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

/**
 * Formats a millisecond timestamp to a localized time string.
 */
function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Generates a day label (e.g. 'Today', 'Yesterday', or full weekday name) for a given timestamp.
 */
function getDayLabel(epochMs: number): string {
  const d = new Date(epochMs);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

/**
 * Groups physiological events by calendar day, filtering only the last 7 days of history.
 */
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

// ─── Vitals snapshot row ──────────────────────────────────────────────────────

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
        <div key={idx} className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/4 border border-white/6">
          <span className="text-teal-400/70">{item.icon}</span>
          <span className="text-[10px] font-medium text-slate-400 tabular-nums">{item.value}</span>
        </div>
      ))}
    </div>
  );
};

// ─── Event Card ───────────────────────────────────────────────────────────────

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
      className={`relative flex flex-col gap-1 px-3 py-3 rounded-xl border bg-white/3 ${styles.border} hover:bg-white/5 transition-colors`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-0.5 ${styles.dot}`} />
          <span className={`flex-shrink-0 ${styles.label}`}>{icon}</span>
          <span className="text-[12px] font-semibold text-white truncate">{event.label}</span>
        </div>
        <button
          onClick={() => onJump(event)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/20 text-teal-400 transition-all flex-shrink-0"
          title="Jump to this moment"
        >
          <ArrowLeft size={11} />
          <span className="text-[9px] font-bold uppercase tracking-wider">View</span>
        </button>
      </div>
      <div className="flex items-center gap-1 ml-[18px]">
        <Clock size={10} className="text-slate-600" />
        <span className="text-[10px] text-slate-500 tabular-nums">{formatTime(event.timestampEpoch)}</span>
      </div>
      <div className="ml-[18px]">
        <VitalsRow vitals={(event as any).vitals} />
      </div>
    </motion.div>
  );
};

// ─── Day section header ───────────────────────────────────────────────────────

const DayHeader: React.FC<{ label: string; count: number }> = ({ label, count }) => (
  <div className="flex items-center gap-2 pt-2 pb-1">
    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.2em]">{label}</span>
    <span className="text-[9px] font-bold text-slate-600 bg-white/5 px-1.5 py-0.5 rounded-md">{count}</span>
    <div className="flex-1 h-px bg-white/5" />
  </div>
);

// ─── Clear all — deletes user events from Firestore ──────────────────────────

/**
 * Deletes all physiological events associated with the given user ID from Firestore,
 * then clears the local Zustand store.
 */
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

// ─── AlertsDrawer ─────────────────────────────────────────────────────────────

/**
 * AlertsDrawer Component.
 * Displays a sliding drawer containing the chronological physiological events history
 * from the last 7 days. It allows users to jump back in time to specific event occurrences
 * and clear their history.
 */
const AlertsDrawer: React.FC<AlertsDrawerProps> = ({ open, onClose }) => {
  const events                = useStore(s => s.events);
  const jumpToEvent           = useStore(s => s.jumpToEvent);
  const setIsAdvancedMenuOpen = useStore(s => s.setIsAdvancedMenuOpen);
  const currentUser           = useStore(s => s.currentUser);

  const [clearing, setClearing] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);

  const grouped    = React.useMemo(() => groupByDay(events), [events]);
  const totalShown = grouped.reduce((acc, g) => acc + g.events.length, 0);

  const handleJump = (event: ChestEvent) => {
    jumpToEvent(event);
    onClose();
    setIsAdvancedMenuOpen(false);
  };

  const handleClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    if (!currentUser) return;
    setClearing(true);
    setConfirmClear(false);
    await clearUserEvents(currentUser.uid, () => {
      useStore.setState({ events: [], alerts: [], activeEventBanner: null });
    });
    setClearing(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            key="drawer-panel"
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-80 z-[70] flex flex-col bg-neutral-950/95 backdrop-blur-2xl shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-6 pb-4 border-b border-white/5 flex-shrink-0">
              <div>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.25em]">
                  Clinical history · last 7 days
                </p>
                <p className="text-sm font-semibold text-white mt-0.5">
                  Events
                  {totalShown > 0 && (
                    <span className="ml-2 text-[10px] font-bold text-teal-400 bg-teal-500/10 border border-teal-500/20 px-1.5 py-0.5 rounded-md">
                      {totalShown}
                    </span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {/* Clear button — two taps: first requests confirmation, second performs deletion */}
                {totalShown > 0 && (
                  <button
                    onClick={handleClear}
                    disabled={clearing}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[9px] font-bold uppercase tracking-wider transition-all ${
                      confirmClear
                        ? 'bg-rose-500/20 border-rose-500/40 text-rose-400 animate-pulse'
                        : 'bg-white/5 border-white/10 text-slate-500 hover:text-rose-400 hover:border-rose-500/30 hover:bg-rose-500/10'
                    }`}
                    title="Clear all events"
                  >
                    <Trash2 size={11} />
                    <span>{clearing ? 'Clearing…' : confirmClear ? 'Confirm?' : 'Clear all'}</span>
                  </button>
                )}

                <button
                  onClick={onClose}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-4 py-3 scrollbar-hide">
              {grouped.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/4 flex items-center justify-center">
                    <Activity size={18} className="text-slate-600" />
                  </div>
                  <p className="text-[11px] text-slate-600 text-center">
                    No clinical events in the last 7 days.<br />They'll appear here in real time.
                  </p>
                </div>
              ) : (
                grouped.map(({ label, events: dayEvents }) => (
                  <div key={label}>
                    <DayHeader label={label} count={dayEvents.length} />
                    <div className="flex flex-col gap-2 mb-2">
                      {dayEvents.map(event => (
                        <EventCard key={event.id} event={event} onJump={handleJump} />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            {grouped.length > 0 && (
              <div className="px-5 py-4 border-t border-white/5 flex-shrink-0">
                <p className="text-[9px] text-slate-600 text-center uppercase tracking-widest">
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

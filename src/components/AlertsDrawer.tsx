import React, { useEffect, useState } from 'react';
import { X, Bell, AlertTriangle, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, orderBy, where, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface FirestoreAlert {
  id: string;
  type: string;
  label: string;
  severity: 'high' | 'medium' | 'low';
  timestamp: number;
}

interface AlertsDrawerProps {
  open: boolean;
  onClose: () => void;
}

const severityConfig = {
  high:   { color: 'text-rose-400',   bg: 'bg-rose-500/10 border-rose-500/20',   icon: AlertTriangle },
  medium: { color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20', icon: AlertTriangle },
  low:    { color: 'text-slate-400',  bg: 'bg-white/5 border-white/10',            icon: Info },
};

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return 'Today';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const AlertsDrawer: React.FC<AlertsDrawerProps> = ({ open, onClose }) => {
  const [alerts, setAlerts] = useState<FirestoreAlert[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);

    const since = Date.now() - 24 * 60 * 60 * 1000; // últimas 24h

    getDocs(
      query(
        collection(db, 'events'),
        where('timestamp', '>=', since),
        orderBy('timestamp', 'desc')
      )
    )
      .then((snap) => {
        const docs = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as FirestoreAlert[];
        setAlerts(docs);
      })
      .catch((err) => console.error('[AlertsDrawer]', err))
      .finally(() => setLoading(false));
  }, [open]);

  // Agrupar por fecha
  const grouped = alerts.reduce<Record<string, FirestoreAlert[]>>((acc, a) => {
    const key = formatDate(a.timestamp);
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {});

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="alerts-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            key="alerts-drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-72 z-[70] flex flex-col bg-neutral-900/95 backdrop-blur-2xl shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-6 pb-4 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Bell size={15} className="text-teal-400" />
                <div>
                  <p className="text-sm font-semibold text-white">Alerts</p>
                  <p className="text-[9px] text-slate-500 uppercase tracking-widest">Last 24 hours</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
              >
                <X size={15} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <div className="w-5 h-5 border-2 border-white/10 border-t-teal-400 rounded-full animate-spin" />
                </div>
              )}

              {!loading && alerts.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <Bell size={28} className="text-slate-700" />
                  <p className="text-[11px] text-slate-600 uppercase tracking-widest">No alerts in the last 24h</p>
                </div>
              )}

              {!loading && (Object.entries(grouped) as [string, FirestoreAlert[]][]).map(([date, items]) => (
                <div key={date}>
                  <p className="text-[9px] font-bold text-slate-600 uppercase tracking-[0.2em] mb-2 px-1">
                    {date}
                  </p>
                  <div className="flex flex-col gap-2">
                    {items.map((alert) => {
                      const cfg = severityConfig[alert.severity] ?? severityConfig.low;
                      const Icon = cfg.icon;
                      return (
                        <div
                          key={alert.id}
                          className={`flex items-start gap-3 px-3 py-3 rounded-xl border ${cfg.bg}`}
                        >
                          <Icon size={13} className={`${cfg.color} mt-0.5 flex-shrink-0`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-semibold text-white truncate">
                              {alert.label}
                            </p>
                            <p className={`text-[9px] font-bold uppercase tracking-wider mt-0.5 ${cfg.color}`}>
                              {alert.severity}
                            </p>
                          </div>
                          <span className="text-[9px] text-slate-600 tabular-nums flex-shrink-0 mt-0.5">
                            {formatTime(alert.timestamp)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default AlertsDrawer;

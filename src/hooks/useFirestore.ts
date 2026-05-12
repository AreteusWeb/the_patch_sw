import { useEffect } from 'react';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import useStore from '../store/useStore';
import type { EventType } from '../store/useStore';

// Tipos válidos — deben coincidir exactamente con lo que manda la Cloud Function
const VALID_EVENT_TYPES = new Set<EventType>([
    'tachycardia', 'bradycardia',
    'spo2_drop',
    'hyperthermia', 'hypothermia',
    'tachypnea', 'bradypnea',
    'hypertension', 'hypotension',
]);

/**
 * Escucha en tiempo real las colecciones `alerts` y `events` de Firestore.
 *
 * Colección `alerts`:
 *   { message: string, severity: 'high'|'medium'|'low', timestamp: number (ms) }
 *
 * Colección `events`:
 *   { type: EventType, label: string, severity: 'high'|'medium'|'low', timestamp: number (ms) }
 *
 * Monta este hook una sola vez en App.tsx.
 */
export function useFirestore() {
    const addAlert = useStore(s => s.addAlert);
    const addEvent = useStore(s => s.addEvent);

    // ── Colección: alerts ──────────────────────────────────────────────────────
    useEffect(() => {
        const q = query(
            collection(db, 'alerts'),
            orderBy('timestamp', 'desc'),
            limit(50)
        );

        const unsub = onSnapshot(q, (snap) => {
            snap.docChanges().forEach((change) => {
                if (change.type !== 'added') return;
                const d = change.doc.data();
                addAlert({
                    timestamp: d.timestamp
                        ? new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    message: d.message ?? 'Unknown alert',
                    severity: d.severity ?? 'medium',
                });
            });
        }, (err) => console.error('[useFirestore] alerts:', err));

        return () => unsub();
    }, [addAlert]);

    // ── Colección: events ──────────────────────────────────────────────────────
    useEffect(() => {
        const q = query(
            collection(db, 'events'),
            orderBy('timestamp', 'desc'),
            limit(200)
        );

        const unsub = onSnapshot(q, (snap) => {
            snap.docChanges().forEach((change) => {
                if (change.type !== 'added') return;
                const d = change.doc.data();

                if (!VALID_EVENT_TYPES.has(d.type as EventType)) {
                    console.warn('[useFirestore] unknown event type:', d.type);
                    return;
                }

                addEvent({
                    type: d.type as EventType,
                    label: d.label ?? d.type,
                    severity: d.severity ?? 'high',
                    timestampEpoch: d.timestamp ?? Date.now(),
                });
            });
        }, (err) => console.error('[useFirestore] events:', err));

        return () => unsub();
    }, [addEvent]);
}

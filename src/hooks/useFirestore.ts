import { useEffect } from 'react';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import useStore from '../store/useStore';
import type { EventType } from '../store/useStore';

// Types válidos — deben coincidir exactamente con lo que manda la Cloud Function
const VALID_EVENT_TYPES = new Set<EventType>([
    'tachycardia', 'bradycardia',
    'spo2_drop',
    'hyperthermia', 'hypothermia',
    'tachypnea', 'bradypnea',
    'hypertension', 'hypotension',
]);

/**
 * Escucha la colección `events` de Firestore en tiempo real.
 * Cada evento clínico que llega se pasa a addEvent(), que automáticamente:
 *   1. Lo agrega al listado de events (para el slider / AdvancedControls)
 *   2. Lo agrega al panel de alerts (Recent Alerts en ambos modos)
 *   3. Activa el EventBanner encima de los vitales
 *
 * Formato del documento en Firestore:
 * {
 *   type:      EventType   — uno de los 9 types válidos
 *   label:     string      — e.g. "Elevated HR"
 *   severity:  'high' | 'medium'
 *   timestamp: number      — ms epoch
 * }
 *
 * Monta este hook una sola vez en App.tsx.
 */
export function useFirestore() {
    const addEvent = useStore(s => s.addEvent);

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

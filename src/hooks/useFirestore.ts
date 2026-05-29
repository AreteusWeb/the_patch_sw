import { useEffect } from 'react';
import { collection, onSnapshot, orderBy, query, limit, addDoc, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import useStore from '../store/useStore';
import type { EventType } from '../store/useStore';

const VALID_EVENT_TYPES = new Set<EventType>([
    'tachycardia', 'bradycardia',
    'spo2_drop',
    'hyperthermia', 'hypothermia',
    'tachypnea', 'bradypnea',
    'hypertension', 'hypotension',
]);

// ─── Singleton for already processed IDs ──────────────────────────────────────
/**
 * Set containing event IDs that have already been processed or written,
 * preventing duplicate event ingestion.
 */
export const processedFirestoreIds = new Set<string>();

// ─── Save event with vitals snapshot ──────────────────────────────────────────

/**
 * Saves a physiological event with a snapshot of the current vitals in Firestore.
 *
 * @param event - Object containing event details (type, label, severity, timestamp).
 * @param vitals - Object containing current vitals values (hr, spo2, temp, rr, bp).
 * @param userId - Firebase user UID of the current user.
 * @returns The generated Firestore document ID or null if saving failed.
 */
export async function saveEventWithVitals(
    event: {
        type: EventType;
        label: string;
        severity: 'high' | 'medium';
        timestampEpoch: number;
    },
    vitals: {
        hr: number;
        spo2: number;
        temp: number;
        rr: number;
        bp: string;
    },
    userId: string
): Promise<string | null> {
    try {
        const ref = await addDoc(collection(db, 'events'), {
            type: event.type,
            label: event.label,
            severity: event.severity,
            timestamp: event.timestampEpoch,
            userId,
            vitals: {
                hr: vitals.hr,
                spo2: vitals.spo2,
                temp: vitals.temp,
                rr: vitals.rr,
                bp: vitals.bp,
            },
        });
        return ref.id;
    } catch (err) {
        console.error('[saveEventWithVitals] Error:', err);
        return null;
    }
}

// ─── Helper: Converts Firestore timestamp to epoch number ─────────────────────

/**
 * Converts a Firestore timestamp representation to a standard millisecond epoch number.
 * Handles epoch numbers, Firestore Timestamp objects, or null/undefined.
 *
 * @param raw - The raw timestamp value from Firestore.
 * @returns The converted millisecond timestamp.
 */
function toEpoch(raw: unknown): number {
    if (!raw) return Date.now();
    // Firestore Timestamp object { seconds, nanoseconds }
    if (typeof raw === 'object' && 'seconds' in (raw as object)) {
        return (raw as { seconds: number }).seconds * 1000;
    }
    // Already a number
    if (typeof raw === 'number') return raw;
    return Date.now();
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Hook to synchronize physiological events history from Firestore in real-time.
 * It listens to changes in the "events" collection filtered by the logged-in user.
 */
export function useFirestore() {
    const addEvent    = useStore(s => s.addEvent);
    const currentUser = useStore(s => s.currentUser);

    useEffect(() => {
        if (!currentUser) return;

        const q = query(
            collection(db, 'events'),
            where('userId', '==', currentUser.uid),
            orderBy('timestamp', 'desc'),
            limit(200)
        );

        const unsub = onSnapshot(q, (snap) => {
            snap.docChanges().forEach((change) => {
                if (change.type !== 'added') return;

                const docId = change.doc.id;

                // If the ID is already in the Set, it was written by us — skip
                if (processedFirestoreIds.has(docId)) return;
                processedFirestoreIds.add(docId);

                const d = change.doc.data();

                if (!VALID_EVENT_TYPES.has(d.type as EventType)) {
                    console.warn('[useFirestore] unknown event type:', d.type);
                    return;
                }

                addEvent({
                    type: d.type as EventType,
                    label: d.label ?? d.type,
                    severity: d.severity ?? 'high',
                    timestampEpoch: toEpoch(d.timestamp),
                    skipAlert: true,  // ← history events do not trigger a panel alert
                });
            });
        }, (err) => console.error('[useFirestore] events:', err));

        return () => unsub();
    }, [addEvent, currentUser]);
}

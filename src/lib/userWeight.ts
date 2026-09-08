import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { IS_LOCAL_MODE } from './appConfig';
import useStore from '../store/useStore';

const LOCAL_KEY_PREFIX = 'thepatch.bodyWeightKg.';

function storageKey(uid: string): string {
  return `${LOCAL_KEY_PREFIX}${uid}`;
}

/** Accept a plausible body weight. Rejects missing / fake defaults. */
export function parseBodyWeightKg(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 20 || n > 400) return null;
  return Math.round(n * 10) / 10;
}

export function loadLocalBodyWeightKg(uid: string): number | null {
  try {
    return parseBodyWeightKg(localStorage.getItem(storageKey(uid)));
  } catch {
    return null;
  }
}

export function saveLocalBodyWeightKg(uid: string, kg: number): void {
  localStorage.setItem(storageKey(uid), String(kg));
}

/** Persist weight on the existing users/{uid} profile, or localStorage in local mode. */
export async function persistBodyWeightKg(kg: number): Promise<void> {
  const uid = useStore.getState().currentUser?.uid;
  if (!uid) throw new Error('Sign in required to save weight.');

  useStore.getState().setBodyWeightKg(kg);

  if (IS_LOCAL_MODE || !db) {
    saveLocalBodyWeightKg(uid, kg);
    return;
  }

  await updateDoc(doc(db, 'users', uid), { weightKg: kg });
  saveLocalBodyWeightKg(uid, kg);
}

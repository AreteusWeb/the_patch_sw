import { useEffect, useRef } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, type Timestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import {
  AUTO_LOGIN_EMAIL,
  AUTO_LOGIN_ENABLED,
  AUTO_LOGIN_PASSWORD,
  IS_LOCAL_MODE,
} from '../lib/appConfig';
import { loadLocalBodyWeightKg, parseBodyWeightKg } from '../lib/userWeight';
import useStore from '../store/useStore';

/** Firestore Timestamp | Date | epoch ms → epoch ms. */
function createdAtToMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const date = (value as Timestamp).toDate();
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  return null;
}

/** Fixed user used in local mode — no login (see meeting priority #4). */
const LOCAL_DEV_USER = {
  uid: 'local-dev-user',
  email: 'local@thepatch.dev',
  displayName: 'Local Dev',
} as User;

/**
 * Hook to manage Firebase authentication state.
 * This hook is mounted once in App.tsx.
 *
 * Responsibilities:
 * 1. Listen to `onAuthStateChanged` and synchronize with the global store.
 * 2. Create the `users/{uid}` document in Firestore if the user is logging in for the first time.
 * 3. Load the user's linked device MAC address, if any.
 * 4. Expose login and logout helpers.
 * 5. Optional staging auto-login via VITE_AUTO_LOGIN_EMAIL / VITE_AUTO_LOGIN_PASSWORD
 *    (real Firebase credentials — backend still verifies the idToken).
 *
 * In local mode (VITE_APP_MODE=local) none of this runs: a fixed user is
 * assigned immediately and the login screen is skipped entirely, since
 * Firebase is not available to validate credentials.
 */
export function useAuth() {
  const setCurrentUser = useStore(s => s.setCurrentUser);
  const setDeviceMac = useStore(s => s.setDeviceMac);
  const setAuthLoading = useStore(s => s.setAuthLoading);
  const setAccountCreatedAt = useStore(s => s.setAccountCreatedAt);
  const setBodyWeightKg = useStore(s => s.setBodyWeightKg);
  /** One attempt per page load — logout stays logged out until refresh. */
  const autoLoginAttemptedRef = useRef(false);

  useEffect(() => {
    if (IS_LOCAL_MODE) {
      setCurrentUser(LOCAL_DEV_USER);
      setDeviceMac(null);
      setBodyWeightKg(loadLocalBodyWeightKg(LOCAL_DEV_USER.uid));
      setAuthLoading(false);
      return;
    }

    const unsub = onAuthStateChanged(auth!, async (firebaseUser) => {
      if (firebaseUser) {
        // ── Authenticated User ──────────────────────────────────────────────
        setCurrentUser(firebaseUser);

        // Read or create the user document in Firestore
        // (db is non-null here: this branch only runs when !IS_LOCAL_MODE)
        const userRef = doc(db!, 'users', firebaseUser.uid);
        const snap = await getDoc(userRef);

        if (!snap.exists()) {
          // First time — create user profile document
          await setDoc(userRef, {
            email: firebaseUser.email,
            displayName: firebaseUser.displayName ?? firebaseUser.email,
            createdAt: serverTimestamp(),
            deviceMac: null,
          });
          setDeviceMac(null);
          setBodyWeightKg(null);
          const created = await getDoc(userRef);
          setAccountCreatedAt(createdAtToMs(created.data()?.createdAt));
        } else {
          // Existing user — load linked device MAC address
          const data = snap.data();
          setDeviceMac(data.deviceMac ?? null);
          setAccountCreatedAt(createdAtToMs(data.createdAt));
          setBodyWeightKg(
            parseBodyWeightKg(data.weightKg) ?? loadLocalBodyWeightKg(firebaseUser.uid)
          );
        }
        setAuthLoading(false);
        return;
      }

      // ── No Session ───────────────────────────────────────────────────────
      // Staging: try real email/password once before showing LoginScreen.
      if (AUTO_LOGIN_ENABLED && !autoLoginAttemptedRef.current) {
        autoLoginAttemptedRef.current = true;
        // Keep the Loading screen up while we sign in.
        setAuthLoading(true);
        try {
          await signInWithEmailAndPassword(
            auth!,
            AUTO_LOGIN_EMAIL,
            AUTO_LOGIN_PASSWORD
          );
          // Success → onAuthStateChanged fires again with the user.
          return;
        } catch (err: unknown) {
          const code =
            err && typeof err === 'object' && 'code' in err
              ? String((err as { code?: string }).code)
              : 'unknown';
          console.warn(
            `[useAuth] auto-login failed for ${AUTO_LOGIN_EMAIL}: ${code}`
          );
          setCurrentUser(null);
          setDeviceMac(null);
          setAuthLoading(false);
          return;
        }
      }

      setCurrentUser(null);
      setDeviceMac(null);
      setAuthLoading(false);
    });

    return () => unsub();
  }, [setCurrentUser, setDeviceMac, setAuthLoading]);
}

// ─── Auth Helpers ─────────────────────────────────────────────────────────────

/**
 * Logs in a user using email and password.
 * The `onAuthStateChanged` listener will automatically handle updating the application state.
 */
export async function login(email: string, password: string): Promise<void> {
  if (IS_LOCAL_MODE) {
    console.warn('[useAuth] login() is a no-op in local mode (no Firebase).');
    return;
  }
  await signInWithEmailAndPassword(auth!, email, password);
}

/**
 * Logs out the current user.
 * With auto-login env vars set, logout sticks until the next full page reload
 * (auto-login runs only once per load).
 */
export async function logout(): Promise<void> {
  if (IS_LOCAL_MODE) {
    console.warn('[useAuth] logout() is a no-op in local mode (no Firebase).');
    return;
  }
  await signOut(auth!);
}

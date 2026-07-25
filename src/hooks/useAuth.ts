import { useEffect } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { IS_LOCAL_MODE } from '../lib/appConfig';
import useStore from '../store/useStore';

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
 *
 * In local mode (VITE_APP_MODE=local) none of this runs: a fixed user is
 * assigned immediately and the login screen is skipped entirely, since
 * Firebase is not available to validate credentials.
 */
export function useAuth() {
  const setCurrentUser = useStore(s => s.setCurrentUser);
  const setDeviceMac   = useStore(s => s.setDeviceMac);
  const setAuthLoading = useStore(s => s.setAuthLoading);

  useEffect(() => {
    if (IS_LOCAL_MODE) {
      setCurrentUser(LOCAL_DEV_USER);
      setDeviceMac(null);
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
        const snap    = await getDoc(userRef);

        if (!snap.exists()) {
          // First time — create user profile document
          await setDoc(userRef, {
            email:       firebaseUser.email,
            displayName: firebaseUser.displayName ?? firebaseUser.email,
            createdAt:   serverTimestamp(),
            deviceMac:   null,
          });
          setDeviceMac(null);
        } else {
          // Existing user — load linked device MAC address
          const data = snap.data();
          setDeviceMac(data.deviceMac ?? null);
        }
      } else {
        // ── No Session ───────────────────────────────────────────────────────
        setCurrentUser(null);
        setDeviceMac(null);
      }
      // Firebase auth state has resolved — hide loading screen
      setAuthLoading(false);
    });

    return () => unsub();
  }, [setCurrentUser, setDeviceMac]);
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
 */
export async function logout(): Promise<void> {
  if (IS_LOCAL_MODE) {
    console.warn('[useAuth] logout() is a no-op in local mode (no Firebase).');
    return;
  }
  await signOut(auth!);
}

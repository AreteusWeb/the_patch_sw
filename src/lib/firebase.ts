import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, type Auth } from 'firebase/auth';
import { IS_LOCAL_MODE } from './appConfig';

let app: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;

// In local mode we do not initialize Firebase at all — so anyone who clones
// the repo does not need real Areteus credentials/project to run the UI locally.
if (!IS_LOCAL_MODE) {
  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };

  const missing = Object.entries(firebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    // No hidden default: if cloud-mode config is missing, fail with a clear
    // message instead of attempting a partial connection.
    throw new Error(
      `[firebase] Missing environment variables: ${missing.join(', ')}. ` +
      `Configure your .env (see .env.example) or use VITE_APP_MODE=local to run without Firebase.`
    );
  }

  /** Initialize the Firebase application instance. */
  app = initializeApp(firebaseConfig);
  /** Firestore database instance. */
  dbInstance = getFirestore(app);
  /** Firebase Auth service instance. */
  authInstance = getAuth(app);
}

/**
 * Firestore instance, or `null` in local mode (VITE_APP_MODE=local).
 * All code that uses it is guarded by an IS_LOCAL_MODE check, so in
 * practice it is never accessed while null.
 */
export const db = dbInstance;

/**
 * Firebase Auth instance, or `null` in local mode.
 * See the note on `db` above.
 */
export const auth = authInstance;

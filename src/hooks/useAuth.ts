import { useEffect } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import useStore from '../store/useStore';

// ─── useAuth ─────────────────────────────────────────────────────────────────
// Monta una sola vez en App.tsx.
// Responsabilidades:
//   1. Escuchar onAuthStateChanged y sincronizar con useStore
//   2. Crear el documento users/{uid} en Firestore si es la primera vez
//   3. Cargar el deviceMac vinculado al usuario (si tiene uno)
//   4. Exponer helpers: login / logout

export function useAuth() {
  const setCurrentUser = useStore(s => s.setCurrentUser);
  const setDeviceMac   = useStore(s => s.setDeviceMac);
  const setAuthLoading = useStore(s => s.setAuthLoading);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // ── Usuario autenticado ──────────────────────────────────────────────
        setCurrentUser(firebaseUser);

        // Leer/crear documento del usuario en Firestore
        const userRef = doc(db, 'users', firebaseUser.uid);
        const snap    = await getDoc(userRef);

        if (!snap.exists()) {
          // Primera vez — crear perfil
          await setDoc(userRef, {
            email:       firebaseUser.email,
            displayName: firebaseUser.displayName ?? firebaseUser.email,
            createdAt:   serverTimestamp(),
            deviceMac:   null,
          });
          setDeviceMac(null);
        } else {
          // Usuario existente — cargar MAC vinculada
          const data = snap.data();
          setDeviceMac(data.deviceMac ?? null);
        }
      } else {
        // ── Sin sesión ───────────────────────────────────────────────────────
        setCurrentUser(null);
        setDeviceMac(null);
      }
      // Firebase ya resolvió — quitar pantalla de carga
      setAuthLoading(false);
    });

    return () => unsub();
  }, [setCurrentUser, setDeviceMac]);
}

// ─── Helpers de auth ─────────────────────────────────────────────────────────

export async function login(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email, password);
  // onAuthStateChanged se encarga del resto automáticamente
}

export async function logout(): Promise<void> {
  await signOut(auth);
}

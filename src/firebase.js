import { initializeApp } from 'firebase/app'
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, query, where, getDocs, onSnapshot,
  runTransaction, writeBatch, serverTimestamp,
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, orderBy, limit, startAfter,
} from 'firebase/firestore'
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  setPersistence, browserLocalPersistence, updatePassword,
  sendEmailVerification, EmailAuthProvider, reauthenticateWithCredential,
} from 'firebase/auth'

// Live Firestore — NO emulator. Config comes from .env.local (VITE_ keys).
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export function hasFirebaseConfig() {
  return Object.values(firebaseConfig).every((v) => typeof v === 'string' && v.trim() !== '')
}

if (!hasFirebaseConfig()) {
  console.error('[MediLog] Firebase web config missing. Copy .env.example to .env.local and fill VITE_ keys.')
}

export const app = initializeApp(firebaseConfig)

// Offline-first: keep a persistent IndexedDB cache so reads and writes work
// without a connection. Writes queue locally and flush to Firestore when the
// device comes back online (Spark plan — client SDK handles all syncing).
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()

setPersistence(auth, browserLocalPersistence).catch(() => {})

export {
  collection, query, where, getDocs, onSnapshot, runTransaction, writeBatch,
  serverTimestamp, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, orderBy, limit, startAfter,
  signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, updatePassword, sendEmailVerification,
  EmailAuthProvider, reauthenticateWithCredential,
}

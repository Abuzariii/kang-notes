// Connection to the kang-notes Firebase project. This config only identifies the project;
// access is controlled by firestore.rules, which allow a single account.
import { initializeApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence,
  onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut,
} from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

const config = {
  apiKey: 'AIzaSyCToJN3SVtqF8Qo1y3M1mi6psmVgk-gpZg',
  authDomain: 'kang-notes.firebaseapp.com',
  projectId: 'kang-notes',
  storageBucket: 'kang-notes.firebasestorage.app',
  messagingSenderId: '498042328808',
  appId: '1:498042328808:web:830c6bfd40176dfde15b5d',
};

export function initFirebase() {
  const app = initializeApp(config);
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true,
  });
  return {
    db,
    onUser: (fn) => onAuthStateChanged(auth, fn),
    signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
    resetPassword: (email) => sendPasswordResetEmail(auth, email),
    signOut: () => signOut(auth),
  };
}

export function authMessage(err) {
  switch (err?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'That email and password don’t match.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes, or reset your password.';
    case 'auth/network-request-failed':
      return 'No connection. Signing in needs the internet the first time.';
    case 'auth/missing-email':
      return 'Type your email first.';
    default:
      return err?.message || 'Something went wrong.';
  }
}

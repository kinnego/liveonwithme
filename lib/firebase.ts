import { getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import { Firestore, getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Lazy initialization - only initialize when actually used (not at build time)
let _auth: Auth | null = null;
let _db: Firestore | null = null;

function getFirebaseApp() {
  if (typeof window === 'undefined') {
    // Server-side rendering - return null, Firebase will initialize client-side
    return null;
  }
  return getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
}

export const auth = new Proxy({} as Auth, {
  get(target, prop) {
    if (!_auth) {
      const app = getFirebaseApp();
      if (app) _auth = getAuth(app);
    }
    return _auth ? (_auth as any)[prop] : undefined;
  }
});

export const db = new Proxy({} as Firestore, {
  get(target, prop) {
    if (!_db) {
      const app = getFirebaseApp();
      if (app) _db = getFirestore(app);
    }
    return _db ? (_db as any)[prop] : undefined;
  }
});

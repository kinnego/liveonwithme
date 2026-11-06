// Shared Firebase app init. Split out from `lib/firebase.ts` so that
// client modules which only need auth (e.g. the public memorial page)
// can import auth without transitively pulling `firebase/firestore`
// into their route bundle — ~150 KB of SDK that visitors never used.

import { FirebaseApp, getApps, initializeApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Init only when env is present. During builds without env (Cloudflare Pages,
// etc.) this module loads without crashing; runtime pages that need Firebase
// are `dynamic = 'force-dynamic'` so they never invoke it server-side.
export const firebaseApp = firebaseConfig.apiKey
  ? getApps().length
    ? getApps()[0]
    : initializeApp(firebaseConfig)
  : (null as unknown as FirebaseApp);

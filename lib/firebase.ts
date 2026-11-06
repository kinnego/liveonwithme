// Canonical client-side Firebase entry for callers that need Firestore.
// The public memorial page avoids this file (and the ~150 KB firestore
// chunk) by importing `auth` from `@/lib/firebase-auth` directly.

import { Firestore, getFirestore } from 'firebase/firestore';
import { firebaseApp } from './firebase-app';

export { auth } from './firebase-auth';
export const db = (firebaseApp ? getFirestore(firebaseApp) : null) as Firestore;

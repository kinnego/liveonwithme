// Auth-only Firebase entry point. The public memorial page imports from
// here instead of `@/lib/firebase` so that it doesn't ship the Firestore
// client SDK (~150 KB gz) to drive-by visitors who never sign in.

import { Auth, getAuth } from 'firebase/auth';
import { firebaseApp } from './firebase-app';

export const auth = (firebaseApp ? getAuth(firebaseApp) : null) as Auth;

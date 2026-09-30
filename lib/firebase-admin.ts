import { cert, getApps, initializeApp, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

let _app: App | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;

function getApp(): App {
  if (_app) return _app;

  if (getApps().length > 0) {
    _app = getApps()[0];
    return _app;
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  // Netlify's env-var UI can wrap values in quotes and different pipelines
  // encode newlines differently. Normalise both so a service-account key
  // pasted with either literal `\n` or real newlines works.
  const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  const privateKey = rawKey
    ?.replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    console.error('[firebase-admin] Missing credentials', {
      hasProjectId: !!projectId,
      hasClientEmail: !!clientEmail,
      hasPrivateKey: !!privateKey,
    });
    throw new Error(
      'Firebase Admin credentials are missing. Set FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY.'
    );
  }

  try {
    _app = initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
  } catch (err: any) {
    console.error('[firebase-admin] initializeApp failed', {
      projectId,
      clientEmailHead: clientEmail.slice(0, 10),
      keyStartsWith: privateKey.slice(0, 30),
      keyEndsWith: privateKey.slice(-30),
      keyLength: privateKey.length,
      err: err?.message,
    });
    throw err;
  }

  return _app;
}

export function adminAuth(): Auth {
  if (!_auth) _auth = getAuth(getApp());
  return _auth;
}

export function adminDb(): Firestore {
  if (!_db) _db = getFirestore(getApp());
  return _db;
}

export async function verifyIdToken(authHeader: string | null): Promise<string> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }
  const token = authHeader.slice('Bearer '.length);
  const decoded = await adminAuth().verifyIdToken(token);
  return decoded.uid;
}

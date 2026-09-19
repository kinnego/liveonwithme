// Audit trail helpers. Writes to /auditEvents. Best-effort — audit failures
// never block the primary user action.

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { AuditEntityType } from './types';

export interface AuditInput {
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  actorUid: string;
  actorEmail?: string;
  details?: Record<string, unknown>;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  if (!db) return;
  try {
    await addDoc(collection(db, 'auditEvents'), {
      ...input,
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    console.warn('audit write failed', err);
  }
}

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { AuditEntityType } from './types';

export interface AuditAdminInput {
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  actorUid: string;
  actorEmail?: string;
  details?: Record<string, unknown>;
}

export async function writeAuditAdmin(input: AuditAdminInput): Promise<void> {
  try {
    await adminDb()
      .collection('auditEvents')
      .add({
        ...input,
        timestamp: FieldValue.serverTimestamp(),
      });
  } catch (err) {
    console.warn('admin audit write failed', err);
  }
}

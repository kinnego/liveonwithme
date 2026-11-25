import { NextRequest, NextResponse } from 'next/server';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { claimSlug, claimSlugWithFallback, validateSlug, slugErrorMessage } from '@/lib/partner-slugs';

export const runtime = 'nodejs';

// Set or auto-assign the public URL slug for a partner's /partner/<slug>
// page. Partners can rename their own slug; super admins can assign on
// behalf of any user (used by the approval flow).
export async function POST(req: NextRequest) {
  try {
    const callerUid = await verifyIdToken(req.headers.get('Authorization'));

    const body = (await req.json().catch(() => ({}))) as {
      slug?: string;
      targetUid?: string;
      fallbackFromName?: string;
    };

    const db = adminDb();
    const callerSnap = await db.collection('users').doc(callerUid).get();
    if (!callerSnap.exists) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 });
    }
    const caller = callerSnap.data()!;
    const isSuperAdmin = caller.role === 'super_admin';

    const targetUid = body.targetUid && body.targetUid !== callerUid ? body.targetUid : callerUid;
    if (targetUid !== callerUid && !isSuperAdmin) {
      return NextResponse.json({ error: 'Not permitted' }, { status: 403 });
    }

    // The target must be an approved partner — we don't hand out /partner/<slug>
    // URLs to pending or rejected accounts. Super admins can still assign on
    // the same transition where approval happens, because the admin page
    // writes approval first, then calls this. Super admins can also own a
    // slug on their own account for a demo page.
    if (targetUid === callerUid) {
      const callerOk = caller.role === 'partner' && caller.partnerStatus === 'approved';
      if (!callerOk && !isSuperAdmin) {
        return NextResponse.json({ error: 'Approved partners only' }, { status: 403 });
      }
    } else {
      const targetSnap = await db.collection('users').doc(targetUid).get();
      if (!targetSnap.exists) {
        return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
      }
      const target = targetSnap.data()!;
      if (target.role !== 'partner' || target.partnerStatus !== 'approved') {
        return NextResponse.json({ error: 'Target is not an approved partner' }, { status: 400 });
      }
    }

    if (body.slug) {
      const v = validateSlug(body.slug);
      if (!v.ok) return NextResponse.json({ error: slugErrorMessage(v.reason) }, { status: 400 });
      const finalSlug = await claimSlug(targetUid, v.slug);
      return NextResponse.json({ slug: finalSlug });
    }

    const seed = (body.fallbackFromName || '').trim() || 'partner';
    const finalSlug = await claimSlugWithFallback(targetUid, seed);
    return NextResponse.json({ slug: finalSlug });
  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : 'Could not update URL';
    // Taken-slug errors are user-actionable; anything else is a 500.
    const status = /taken|reserved|URL name/i.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

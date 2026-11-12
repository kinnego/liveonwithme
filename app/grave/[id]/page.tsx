// A grave from a parish burial register: who is buried here, where it is in
// the graveyard, and directions to it. Public, so anyone searching for a
// relative can find them and go there. Once a family adopts the grave, its
// plot page is the grave's home and we send visitors there instead.

import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { adminDb } from '@/lib/firebase-admin';
import ButtonLink from '@/components/ButtonLink';
import { GRAVE_COLLECTION } from '@/lib/grave-records-admin';
import { directionsUrl, publicGrave, type PublicGrave } from '@/lib/grave-public';
import { SUPER_ADMIN_EMAIL, type GraveRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.liveonwith.me';

async function loadGrave(id: string): Promise<PublicGrave | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const snap = await adminDb().collection(GRAVE_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return publicGrave(snap.id, snap.data() as GraveRecord);
}

// "Mary" from "Mary Doherty"; "Mrs Doherty" when the register only has a title.
function firstName(full: string): string {
  const words = full.trim().split(/\s+/);
  if (words.length < 2) return full || 'them';
  return /^(mr|mrs|miss|ms|dr|fr|sr|rev|lt|capt)\.?$/i.test(words[0]) ? full : words[0];
}

function namesOf(g: PublicGrave): string {
  return g.burials.map((b) => b.name).filter(Boolean).join(', ');
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const g = await loadGrave(id);
  if (!g) return { title: 'Grave · LiveOnWith.me' };
  const title = `${namesOf(g) || 'A grave'} · ${g.cemeteryName}`;
  const description = `Resting at ${g.cemeteryName}${g.label ? `, ${g.label}` : ''}. From the parish burial register.`;
  return {
    title: `${title} · LiveOnWith.me`,
    description,
    openGraph: { title, description, url: `${SITE_URL}/grave/${id}`, type: 'website' },
    alternates: { canonical: `${SITE_URL}/grave/${id}` },
  };
}

export default async function GravePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await loadGrave(id);
  if (!g) notFound();
  if (g.plotId) redirect(`/plot/${g.plotId}`);

  const pinned = g.lat !== null && g.lng !== null;
  const directions = directionsUrl(g);
  const createQ = new URLSearchParams({ cemeteryName: g.cemeteryName, cemeteryPlaceId: g.placeId });
  if (g.cemeteryAddress) createQ.set('cemeteryAddress', g.cemeteryAddress);
  if (g.cemeteryLat !== null) createQ.set('cemeteryLat', String(g.cemeteryLat));
  if (g.cemeteryLng !== null) createQ.set('cemeteryLng', String(g.cemeteryLng));
  const createHref = (name: string) => {
    const q = new URLSearchParams(createQ);
    if (name) q.set('name', name);
    return `/create?${q.toString()}`;
  };

  return (
    <main className="shell" style={{ maxWidth: 760 }}>
      <Link href={`/cemetery/${encodeURIComponent(g.placeId)}?name=${encodeURIComponent(g.cemeteryName)}`} className="muted" style={{ fontSize: 14 }}>
        ← {g.cemeteryName}
      </Link>

      <div className="eyebrow" style={{ marginTop: 22 }}>From the {g.cemeteryName} burial register</div>
      <h1 style={{ fontSize: 'clamp(36px, 6vw, 56px)', margin: '10px 0 18px' }}>
        {g.burials.length === 1 ? g.burials[0].name : 'Resting here'}
      </h1>

      <div className="card" style={{ fontSize: 17 }}>
        {g.burials.map((b, i) => (
          <div
            key={i}
            style={{
              paddingBottom: i < g.burials.length - 1 ? 14 : 0,
              marginBottom: i < g.burials.length - 1 ? 14 : 0,
              borderBottom: i < g.burials.length - 1 ? '1px solid var(--line)' : 'none',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 19 }}>{b.name}</div>
            <div className="muted" style={{ fontSize: 15 }}>
              {[
                b.nickname && `Known as ${b.nickname}`,
                b.born && `Born ${b.born}`,
                b.died && `Died ${b.died}`,
                b.age && `aged ${b.age}`,
                b.relations,
                b.address,
              ]
                .filter(Boolean)
                .join(', ')}
            </div>
          </div>
        ))}
        {g.inscription && (
          <blockquote className="muted" style={{ fontStyle: 'italic', margin: '16px 0 0', fontSize: 16 }}>
            &ldquo;{g.inscription}&rdquo;
          </blockquote>
        )}
      </div>

      <div className="card" style={{ marginTop: 16, background: '#fffdf9' }}>
        <h2 style={{ fontSize: 26, margin: '0 0 8px' }}>
          {g.burials.length === 1 ? `Remember ${firstName(g.burials[0].name)} with a memorial` : 'Remember them with a memorial'}
        </h2>
        <p style={{ margin: '0 0 14px', fontSize: 17 }}>
          A memorial page holds their photos, their story and the memories family and friends share.
          It&rsquo;s linked to this grave at {g.cemeteryName}, so anyone who finds them here finds their page too.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          {g.burials.map((b, i) => (
            <ButtonLink key={i} href={createHref(b.name)} className={i === 0 ? 'button' : 'button secondary'}>
              Add a memorial for {firstName(b.name)}
            </ButtonLink>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 26, margin: '0 0 8px' }}>Where to find the grave</h2>
        <p style={{ margin: '0 0 6px', fontSize: 17 }}>
          <strong>{g.cemeteryName}</strong>
          {g.cemeteryAddress && <span className="muted">, {g.cemeteryAddress}</span>}
        </p>
        <p style={{ margin: 0, fontSize: 17 }}>{g.label || 'No row or plot number in the register.'}</p>
        <p className="muted" style={{ fontSize: 15, margin: '8px 0 0' }}>
          {pinned
            ? 'The grave is pinned on the map, so directions take you right to it.'
            : 'The grave hasn’t been pinned on the map yet, so directions take you to the graveyard.'}
        </p>
        {directions && (
          <div className="actions" style={{ marginTop: 16 }}>
            <a href={directions} target="_blank" rel="noopener noreferrer" className="button">
              {pinned ? 'Directions to the grave' : 'Directions to the graveyard'}
            </a>
          </div>
        )}
      </div>


      <p className="muted" style={{ fontSize: 14, marginTop: 24 }}>
        This record comes from the parish burial register, kept by volunteers. If something looks
        wrong, email <a href={`mailto:${SUPER_ADMIN_EMAIL}`} style={{ textDecoration: 'underline' }}>{SUPER_ADMIN_EMAIL}</a>.
      </p>
    </main>
  );
}

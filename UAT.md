# User Acceptance Testing — LiveOnWith.me

A human-runnable checklist covering the mandatory scenarios from the spec.
Run these in a fresh incognito window per role to keep sessions clean.

Legend: `[ ]` step to try · **Expect:** what should happen · **Fail if:** red flag.

## Setup

- `npm run dev` — dev server on http://localhost:3000
- Firebase project has emulator OR real project with `.env.local` filled in
- Stripe test mode keys in `.env.local` (use card `4242 4242 4242 4242`, any future date/CVC)
- Sign in once as `hello@freastar.com` — this account is the super_admin (rule-enforced)

---

## 1. Family (direct pay) — the golden path

- [ ] Visit `/create` while signed out
  - **Expect:** two full-width tiles (memorial / legacy). Tapping either routes to `/auth?next=%2Fcreate` with the mode saved.
- [ ] Sign in via Google or email as **Family A**
  - **Expect:** land back on `/create` with the previously tapped tile pre-selected and the form open
- [ ] Fill Mary O'Donnell, born 1948-03-12, died 2025-11-04, add photo, submit
  - **Expect:** minimal form — only name, born, died, photo. No epitaph/story/visibility inputs.
- [ ] Land on `/memorial/[id]/manage`
  - **Expect:** status badge = **Draft**, "Go Live · €199" CTA visible
  - **Expect:** amber "Finish setting up" card prompting to add the line beneath the name and the story (visible while epitaph or story is empty)
- [ ] Click **Preview** — new tab opens `/m/[slug]`
  - **Expect:** amber preview banner: "This is a preview. Only you can see it until it's live."
- [ ] Open the same URL in an incognito window
  - **Expect:** "Memorial not found" — draft is private
- [ ] Back on manage, click **Go Live · €199** → Stripe checkout
- [ ] Pay with `4242 4242 4242 4242`
- [ ] Redirect back to manage
  - **Expect:** status flips to **Live** (may take 1-2s for webhook); "Go Live" CTA gone
- [ ] Refresh incognito `/m/[slug]`
  - **Expect:** memorial visible to the world; no preview banner
- [ ] View page source (Cmd+U)
  - **Expect:** `<title>` includes name + years; `<script type="application/ld+json">` with Person schema; `og:image` populated

**Fail if:** webhook doesn't flip status, or public visitor sees the draft, or JSON-LD is missing.

---

## 2. Funeral director (partner referral) — no charge to family

- [ ] Sign in as **Partner P** (fresh email)
- [ ] `/partner/apply` → submit application
  - **Expect:** "Thanks — we'll be in touch" confirmation
- [ ] Sign in as super_admin, go to `/admin/partners`
  - **Expect:** Partner P's application listed as pending
- [ ] Click **Approve**
  - **Expect:** application row updates; audit event appears in `/admin/audit`
- [ ] Sign in as Partner P again, go to `/partner/new`
  - **Expect:** referral form loads (was gated before approval)
- [ ] Fill in bereaved contact (Family B email), submit
  - **Expect:** referral link shown to copy/share
- [ ] Open referral link in incognito as **Family B**
- [ ] Sign in with the bereaved email → land on `/claim/[id]`
- [ ] Complete claim → memorial created with `paymentStatus: paid_via_partner`
- [ ] Family B builds memorial, clicks **Go Live**
  - **Expect:** no Stripe redirect — goes live immediately
  - **Expect:** partner referral flips `commercialStatus: live`

**Fail if:** family is charged, or partner sees referral form before approval.

---

## 3. QR code that survives a stonemason

- [ ] As Family A (or any custodian), open manage page
- [ ] Verify "Headstone QR" card visible with cemetery set
- [ ] Click **Get headstone QR** → lands `/plot/[plotId]/qr`
- [ ] **Expect:** on-screen QR preview + two download buttons (**PNG** and **SVG**)
- [ ] Download the SVG, open in Inkscape/Illustrator
  - **Expect:** clean vector paths, no raster embed — etchable
- [ ] Open the PNG at 100% zoom
  - **Expect:** crisp; error-correction level H (visible in QR density)
- [ ] Read the stonemason guidance card
  - **Expect:** 40mm+ recommendation, quiet border note, ECC-H tolerance explanation
- [ ] Scan the printed/on-screen QR with a phone camera
  - **Expect:** URL like `https://liveonwith.me/p/ABC23XYZ` → redirects → `/plot/[plotId]` public page

**Fail if:** SVG contains `<image>` (rasterised), or scan lands on a 404, or the redirect misses.

---

## 4. Plot page — one grave, many people

- [ ] Sign in as Family A, create memorial → set cemetery to a real Google Place
- [ ] From manage, click **Link to a plot** in the Headstone QR card
- [ ] Sign in as Family C (different family, same cemetery, different memorial)
- [ ] Family C's manage page → **Link to a plot** → same plot short ID?
  - _(This step depends on plot lookup UX; if lookup missing, families link to the same plot admin.)_
- [ ] Visit `/plot/[plotId]` while signed out
  - **Expect:** cemetery info at top, all approved memorials listed
  - **Expect:** JSON-LD Place schema in page source
- [ ] Confirm draft/private memorials do NOT appear on the plot page

**Fail if:** drafts leak into the plot listing, or the plot page 500s when a memorial has no photo.

---

## 5. Custody transfer (primary) — passing the memorial on

- [ ] As Family A, open manage → scroll to **Looking to the future**
- [ ] Enter Family D's email, choose **primary custodian**, click **Send invitation**
  - **Expect:** pending nomination card appears with a shareable link
- [ ] Copy the accept URL, open in incognito
- [ ] Try clicking Accept while signed out
  - **Expect:** "Please sign in to continue"
- [ ] Sign in with a different email than the one invited
  - **Expect:** "This invitation is for a different email" — no swap happens
- [ ] Sign in as Family D → accept
  - **Expect:** confirmation "You are now the custodian of Mary O'Donnell's memorial"
- [ ] Family D opens `/dashboard`
  - **Expect:** memorial appears under their **Memorials** section (owned)
- [ ] Family A opens `/dashboard`
  - **Expect:** memorial no longer under owned; instead under **Looked after by others** (preserved as backup)
- [ ] Public `/m/[slug]` URL unchanged and still works

**Fail if:** URL changes after custody swap, or the previous owner completely loses visibility.

---

## 6. Backup custodian nomination

- [ ] As Family A, nominate Family E as **backup custodian**
- [ ] Family E accepts via the accept URL
- [ ] Family E's `/dashboard`
  - **Expect:** memorial appears under **Looked after by others** with warm copy: "You don't need to do anything today…"
- [ ] Confirm Family E cannot edit or delete the memorial (rule-enforced)

**Fail if:** backup gets owner-level edit rights, or accept flow succeeds for wrong email.

---

## 7. Media quotas

Defaults: 50 photos, 5 videos, singleFile 100MB, total 500MB per memorial (check `/admin/config`).

- [ ] Try uploading a >100MB file (single-file limit)
  - **Expect:** friendly rejection referencing `hello@freastar.com`
- [ ] Upload multiple large files until the memorial exceeds total budget
  - **Expect:** rejection when about to breach total; existing files retained
- [ ] On manage page storage card, progress bar reflects usage
  - **Expect:** amber warning appears at 85%
- [ ] Super admin edits quotas at `/admin/config`, saves
  - **Expect:** new quotas apply on next upload (60s TTL cache in `lib/config.ts`)

**Fail if:** the app crashes on a >100MB drop, or the total budget is silently exceeded.

---

## 8. Succession safety net

- [ ] As any signed-in user, visit `/help/succession`
- [ ] Submit form (own name, contact preference, notes)
  - **Expect:** confirmation, request stored
- [ ] Super admin visits `/admin/succession`
  - **Expect:** row visible; can transition status to assigned/resolved/rejected
- [ ] Each status change writes an audit event visible at `/admin/audit`

**Fail if:** form submits with no confirmation, or status changes aren't audited.

---

## 9. Admin console

- [ ] `/admin` reachable only when signed in as `hello@freastar.com`
- [ ] Any other account visiting `/admin/*` is bounced (rules block reads)
- [ ] `/admin/memorials` — search by name/slug/id/ownerUid; result links to `/m/[slug]` and `/memorial/[id]/manage`
- [ ] `/admin/config` — edit pricing (€ cents) and quotas, save; refresh reflects saved values
- [ ] `/admin/audit` — last 200 events, most recent first

**Fail if:** a non-admin session can read `/admin/*` data, or config edits don't persist.

---

## 10. Draft privacy + edge safety

- [ ] Draft `/m/[slug]` accessed while not signed in → "Memorial not found"
- [ ] `visibility: private` live memorial from a signed-in non-family visitor → "Memorial not found"
- [ ] `visibility: unlisted` live memorial → visible to anyone with the link; `<meta name="robots" content="noindex,nofollow">` in head
- [ ] `visibility: public` live memorial → OG image + Person JSON-LD in page source

**Fail if:** unlisted memorials show up in `robots` allow list, or private memorials leak via SSR.

---

## 11. Kindness pass — copy sanity

Walk the app as a first-time visitor. Copy should never sound cold, corporate, or blame-shifting.

- [ ] Empty dashboard: "No memorials yet…" reads gently
- [ ] Backup section: "You don't need to do anything today…" is reassuring
- [ ] Quota rejection: mentions `hello@freastar.com` as human contact
- [ ] Custody acceptance confirmation: names the person, thanks the user
- [ ] Preview banner: warm, not scary

**Fail if:** any error message reads like a database exception or blames the user.

---

## 12. Legacy page — writing your own, while you can

- [ ] `/auth` → sign in as **Living L** (fresh email)
- [ ] `/create` → land on the "Who is this page for?" picker
  - **Expect:** two tiles: **A memorial** / **A legacy page**
- [ ] Click **A legacy page**
  - **Expect:** copy shifts to first-person ("Tell us about you", "Your full name")
  - **Expect:** only one date field (Born); no Died input; no epitaph/story on create
- [ ] Fill form, submit → `/memorial/[id]/manage`
  - **Expect:** eyebrow reads "Your page", not "Family controls"
  - **Expect:** header CTAs say "Preview" / when live, "View page" (not "View memorial")
- [ ] Click **Preview** → `/m/[slug]` with preview banner
  - **Expect:** hero shows born year only, no "Aged X" line
  - **Expect:** memories section heading: "Messages for [FirstName]"
  - **Expect:** contribution form heading: "Would you like to share a note or photograph with [FirstName]?"
- [ ] Back on manage, click **Go Live · €199** → Stripe checkout → pay
  - **Expect:** copy in the Ready-when-you-are card mentions "publishing" and "for whenever it's needed"
- [ ] After going live, `/dashboard`
  - **Expect:** card shows born year only; CTA "Manage page →"
- [ ] Open `/m/[slug]` incognito
  - **Expect:** metadata title has no year range for legacy (`OpenGraph type=website`, not `profile`)
  - **Expect:** JSON-LD Person has no `deathDate`
- [ ] Back on manage, click **Edit page**
  - **Expect:** title says "Edit page"; only Born field visible; small link "If the time has come, add a date of passing…"
- [ ] Click the link → Died field appears; enter a date, save
  - **Expect:** page transitions to memorial mode (kind flips to `memorial`); manage/dashboard copy reverts to third-person; hero shows both years + Aged X

**Fail if:** legacy page silently exposes a "died" year, or the transition to memorial loses any data, or metadata leaks a made-up death year.

---

## 13. Data integrity — existing memorials survive

The two preserved memorials from earlier data model:

- [ ] `/m/cathal-doherty-mugtl` renders (backfill in place)
- [ ] `/m/mary-demo` renders (hard-coded demo)

**Fail if:** either 500s or shows "not found."

---

## Regression checklist for future changes

After any change to `firestore.rules`, re-run scenarios 1, 3, 5, 6, 8, 9, 10.
After any change to `/api/upload` or `lib/quota-admin.ts`, re-run scenario 7.
After any change to `/api/custody/accept` or `/lib/plot.ts`, re-run scenarios 3, 5, 6.
After any change to `generateMetadata` or `MemorialView.tsx`, re-run scenarios 1, 10, 12.
After any change to `/create` or `/memorial/[id]/edit`, re-run scenarios 1, 12.

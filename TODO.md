# Status & next steps

Last updated: 2026-10-12, branch `claude/ubuntu-machine-or-phone-ovt1xa` (the GitHub default — there is no separate `main`).

## 2026-10-12 session handoff

### Shipped since last update

- **Email address change flow.** New block inside the Account disclosure on `/dashboard` lets a signed-in user set a new email. Driven by Firebase Auth's `verifyBeforeUpdateEmail(user, next)` so the verification link lands in the NEW inbox; after they click it and sign back in, the auth state effect mirrors the fresh email into `users/{uid}.email` via `setDoc(..., { merge: true })`. In parallel, `/api/account/email-change-request` fires `sendEmailChangeNotice` to the OLD address with a mailto support link, so the previous owner has a trail if the request was fraudulent. Handles `auth/requires-recent-login` with a sign-out-and-back-in CTA; shows explicit errors for `auth/email-already-in-use` and `auth/invalid-email`.
- **GDPR delete now requires fresh sign-in.** `/api/account/delete` reads `auth_time` off the verified ID token and rejects with `{ code: 'requires_recent_login' }` + 401 if the user signed in more than 5 minutes ago. The dashboard delete flow catches that code and surfaces a "Sign out & sign back in" button that preserves the account disclosure state across the round trip. Closes the stolen-session abuse window flagged in the previous handoff.
- **Orphan sweep cron.** New `/api/cron/orphan-sweep` (Next.js API, `runtime=nodejs`, `maxDuration=300`) protected by a `x-cron-secret` header matched against `CRON_SECRET`. Queries memorials `where('pendingDeletionAt', '<=', now).limit(50)`, paginates each memorial's contributions (300/page), collects the hero + every contribution's photo/audio R2 keys, and hard-deletes: R2 objects (1000-key batches via `DeleteObjectsCommand`), contribution docs (400-doc batches), then the memorial doc; writes an `orphan_swept` audit event per memorial. Netlify scheduled function at `netlify/functions/orphan-sweep.mts` fires it at 03:15 UTC daily. 50-memorial cap keeps work inside Netlify's execution budget.
- **Contribution reporting + admin inbox.** Visitors on a public memorial can now report a specific memory. "Report" button renders inline after each contribution author (hidden on the demo memorial); clicking opens a modal with a reason textarea (min 3 chars) + optional email. POST hits `/api/contribution/report`, rate-limited 5/hr per IP, validates that the contribution actually belongs to the stated memorial, tags with `reporterUid` if an auth header is present, writes a `contributionReports` doc, and emails `hello@freastar.com` via `sendContributionReportAdmin`. New `/admin/reports` page lists open reports with the memorial + contribution hydrated inline and offers three decide buttons: "Hide memory + mark actioned" (flips the contribution's `status` to `rejected` then marks the report `actioned`), "Mark actioned", "Dismiss". Linked from the admin console grid.
- **Rate limit on `/api/user/exists`.** 30 requests per 300 seconds per IP via the existing `lib/rate-limit.ts` sliding window. Closes the bulk email-enumeration vector flagged in the 2026-10-02 handoff.

### Required before anything else works in production

- **`CRON_SECRET` env var required in Netlify** before the scheduled function will do anything. Generate with `openssl rand -base64 48` and set in both the Next.js runtime env and Netlify's env (same value). Without it the API route returns 503 (treated as fail-closed), and the scheduled function logs a non-match and bails. Documented in `.env.example`.
- **Firestore rules pending deploy.** `firestore.rules` was updated this session to add a `contributionReports` block (public create under constraints, super-admin only for read/update/delete). Combined with last session's `pendingDeletionAt` additions, the rules file needs a single `firebase deploy --only firestore:rules` before contribution reporting works end-to-end from the client. Until then: public `/api/contribution/report` works (admin SDK bypasses rules), the admin inbox read requires rules to be deployed.
- **No new SendGrid vars.** Reuses existing `SENDGRID_API_KEY` + `SENDGRID_FROM_EMAIL` + `SUPER_ADMIN_EMAIL` (= `hello@freastar.com`).

### Smoke tests after each deploy (new this session)

13. **Email change — happy path.** On `/dashboard`, open the Account disclosure, enter a new email you control, click Save. Firebase sends a verification link to the NEW address. Confirm the OLD address also gets a notice. Click the link in the new inbox → sign back in → `users/{uid}.email` in Firestore should match the new address.
14. **Email change — requires recent login.** Sign in, wait >5 minutes, try to change email. UI should surface `auth/requires-recent-login` and prompt sign-out-and-back-in.
15. **GDPR delete — requires fresh sign-in.** Sign in, wait >5 minutes, open the Account disclosure, type your email, click Delete. Expected: inline error with a "Sign out & sign back in" button. Click it → sign back in → retry → delete proceeds.
16. **Contribution report — happy path.** From a signed-out browser on `/m/{slug}` (not the demo), click Report on any memory, submit a reason. Expect: `contributionReports` doc created, admin email at `hello@freastar.com`, success state in the modal. Sign in as super admin, visit `/admin/reports`, see the report hydrated with the memorial and the quoted memory. Click "Hide memory + mark actioned" → verify the contribution's `status` on Firestore is `rejected` and the report's `status` is `actioned`.
17. **Contribution report — rate limit.** Fire 6 reports in a row from the same IP. The 6th should 429.
18. **Orphan sweep — dry run.** With no memorials due (`pendingDeletionAt` all null or future), POST to `/api/cron/orphan-sweep` with the correct `x-cron-secret` header. Expect: `{ ok: true, swept: 0 }`. Flip one orphaned memorial's `pendingDeletionAt` to `Timestamp.fromDate(new Date(Date.now() - 1000))`, re-run — expect: memorial doc + all contribution docs + R2 photos gone, audit event `orphan_swept` written. Wrong/missing secret: 403 or 503.

### Known limitations / unchanged

- **Three nice-to-have emails now covered end-to-end:** contribution reports, email change notice, account deletion confirmation.
- **Account deletion scrubs contributions keyed by email only.** Contribution docs don't carry a `contributorUid`; if the user contributed under a different email than the one on their account, those records won't be scrubbed. GDPR-wise, acceptable (we erased everything we could associate with them).

### Shipped earlier same day

- **Visibility simplified.** Removed the "Family only" option entirely. The dropdown on the edit page now has two choices: "Public — anyone can find it" and "Only people with the link or QR". New memorials default to `public` (previously `unlisted`). Legacy records still carrying `visibility: 'private'` are aliased to `unlisted` at read time by every gate (`app/m/[slug]/page.tsx`, `app/plot/[plotId]/page.tsx`, `app/api/upload/route.ts`, both hero-photo routes, `firestore.rules`), so no data migration is needed — old records keep working as if they were unlisted.
- **"Next Steps" card on the manage page.** Draft, owner-only. Checklist for hero photo, story, cemetery. Each row deep-links to the right place to complete the step.
- **Dedicated "The resting place" card.** Separate section promoted out of the checklist because it's a load-bearing piece of the jigsaw. Two states: pitch + CTA when no cemetery is set; summary + "Change cemetery" when one is attached. Appears for owner + not-yet-live memorials.
- **CSP widened for Google Sign-in.** `script-src` now includes `https://apis.google.com` + `https://www.gstatic.com`; `frame-src` includes `https://*.firebaseapp.com` + `https://accounts.google.com`. Signed-in popup now works.
- **10 new transactional emails.** Partner lifecycle (received, admin notice, approved, rejected), wholesale receipt, family-claimed referral, memorial payment receipt, co-manager accepted (both parties), succession completed (both parties). Added `sendAccountDeletedConfirmation` for the GDPR flow. All sends go via two new notify routes (`/api/partner/application-notify`, `/api/admin/partners/notify`) and inline hooks in `stripe/webhook`, `claim/verify`, `custody/accept`. Fire-and-forget from the two client pages (`partner/apply`, `admin/partners`) so a SendGrid blip never blocks the user flow.
- **GDPR account deletion.** `/api/account/delete` plus a quiet `<details>` disclosure labelled "Account" at the bottom of `/dashboard`. Owned memorials are handled by: (1) promote first successor, (2) else promote first co-manager, (3) else take offline + stamp `pendingDeletionAt = now + 30 days`. User's co-manager/successor seats elsewhere are removed. Contributions keyed on their email are PII-scrubbed (name/email/relationship wiped, memory text kept — belongs to the memorial's family). Partner applications and succession requests they submitted are deleted (PII-heavy). Pending custody transfers from or to them are cancelled. `users/{uid}` deleted, confirmation email sent, Firebase Auth account deleted. Super admin cannot delete through this path.

### Required before anything else works in production

- **Firestore rules pending deploy.** `firestore.rules` was updated this session so `memorialIsLive`, `memorialIsLiveAndVisible`, and the public `get`/`list` rules on `/memorials` now require `pendingDeletionAt == null`. Needs `firebase deploy --only firestore:rules` before the account-deletion soft-delete takes effect at the public-read layer. Until then the `offline: true` flag that is set alongside `pendingDeletionAt` already hides orphans — rules deploy is a defence-in-depth upgrade.
- **No new env vars.** SendGrid, Firebase Admin, and R2 vars from prior sessions cover everything.

### Smoke tests after each deploy

1. **Visibility default on new memorials.** Create a page via `/create`. Open it in Firestore — `visibility` should be `public`. Open `/memorial/{id}/edit`, the dropdown should default to "Public — anyone can find it", with only two options total.
2. **Legacy `private` records still viewable by link.** Pick a Firestore memorial with `visibility: 'private'` (if any exist) — hit `/m/{slug}` while signed out, should still render.
3. **Next Steps card.** On a draft memorial you own, confirm the "Next Steps" card shows three rows (photo / story / cemetery), each ticked/unticked by actual state, each clickable to the edit page.
4. **Resting place card.** On the same memorial, confirm "The resting place" card appears below Next Steps with the pitch + "Add cemetery details" CTA. Add a cemetery → confirm the card flips to the summary state. Confirm it disappears once the memorial is live.
5. **Google Sign-in.** On a signed-out browser, visit `/auth` → "Continue with Google" — popup should load `apis.google.com/js/api.js` without a CSP console error, complete sign-in cleanly.
6. **Partner application lifecycle emails.** Submit an application via `/partner/apply` → applicant should receive "Thanks for applying"; `hello@freastar.com` should receive the admin notice. Approve from `/admin/partners` → applicant receives "Welcome". Reject → applicant receives "About your application". Suspend → no email.
7. **Wholesale + memorial receipts.** Partner pays wholesale via Stripe test card → partner receives the wholesale receipt. Family pays direct for a memorial → owner receives the memorial live receipt. Both are in addition to Stripe's own card receipt.
8. **Family-claimed email.** Bereaved opens the claim link, sets their password → the partner on the referral receives "The family took over".
9. **Co-manager + succession emails.** Invite a co-manager → on accept, owner receives "X is now a co-manager" and invitee receives "You're a co-manager". Nominate primary → on accept, new owner receives "You now look after …" and previous owner receives "Custody has passed to …".
10. **Account deletion — happy path with successor.** Create a draft memorial as user A, nominate user B as primary successor. From `/dashboard` scroll to the "Account" disclosure, type your email, click "Delete my account". After reload: Firestore shows ownerId flipped to user B, user A's auth row is gone, confirmation email arrived at the deleted address.
11. **Account deletion — orphan path.** Same but with no successor and no co-manager. After deletion: the memorial has `offline: true`, `pendingDeletionAt` ~30 days ahead, `pendingDeletionReason: 'owner_deleted_account'`. Public `/m/{slug}` returns a not-found. The confirmation email lists the orphaned memorial with its restore deadline.
12. **Account deletion — super admin block.** Sign in as `hello@freastar.com`, open the disclosure, try to delete — should see "Super admin accounts cannot be removed through this flow."

## 2026-10-04 session handoff

### Shipped since last update

- **Legacy claim code for self-managed pages.** An owner of a `kind === 'legacy'` page can now generate a one-time printed code and store it with their will. On the manage page, a new "Legacy claim code" card (owner + legacy only) offers Generate / Regenerate; the plaintext is shown exactly once in a modal with Copy + "Print letter" (opens a printable popup pre-formatted with the code, the `/legacy/claim` URL, and the page link).
- **Public claim page at `/legacy/claim`.** Signed-in-only. User enters the code, server hashes it, matches against `memorials.legacyClaimCodeHash`, and performs a transactional custody swap: `ownerId` → claimant, previous owner prepended to `successorUids`, co-manager removed if the claimant was one, `kind` flipped from `'legacy'` to `'memorial'`, code fields deleted. Audit event `legacy_claimed`.
- **Code format.** 20 characters from the Crockford-ish alphabet (no 0/O/I/1/L), 4 groups of 5 — ~99 bits of entropy. SHA-256 hashed; only the hash + last-5-char hint persist. Dashes/spaces/casing in the printed letter don't matter when retyping (normalized before hashing).
- **Firestore rules updated and deployed.** `legacyClaimCodeHash`, `legacyClaimCodeHint`, `legacyClaimCodeSetAt` are universally locked (no client write path — admin SDK only). `kind` is now owner-only (co-managers can't flip legacy→memorial). Deployed via `firebase deploy --only firestore:rules`.

### Required before anything else works in production

- **No new env vars required for this session's work.**
- Firestore rules were deployed from this session (`firebase deploy --only firestore:rules`). No pending rules changes.

### Smoke tests after each deploy

1. **Legacy code generate + print.** Create a legacy page (or use an existing one owned by you). Open manage → scroll to "Legacy claim code" card → Generate claim code. Modal appears with the 20-char code. Click Print letter → popup opens with the formatted letter → auto-prints. Click "I've saved it". Reload the page — the card should show "A claim code is set. It ends in …XXXXX".
2. **Legacy code claim (same user).** From the owner account, visit `/legacy/claim`, paste the code → should get "You already own this page." (400).
3. **Legacy code claim (different user).** Sign in as a second account (different email). Visit `/legacy/claim`, paste the code → redirected to `/memorial/{id}/manage`. Verify: ownerId is the new user; previous owner appears in successorUids on Firestore; `kind` is now `'memorial'`; code fields are gone; manage page no longer shows the Legacy claim code card for the new owner (because `isLegacy` is now false).
4. **Regenerate invalidates old code.** Owner generates code A, prints it. Owner clicks Regenerate → gets code B. Try claiming with code A from another account → "We couldn't match that code to a page." Try with code B → succeeds.
5. **Double-claim race (optional).** The claim route uses a Firestore transaction, so simultaneous claims by two different accounts should result in one success + one 409. Hard to test manually; trust the transaction.

## 2026-10-02 session handoff

### Shipped since last update

- **Co-manager role.** A new tier between owner and successor: up to 3 per memorial (`MAX_CO_MANAGERS` in `lib/types.ts`). Co-managers can approve memories, add photos and edit the story; they cannot transfer custody, publish/go-live, change billing status, or delete. Access check is centralised in `canEditMemorial()` / `isMemorialOwner()` in `lib/roles.ts` and applied across manage, edit, gallery, memories, plaque pages and the `hero-photo` API route.
- **Firestore rules updated and deployed.** `firestore.rules` allows the co-manager update path with a per-field denylist for owner-only fields (`ownerId`, `successorUids`, `coManagerUids`, `status`, `paymentStatus`, `salesChannel`, `partnerUid`, `referralId`). `custodyTransfers` create now accepts the `'coManager'` nominationType. Deployed via `firebase deploy --only firestore:rules`.
- **Dashboard shows co-managed memorials.** New "Helping manage" section at `/dashboard` with a soft-fail listener (so clients hitting old rules won't throw).
- **Custody invite emails via SendGrid.** New `/api/custody/send-invite` route and `sendCustodyInvite()` in `lib/sendgrid.ts`. Owner can email the invite in one click (per-nomination-type copy: primary / backup / coManager) or copy the link — both options live side by side on the manage page's invite UI and in the pending-invitations list. 30-second resend cooldown. Audit event `invite_emailed`.
- **Copy-to-clipboard toast.** All five copy buttons on the manage page (public share × 2 + three invite spots) now fire a bottom-centre pill confirming "copied to clipboard". Previously silent.
- **Account creation default for invitees.** `/custody/accept/[token]` sign-in CTA now routes new invitees to the `/auth` register flow with tailored copy ("Create your account to continue"). The `?next=` round-trip is preserved.
- **Mobile polish.** Hamburger specificity fixed so the sign-out button matches other nav items; desktop nav gap restored; trimmed top/bottom padding on mobile across main containers.
- **Prior work from `2026-10-01` overnight shipment** (SendGrid for password reset + partner invites, email-already-registered UX, tracking disabled on transactional emails) is already live.

### Required before anything else works in production

- **No new env vars required for this session's work** — `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, and `SITE_URL` are already in use for password reset, and `sendCustodyInvite` reuses them.
- Firestore rules were deployed from this session (`firebase deploy --only firestore:rules`). No pending rules changes.

### Smoke tests after each deploy

1. **Co-manager invite + accept (email path).** On a memorial you own: open the "People who help manage" card, enter an email, click Send invitation, then click "Email invitation to …". Open the email, click the link, sign in with the invited email (or create an account), accept — verify the memorial appears in that user's `/dashboard` under "Helping manage" and the manage page shows the co-manager banner.
2. **Co-manager invite + accept (copy-link path).** Same flow, but Copy link → paste into a private window → confirm toast fires on copy → complete the accept.
3. **Successor invite / custody transfer.** Primary and backup nomination variants, both via email and via copy-link. On accept, ownership moves cleanly and the previous owner is preserved as a successor (verify in Firestore).
4. **Password reset and partner invite flows** (unchanged, but regress-test on each deploy).

### Branch state and GitHub

**Only branch on GitHub is `claude/ubuntu-machine-or-phone-ovt1xa` and it is the repo's default branch.** There is no `main` or `master` on origin. Netlify likely builds from this branch directly. This is fine for a solo-dev MVP but has two consequences:

- No PR review step. Every push to this branch is production. If you want a staging gate, create a `main` branch, make it the default on GitHub, and work off feature branches going forward.
- The branch name reads oddly for a trunk. Consider renaming to `main` on GitHub (Settings → Branches → Rename) and updating Netlify's build branch to match.

### Known limitations / unchanged

- **Hotmail/Outlook routes new senders to junk** on first send (reputation). Marks "Not spam" + volume over time fix this. Gmail inboxes fine already.
- **No rate limiting on `/api/custody/send-invite`.** The custody send has a 30s per-transfer cooldown but no per-IP throttle. `/api/user/exists` was throttled in the 2026-10-12 session. Add a simple IP throttle to the custody send if abuse appears.
- **No Sentry / error monitoring.** Server logs via Netlify functions only. Add Sentry if you want proactive alerts.
- **No Firestore rules regression suite.** `UAT.md` scenarios cover the ground manually. `@firebase/rules-unit-testing` is future work.
- **Firebase Storage is not enabled on the project** (we moved to Cloudflare R2). `storage.rules` in the repo is dead code; keep for now in case Storage is ever re-enabled.

---

## Older notes (pre-2026-10-02)

### Required env vars (prod)

Set in Netlify environment:

```
NEXT_PUBLIC_SITE_URL=https://www.liveonwith.me
SITE_URL=https://www.liveonwith.me

STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

FIREBASE_ADMIN_PROJECT_ID=<firebase-project-id>
FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-...@<firebase-project-id>.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

SENDGRID_API_KEY=SG....
SENDGRID_FROM_EMAIL=noreply@liveonwith.me

# Cloudflare R2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
NEXT_PUBLIC_R2_PUBLIC_URL=...
```

Stripe webhook endpoint: `https://www.liveonwith.me/api/stripe/webhook`, listening for `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_failed`.

Firebase Auth → authorised domains must include `www.liveonwith.me`.

### Direct customer flow (manual UAT)

1. Sign in at `/auth`
2. Create a memorial at `/create` — lands at manage with status "Draft"
3. "Preview" → public URL opens with preview banner
4. "Go Live · €X" → Stripe checkout
5. Stripe test card `4242 4242 4242 4242`
6. Webhook flips memorial to `live`, `paymentStatus: paid`
7. `/m/[slug]` is publicly accessible
8. QR code available at `/memorial/[id]/qr`; plot plaque at `/memorial/[id]/plaque`

### Funeral director / partner flow

1. Promote user via `/admin/partners` or set `users/{uid}.role = "funeral_director"` manually
2. Partner creates referral at `/partner/new` with bereaved email
3. Pay wholesale (test mode) → referral page auto-triggers SendGrid claim email
4. Bereaved opens link → `/claim/[id]` → account created server-side → sets password → lands on manage
5. Memorial has `paymentStatus: paid_via_funeral_director` — no payment prompt on go-live
6. Referral's `commercialStatus` flips to `live`

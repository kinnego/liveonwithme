# Status & next steps

Last updated: 2026-10-02, branch `claude/ubuntu-machine-or-phone-ovt1xa` (the GitHub default — there is no separate `main`).

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
- **No rate limiting on `/api/user/exists` or `/api/custody/send-invite`.** The custody send has a 30s per-transfer cooldown but no per-IP throttle. Add a simple IP throttle if abuse appears.
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

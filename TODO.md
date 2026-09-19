# Status & next steps

Last updated: 2026-09-18, branch `claude/ubuntu-machine-or-phone-ovt1xa`.

## Where things stand

- P0–P7 from the full implementation spec are landed locally.
  - P1 data model + roles, P2 plot QR (SVG + PNG), P3 custody transfer + succession routes,
    P4 partner apps + admin console, P5 media quotas, P6 SEO metadata + JSON-LD + kindness copy,
    P7 vitest suite + UAT checklist (`UAT.md`).
- `npm run build` green (34 routes). `npm test` green (18 unit tests across `lib/age.ts`, `lib/ids.ts`).
- Existing memorials `cathal-doherty-mugtl` and `mary-demo` preserved through the data-model
  migration via idempotent lazy backfill in `lib/plot.ts`.
- App works locally with the existing `.env.local`. New env vars needed before Stripe/Go-Live flow will function (see below).

## Required env vars before Go Live / payment works

Add to both `.env.local` and Cloudflare Pages env settings:

```
NEXT_PUBLIC_SITE_URL=https://liveonwith.me  (or your deployed URL)

STRIPE_SECRET_KEY=sk_live_... (or sk_test_ for dev)
STRIPE_WEBHOOK_SECRET=whsec_...

FIREBASE_ADMIN_PROJECT_ID=<your-firebase-project-id>
FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-...@<your-firebase-project-id>.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Get Firebase Admin credentials at:
https://console.firebase.google.com/project/<your-firebase-project-id>/settings/serviceaccounts/adminsdk → "Generate new private key"

Configure Stripe webhook at:
https://dashboard.stripe.com/webhooks → Add endpoint → `https://liveonwith.me/api/stripe/webhook` → Listen for `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_failed`

## Manual test plan

### Direct customer flow
1. Sign in at `/auth`
2. Create a memorial at `/create` — should land at manage page showing status "Draft"
3. Click "Preview" — should show memorial with amber preview banner
4. Click "Go Live · €199" — should redirect to Stripe checkout
5. Complete test payment (use Stripe test card 4242 4242 4242 4242)
6. Webhook should mark memorial as `live`, `paymentStatus: paid`
7. Public `/m/[slug]` should now be accessible
8. QR code should be available at `/memorial/[id]/qr`

### Funeral director flow
1. As admin, promote a user to `funeral_director` in Firebase console (set `users/{uid}.role = "funeral_director"`)
2. Sign in as that user, go to `/fd/new`, submit a referral
3. Bereaved contact receives email link, clicks it, lands at `/claim/[id]`
4. Memorial is created with `paymentStatus: paid_via_funeral_director`
5. Family builds the memorial, clicks "Go Live"
6. No payment prompt — memorial goes live immediately
7. Referral's `commercialStatus` becomes `live`

### Draft privacy
- Non-owner visitor to a draft's `/m/[slug]` should see "Memorial not found"
- Owner should see the preview banner

## Known gaps (not blocking launch)

- No email verification, password reset, or account deletion flow.
- No App Check / rate limiting on anonymous contribution submissions (quota total-bytes cap
  provides a coarse ceiling; single-file cap prevents obvious abuse).
- Firebase Storage rules deployment still pending (Storage isn't enabled in the project since
  we migrated to R2 — the `firebase.json` reference to storage rules can be removed, or Storage
  can be enabled if we ever want it back).
- No emulator-based `firestore.rules` regression suite yet — `UAT.md` scenarios 5, 6, 9, 10
  cover the same ground manually. Adding `@firebase/rules-unit-testing` is future work.
- Custody transfer invites are shown as shareable URLs on the manage page; there is no
  outbound email service integration yet. The custodian copy-pastes the URL to the invitee.
- Partner referral emails ditto.

## Deployment checklist

1. Push has already sent the code to the branch.
2. Verify Cloudflare Pages picks up the build and completes it (previously fixed with lazy Firebase init).
3. Add all required env vars in Cloudflare Pages dashboard.
4. Once deployed, configure the Stripe webhook to point at the deployed URL.
5. Test the two flows end-to-end using Stripe test mode.
6. Add liveonwith.me as an authorised domain in Firebase Auth → Settings → Authorized domains.
7. Set `NEXT_PUBLIC_SITE_URL=https://liveonwith.me` in Cloudflare Pages env vars.

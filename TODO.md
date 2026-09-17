# Status & next steps

Last updated: 2026-09-17, branch `claude/ubuntu-machine-or-phone-ovt1xa`.

## Where things stand

- P0 requirements from REQUIREMENTS.md are implemented (memorial lifecycle, Go Live UX, Stripe payment, funeral director paid path, QR codes).
- Brand assets wired into layout, manifest, favicons, OG tags.
- Firestore rules updated and deployed to production project `<your-firebase-project-id>`.
- Build passes locally; changes pushed but not yet verified on Cloudflare Pages.
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

## Known gaps (P1 / P2 — not blocking launch)

- On `/memorial/[id]/manage`, "Edit memorial" and "Open gallery" buttons are still placeholder buttons with no onClick.
- No email verification, password reset, or account deletion flow.
- No App Check / rate limiting on anonymous contribution submissions.
- Firebase Storage rules deployment still pending (Storage isn't enabled in the project since we migrated to R2 — the `firebase.json` reference to storage rules can be removed, or Storage can be enabled if we ever want it back).
- Cemetery mapping not implemented (P2 — data model is compatible for future work).
- No integration tests for lifecycle transitions.

## Deployment checklist

1. Push has already sent the code to the branch.
2. Verify Cloudflare Pages picks up the build and completes it (previously fixed with lazy Firebase init).
3. Add all required env vars in Cloudflare Pages dashboard.
4. Once deployed, configure the Stripe webhook to point at the deployed URL.
5. Test the two flows end-to-end using Stripe test mode.
6. Add liveonwith.me as an authorised domain in Firebase Auth → Settings → Authorized domains.
7. Set `NEXT_PUBLIC_SITE_URL=https://liveonwith.me` in Cloudflare Pages env vars.

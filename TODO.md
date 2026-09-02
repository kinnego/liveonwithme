# Status & next steps

Last updated: 2026-09-02, branch `claude/ubuntu-machine-or-phone-ovt1xa`.

## Where things stand
- Next.js + Firebase MVP is in the repo and pushed to this branch (not merged to `main` yet, no PR opened).
- `.env.local` here only has placeholder Firebase values, so every page that touches Firebase (`/auth`, `/create`, `/dashboard`, `/fd`, `/fd/new`, `/claim/[id]`, `/m/[slug]`, `/memorial/[id]/manage`) 500s locally. Only `/` renders. This is expected until a real Firebase project is connected — not a bug.
- Funeral director referral workflow is built (`/fd`, `/fd/new`, `/claim/[id]`, rules in `firestore.rules`, `lib/types.ts`) but has never run against a real Firebase project — untested end to end.
- No public/testable URL exists yet. Hosting decision so far: user picked **Cloudflare Pages** over Vercel (paywall) and Netlify; dashboard Git-import steps were given but not confirmed done.

## To do, in order
1. **Create a Firebase project** and fill in `.env.local` / the hosting provider's env vars with real values (see `.env.example` for the keys).
2. In Firebase Auth, enable **Email/Password** and **Email link (passwordless sign-in)** — the funeral director → bereaved claim flow depends on the latter.
3. Add the deployed domain under Auth → Settings → **Authorized domains** (not just localhost).
4. Create Firestore + Storage, then `firebase deploy --only firestore:rules,storage` to push `firestore.rules` / `storage.rules`.
5. When Firebase asks, enable the cross-service permission letting Storage rules read Firestore docs.
6. Deploy the app (Cloudflare Pages dashboard import — connect `kinnego/liveonwithme`, branch above, let it auto-detect Next.js, add the `NEXT_PUBLIC_FIREBASE_*` env vars). Report back any build errors so the repo config can be adjusted.
7. Once live: smoke-test the full funeral director flow — register an account, manually flip its `users/{uid}.role` to `funeral_director` in the Firebase console (no self-serve UI for this by design), submit a referral, confirm the invite email arrives, complete the `/claim/[id]` flow, confirm a memorial is created and prefilled correctly.
8. Decide whether to merge this branch into `main` / open a PR, or keep iterating on the branch first.

## Known gaps (pre-existing, not introduced this session)
- On `/memorial/[id]/manage`, the "Edit memorial" and "Open gallery" buttons are non-functional placeholders (no `onClick`, no target page yet).
- No email verification, password reset, or account deletion flow (also called out in the original README's "Before production" list).
- No App Check / rate limiting on anonymous contribution submissions.

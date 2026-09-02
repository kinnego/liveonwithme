# LiveOnWith.me

A peaceful, family-controlled memorial platform.

## Included in this MVP
- Email/password registration and sign-in
- Create a memorial with name, dates, hero photograph, epitaph, story and privacy
- Public/unlisted memorial route (`/m/[slug]`)
- Visitor memory + photo contribution form
- Contributions are pending by default
- Family moderation inbox with approve/reject/download
- Approved memories/photos flow back to the memorial
- Firebase Firestore + Storage security rules starter
- Responsive, intentionally non-social visual design
- Demo memorial at `/m/mary-demo`

## Firebase setup
1. Create a Firebase project.
2. Enable Authentication > Email/Password.
3. Enable Authentication > Email link (passwordless sign-in) — this is how bereaved contacts claim a memorial a funeral director set up for them.
4. Under Authentication > Settings > Authorized domains, add the domain(s) you'll run the app on (e.g. your Vercel/Cloudflare URL) so claim-invite emails work there, not just `localhost`.
5. Create Firestore and Storage.
6. Copy `.env.example` to `.env.local` and fill in your Firebase web config.
7. Install Firebase CLI and deploy rules with `firebase deploy --only firestore:rules,storage`.
8. When Firebase asks, enable the cross-service permission that lets Storage Security Rules read Firestore documents. This is used to make family/private storage access follow memorial ownership and visibility.

## Funeral director accounts
There's no self-service sign-up for the funeral director role — it's granted by hand so it stays limited to people you actually work with:
1. Have the funeral director register a normal account at `/auth`.
2. In the Firebase console, open Firestore > `users` > their document (matches their Auth UID), and change `role` from `family` to `funeral_director`.
3. They can now open `/fd` to see their referrals and `/fd/new` to add one — entering their commission/payout reference, the bereaved contact's details, and what they know about the deceased (name, nicknames, address, dates).
4. Saving a referral emails the bereaved contact a sign-in link to `/claim/[referralId]`. Opening it on any device creates their account (or signs them in), pre-fills a new memorial from what the director entered, and takes them straight to its family controls to add photos and the story.

## Run
```bash
npm install
npm run dev
```

## Before production
- App Check + rate limiting / anti-spam for anonymous contributions
- Server-side image processing, EXIF stripping, malware/content validation
- Email verification and password reset
- Owner editing UI for memorial content
- Role-sharing for multiple family administrators
- Account deletion, memorial export, consent/privacy/GDPR workflows
- Backups and a documented long-term archival policy
- Storage rule tests in the Firebase Emulator Suite

## Product principles
- No likes, follower counts, streaks or popularity metrics.
- Nothing contributed by a visitor publishes without family approval.
- Make export/download easy; memories should never feel held hostage.
- Privacy should be obvious in the UI, not buried in settings.

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
3. Create Firestore and Storage.
4. Copy `.env.example` to `.env.local` and fill in your Firebase web config.
5. Install Firebase CLI and deploy rules with `firebase deploy --only firestore:rules,storage`.
6. When Firebase asks, enable the cross-service permission that lets Storage Security Rules read Firestore documents. This is used to make family/private storage access follow memorial ownership and visibility.

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

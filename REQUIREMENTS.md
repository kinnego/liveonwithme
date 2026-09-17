# LiveOnWithMe — Claude Implementation Requirements

Version 1.0 • September 2026

**Purpose:** Update the existing LiveOnWithMe Next.js/Firebase MVP to support a private memorial-building experience followed by a clear "Go Live" and payment step, while supporting the funeral-director sales/referral model.

## 1. Product Goal

A user should be able to register, build the memorial completely, preview it privately, and only then choose "Go Live". Going live is the commercial activation point: direct customers pay €199 before publication; funeral-director customers are already paid for and should be recorded as paid via the referring funeral director.

## 2. Existing Architecture — Preserve

- Next.js + TypeScript application structure.
- Firebase Authentication, Firestore and Firebase Storage.
- Existing memorial, contribution/moderation and funeral-director workflows.
- Existing Firebase security rules; extend them rather than weakening them.
- Existing public memorial route `/m/[slug]` and family management routes.

## 3. Memorial Lifecycle

Introduce an explicit memorial lifecycle/state model:

- `draft` — being created/edited; not publicly live.
- `ready_to_publish` — optional internal state if useful; preview is complete.
- `awaiting_payment` — direct customer has selected Go Live but payment is outstanding.
- `paid` — payment has been confirmed.
- `live` — public memorial is available.
- `suspended` — optional future state; do not implement unless required.

**Important:** the public memorial route must not expose a draft memorial merely because a slug exists. Publication must depend on the server-authoritative live/payment state.

## 4. Standard Direct Customer Flow

1. Register/sign in.
2. Create memorial.
3. Enter deceased person's name, dates, epitaph/story and other available details.
4. Upload hero image and other photos.
5. Add/edit memories and other memorial content.
6. Invite/add family members where supported.
7. Preview the memorial exactly as a visitor would see it, but privately.
8. Show a clear final action: "Go Live".
9. On Go Live, show the €199 purchase/checkout step.
10. After successful server-confirmed payment, publish the memorial.
11. Generate/display the QR code and public memorial URL.
12. Show a confirmation screen explaining that the memorial is now live.

## 5. Funeral Director Flow

Funeral directors are a primary sales/distribution channel. They should be able to include the €199 memorial in the family's funeral bill and collect the payment themselves.

- Retail price: €199.
- Funeral director commission: €49.
- LiveOnWithMe revenue: €150.
- The funeral director uses their dedicated referral form.
- The referral must be permanently associated with that funeral director.
- The family receives the claim/setup invitation and builds the memorial.
- The family can preview the completed memorial before publication.
- When the family chooses Go Live, no second €199 payment should be requested if the referral is recorded as paid/covered by the funeral director.
- The system should record the commercial state as `paid_via_funeral_director` and retain the referral/commission information.
- The memorial becomes live only after the referral is in a valid paid/authorized state.

## 6. Direct Organic Sales

Every public memorial/QR journey should eventually be able to introduce a new customer to LiveOnWithMe. A visitor can discover LiveOnWithMe and create a memorial directly.

- Direct retail price remains €199.
- Do not expose the funeral-director €49 commission to direct customers.
- Direct customers follow the normal `draft` → `preview` → `Go Live` → `payment` → `live` flow.

## 7. Payment Architecture Requirements

- Do not trust a client-side flag such as `paid=true`.
- Payment confirmation must be authoritative/server-side.
- Use a payment provider integration appropriate for the €199 purchase; keep provider-specific code isolated so it can be changed later.
- Create an order/payment record with memorial ID, customer ID, sales channel, amount, currency, status, timestamps and provider reference.
- Prevent duplicate charging and duplicate publication.
- Use idempotency for payment completion/webhook processing.
- For funeral-director referrals, record payment coverage and commission separately from direct payment processing.
- Never allow a user to manually change payment status from the browser.

## 8. Suggested Data Model

Extend the existing Firestore model rather than replacing it. Suggested fields:

### `memorials/{memorialId}`
- `ownerId`
- `slug`
- `status`: draft | awaiting_payment | live
- `visibility`
- `paymentStatus`: unpaid | paid | paid_via_funeral_director
- `salesChannel`: direct | funeral_director
- `funeralDirectorId` (nullable)
- `referralId` (nullable)
- `publishedAt` (nullable)
- `createdAt`
- `updatedAt`

### `payments/{paymentId}`
- `memorialId`
- `customerId`
- `amount`
- `currency`
- `status`
- `provider`
- `providerPaymentId`
- `createdAt`
- `paidAt`

### `referrals/{referralId}`
- `funeralDirectorId`
- `bereavedContact`
- `deceasedDetails`
- `memorialId` (once created)
- `commercialStatus`: referred | setup | paid | live
- `commissionAmount`: 49
- `customerPrice`: 199
- `liveOnWithMeAmount`: 150
- `createdAt`
- `updatedAt`

## 9. UI/UX Requirements

- The user should feel they are building something meaningful before being asked to pay.
- The dashboard should clearly show Draft / Preview / Go Live status.
- The final CTA should be prominent and understandable: "Go Live".
- Direct customer: Go Live → payment → Live.
- Funeral-director customer: Go Live → confirmation that payment is covered → Live.
- Do not make payment feel like an unexpected upsell after completion; explain before the final click that Go Live activates the memorial.
- Draft memorials must remain private.
- The public memorial should have a clean route suitable for QR scanning on a phone.

## 10. QR Code

- A unique QR code should be associated with each live memorial.
- The QR should resolve to the canonical public memorial URL.
- QR generation should be deterministic/reproducible where practical.
- Do not expose a QR code as the primary public asset before the memorial is live.
- Design the model so the QR can later link into a cemetery/grave location experience.

## 11. Future Cemetery Mapping — Design For It Now

Do not build the full cemetery mapping feature in this task, but do not make the memorial model incompatible with it. Future structure should support:

- cemetery
- section
- row/plot
- grave
- latitude/longitude or map coordinates
- memorial association
- cemetery map asset/overlay

Future user journey: visitor enters cemetery → opens digital cemetery map → finds a grave → opens memorial → can discover LiveOnWithMe and create a memorial.

## 12. Security & Privacy

- Draft/private memorial content must not be publicly readable.
- Firestore rules must enforce ownership/family access.
- Payment/referral state must not be writable by ordinary users.
- Funeral directors may only access their own referrals.
- Anonymous visitor contributions remain pending until family approval.
- Apply App Check/rate limiting and image validation before production.
- Include GDPR/privacy, account deletion and memorial export requirements in the production backlog.

## 13. Implementation Instructions for Claude

- First inspect the existing repository and understand the current memorial and funeral-director implementations before changing code.
- Do not rewrite working functionality unnecessarily.
- Identify the smallest set of changes needed to introduce the lifecycle/payment model.
- Check existing Firestore rules and update them safely.
- Keep payment-provider code isolated behind a small service/module.
- Add automated tests for lifecycle transitions and authorization rules where practical.
- Do not mark a memorial live based solely on client navigation.
- Do not implement cemetery mapping in this phase; only prepare the data model if necessary.
- After implementation, provide a concise list of changed files, data-model changes, security-rule changes, remaining gaps and manual test steps.

## 14. Acceptance Criteria

- A new user can build a memorial without paying.
- A draft memorial can be previewed privately.
- A direct customer cannot publish without successful €199 payment.
- A funeral-director referral marked as paid can publish without asking the family to pay again.
- The system records whether the sale was direct or via funeral director.
- A funeral-director referral records €199 customer value, €49 commission and €150 LiveOnWithMe revenue.
- Payment state cannot be forged from the browser.
- A live memorial is publicly accessible through its canonical slug.
- A draft memorial is not publicly accessible.
- A QR code is available for a live memorial.
- The implementation does not block the future cemetery mapping feature.

## 15. Priority

### P0 — Core commercial flow
- Memorial draft/preview/live state
- Go Live UX
- Direct €199 payment
- Funeral-director paid referral path
- Secure server-authoritative publication

### P1 — Product completion
- QR generation
- Family administration/sharing
- Email verification/password reset
- Production anti-spam/image processing
- GDPR/export/deletion

### P2 — Expansion
- Cemetery maps
- Grave coordinates
- Cemetery operator portal
- Map-based discovery and navigation

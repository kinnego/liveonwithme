# Cemetery operator plot mapping — design plan

Status: **proposal, awaiting Cathal's sign-off.** No code yet.
Roadmap slot: REQUIREMENTS.md P2 "Cemetery operator portal" / "Grave coordinates".

## What we're building

1. **Operator map page** at `/cemetery/[placeId]/map-plots`. A satellite map of one
   cemetery where a verified operator drops pins and fills a few fields:
   section/row/plot number, surname, forenames, headstone inscription (if known),
   approximate birth and death years.
2. **Unclaimed grave records.** Each pin is stored as a grave with
   `status: 'unclaimed'` and no family admin.
3. **Suggest and adopt.** When a family picks that cemetery while creating a
   memorial or adding a resting place, we fuzzy-match the loved one's name and
   dates against that cemetery's unclaimed graves and ask "Is this the grave
   you're looking for?". If they say yes, they adopt the existing grave. If they
   say no, the flow works the same as it does today.

## What the codebase gives us already

| Need | Already there | Where |
| --- | --- | --- |
| Satellite map + draggable pin | `PlotLocationEditor` (`mapTypeId: 'hybrid'`), `loadGoogleMaps()` | `components/PlotLocationEditor.tsx`, `lib/places.ts` |
| Cemetery identity | `Cemetery.placeId` (Google `ChIJ…` or community `c-…`) | `lib/types.ts`, `lib/cemeteries.ts` |
| Grave with exact coords | `Plot.lat/lng`, `Plot.name` ("Plot 34, Row C") | `lib/types.ts` |
| Vetted professionals | `role: 'partner'` + `partnerStatus: 'approved'`, `partnerType: 'cemetery' \| 'priest_minister'` | `lib/roles.ts`, `/admin/partners` |
| A second family joining a grave | `PlotMembership` with `requested → approved` by the plot admin | `lib/plot.ts`, `firestore.rules` |
| Server writes with token check | admin-SDK API routes such as `/api/plot/*`, `checkPlotAccess()` | `app/api/plot/`, `lib/plot-access.ts` |
| Abuse limits + audit trail | `rateLimit()`, `writeAuditAdmin()` | `lib/rate-limit.ts`, `lib/audit-admin.ts` |
| Hook points in the family flow | `createPlotForMemorial()` is called from `/create` (cemetery prefill) and `/memorial/[id]/plot/new` | `app/create/page.tsx:380`, `app/memorial/[id]/plot/new/page.tsx:67` |

## Schema

### Decision A: where unclaimed graves live

You suggested making each pin a plot doc with `status: 'unclaimed'`. I'd
**recommend a separate `graveRecords` collection** instead, which gets turned
into a real `Plot` when a family adopts it. Here's why:

- **Plots are publicly readable** (`allow get, list: if true` in `firestore.rules`).
  A parish's full list of names, dates and inscriptions would be readable by
  anyone, and anyone could scrape it with a single `where('cemetery.placeId', '==', X)` query.
- **The cemetery page lists every plot at the cemetery**
  (`app/cemetery/[placeId]/page.tsx:127`). So do the create page's "plots you
  administer" lookup and `checkPlotAccess`. All of them would need a `status`
  filter.
- **Old plots have no `status` field**, and Firestore can't query on a missing
  field. That means a backfill of every existing plot before the first unclaimed
  one is written.
- **The rules require the creator to be in `plotAdminUids`**, and the code assumes
  every plot has at least one admin. An admin-less plot breaks that assumption
  in about six places.

The cost is one conversion step on adoption: create a `Plot` and copy over the
coords and label. This is about 30 lines in one server route. If you'd rather
keep it in `plots`, it still works, but add roughly a day for the backfill and
for auditing those queries.

```ts
// graveRecords/{id}  — written only via admin SDK API routes
interface GraveRecord {
  id: string;
  cemetery: Cemetery;            // same shape as Plot.cemetery; placeId is the query key
  lat: number; lng: number;      // the dropped pin
  section?: string; row?: string; plotNumber?: string;
  surname: string;               // required — the main match key
  forenames?: string;
  inscription?: string;          // free text, as read off the stone
  bornYearFrom?: number; bornYearTo?: number;   // "approximate" = a range
  diedYearFrom?: number; diedYearTo?: number;
  // match keys, computed server-side on write (see Matching)
  surnameKey: string;            // normalised surname
  forenameKeys: string[];
  status: 'unclaimed' | 'adopted' | 'withdrawn';
  adoptedPlotId?: string;        // set on adoption
  adoptedByUid?: string; adoptedAt?: unknown;
  createdByUid: string;          // the operator
  createdAt?: unknown; updatedAt?: unknown;
}
```

`Plot` gains two optional fields, so no backfill is needed:
`sourceGraveRecordId?: string` and `section?/row?/plotNumber?`. The adopted plot
gets `name` built from section, row and plot number.

### Firestore rules

- `graveRecords`: **no client reads or writes.** Everything goes through API
  routes, which check stewardship. This keeps the data private by default.
- `cemeteryStewards`: the client can read its own docs. Writes are admin SDK only.

## Tradeoff 1: gating, or who counts as "works for the church"

The Partner role is the right base, but it isn't enough on its own. An approved
funeral director in Letterkenny shouldn't be able to map plots in every
cemetery in Ireland. So we add a **per-cemetery grant** on top of it:

```ts
// cemeteryStewards/{placeId}_{uid}
interface CemeteryStewardship {
  placeId: string; uid: string;
  cemeteryName: string;
  status: 'pending' | 'approved' | 'revoked';
  // what they told us + what we checked
  roleDescription: string;           // "Parish secretary, St Mary's Killybegs"
  verificationNotes?: string;        // super-admin only: "Rang parish office 12/11"
  requestedAt?: unknown; decidedAt?: unknown; decidedByUid?: string;
}
```

A person can map plots in a cemetery only if **both** of these are true:

- they're an approved partner (`isApprovedPartner()`), and
- they have an `approved` stewardship for that `placeId`.

A super admin can always map. That's you, mapping your own pilot cemetery.

**How verification works:** it's manual, the same way partner approval works
today. The operator asks from the cemetery page ("I look after this cemetery"),
it appears in a new `/admin/cemetery-stewards` queue, and you check it (phone
the parish office, look at the diocese site) before approving. I don't think
automating it is worth it yet. Email domains don't help here, because most
small parishes run on Gmail.

**What I recommend for launch:** phase 1 has no request form. You grant
stewardship by hand from the admin page using the operator's email. The
self-serve request flow comes in phase 3, once someone besides you actually
needs it.

Revoking stewardship stops new edits. Records the steward already made stay,
and you can withdraw them in bulk.

## Tradeoff 2: data trust, so we suggest but never auto-claim

Operator data will have mistakes in it: worn stones, the wrong Patrick, Irish
and English spellings of the same name. So we follow three rules:

1. **We never write anything without a family member clicking "Yes, this is the grave".**
   No silent merges, no auto-adoption, even when the match is perfect.
2. **We show the evidence, not just the name.** Each suggestion card shows the
   inscription, section/row, years and a small satellite thumbnail with the pin,
   so the family can recognise the grave. We show at most 3 suggestions.
3. **Saying "No" costs nothing.** The family keeps going and creates a new plot
   exactly as they do today.

### Matching (server-side: `POST /api/grave-records/suggest`)

- **Candidate set is the `placeId`, not a 50 m radius.** The family has already
  picked a specific cemetery, so we just load the unclaimed records for that
  `placeId`. A parish has hundreds of graves at most, so that's one cheap query.
  A 50 m radius from the centroid would be too tight anyway, because many
  graveyards are 150–300 m across. The radius only matters when the same
  cemetery exists twice, once under a Google placeId and once as a community
  `c-` entry. I'd handle that as a phase 3 nicety: also look at records under
  other placeIds within about 300 m.
- **Normalise names.** Lowercase, strip accents (Ó → o), unify `Mc`/`Mac`, strip
  `O'`/`Ó`/`Ní`/`Uí`/`Nic` prefixes for the key. A small table of nicknames and
  Irish equivalents (Paddy/Patrick/Pádraig, Biddy/Bridget/Bríd, Mary/Máire, …)
  lives in a pure `lib/grave-match.ts`.
- **Score.** The surname has to match closely (normalised equal, or Jaro-Winkler
  ≥ 0.9). On top of that, the forename match (exact, nickname-equivalent, or
  initial) and the death-year overlap (±1 year on the operator's range) add to
  the score. A death year that clearly conflicts rules the record out. Anything
  below the threshold isn't shown.
- **No browsing.** The endpoint takes a name and returns only the top matches.
  It's rate-limited per user and IP with the existing `rateLimit()`, so nobody
  can read out the whole register by guessing names.
- **Unit tests** in `tests/grave-match.test.ts` go next to the existing vitest
  tests. This is the part most worth testing properly.

### Adoption (`POST /api/grave-records/adopt`)

This runs in one Firestore transaction:

1. Check that the record is still `unclaimed` and that the caller can edit the memorial.
2. Create the `Plot` (with coords, label and `sourceGraveRecordId`) with the
   caller as plot admin. Mark the record `adopted`.
3. Create an approved `PlotMembership` for the memorial and set `memorial.plotId`.
4. Write the audit events (`grave_record_adopted`) and notify the steward by email.

The inscription stays on the private record. Families tell their own story on
the memorial, so we don't publish an operator's transcription.

**What happens when two families want the same grave**, say two siblings: the
second family's suggestion finds the record already `adopted`. Instead of
adopting, they get "This grave is already looked after by another family
member. Ask to join?". That uses the existing `PlotMembership` `requested` flow,
and the first family approves it. Nothing new to build for that.

**What happens when someone adopts the wrong grave:** the steward sees the
adoption on their map, and a super admin can undo it from admin. Undoing
detaches the plot and sets the record back to `unclaimed`. I'd skip operator
approval of adoptions. It would leave grieving families waiting on a part-time
parish secretary, and adopting a grave only lets them attach a memorial to it.

## The operator page: `/cemetery/[placeId]/map-plots`

- The page is gated with the stewardship check through a new
  `GET /api/cemetery-steward/access?placeId=…`, the same pattern as `/api/plot/access`.
- It's a full-height satellite map that reuses the setup in `PlotLocationEditor`
  (we pull out a shared `useSatelliteMap` hook rather than copying it).
  - Tap to drop a pin, or use **"Pin where I'm standing"** (geolocation). This
    is designed phone-first, because operators will be walking the rows.
  - A bottom sheet holds the fields above, with one-tap **Save & next**.
    Section and row stick between saves, so mapping a row goes quickly.
  - Pins are colour-coded: unclaimed, adopted, and existing family plots that
    already have coords. The last group is read-only and there to stop
    double-mapping.
- A list view sits alongside the map, with search by surname, and edit or
  withdraw for the steward's own unclaimed records. Adopted records are read-only.
- Writes go through `POST/PATCH/DELETE /api/grave-records`.
- There's an entry link on `/cemetery/[placeId]`, next to the existing
  artwork link, shown only to stewards and the super admin.

## Tradeoff 3: scope and phases

You're right that this is about a week, not an afternoon. Splitting it into
phases means the most useful part, mapping your pilot cemetery, ships first,
and each phase can be released on its own.

| Phase | Scope | Rough effort |
| --- | --- | --- |
| **1. Map it** | `GraveRecord` + `CemeteryStewardship` types, rules, grave-records CRUD API, stewardship check, operator map page + list, super-admin grant-by-email on a new `/admin/cemetery-stewards` page, audit entity types | 2–3 days |
| **2. Suggest & adopt** | `lib/grave-match.ts` + tests, suggest API, suggestion card in `/create` and `/memorial/[id]/plot/new`, adopt transaction, "ask to join" when already adopted, steward email | 2 days |
| **3. Grow it** | Self-serve "I look after this cemetery" request + admin queue, undo adoption, nearby-duplicate-cemetery matching, CSV import of parish burial registers, headstone photo upload to R2 | 1–2 days, can wait |

**Out of scope for now:** public browsing of unclaimed graves, genealogy-style
search, and operators editing family-owned plots.

## Decisions I need from you

1. **Storage:** a separate `graveRecords` collection (recommended), or `plots` with a `status`?
2. **Gating:** approved partner + per-cemetery grant, with you granting by hand in
   phase 1 (recommended)? Or should any signed-in user with a stewardship grant
   be allowed, without needing to be a partner first?
3. **Adoption:** instant with undo (recommended), or held until the steward confirms?
4. **Start with phase 1 only**, then review before phase 2?

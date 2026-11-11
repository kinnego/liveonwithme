# Cemetery registers and grave adoption: agreed plan

Status: **built on branch `claude/cemetery-registers`, awaiting review (2026-11-10).**
Cathal is also contacting a church registrar about a real register.
Roadmap slot: REQUIREMENTS.md P2 "Cemetery operator portal" / "Grave coordinates".

## Goals

- Very easy to use for registrars (often volunteers) and families.
- Cheap to host and cheap to build.
- No gatekeeping work for the super admin.

## The three steps

Each step works on its own, so we can stop after any of them.

### 1. Import parish registers

- Registers come in any format, including handwritten books.
- Someone photographs the pages. AI (Claude vision) transcribes them into a spreadsheet
  and flags any word it's unsure of. The cost is roughly 5–7 cents per page, or about
  €10–15 for a 200-page register.
- The registrar checks the flagged cells in the spreadsheet.
- A one-off script imports the checked spreadsheet. There's no UI for this step.
- **For the first parish, build nothing.** Cathal uploads the photos to the project and
  Claude transcribes them by hand. This tests how readable real registers are.
- A register lists burials, not graves. Rows are grouped by section/row/plot number
  into one grave with several names, because family graves often hold 3–4 people.
- Most imported graves will have no map location. That's fine: a pin can be added later.

### 2. Registrar page (`/cemetery/[placeId]/registrar`)

- A simple list for each cemetery: search by surname, fix a typo, add a burial, and
  optionally drop a pin. On a phone, "Pin where I'm standing" uses GPS.
- Reuses the satellite map setup from `components/PlotLocationEditor.tsx`.

### 3. Families adopt a grave

- When a family creates a memorial (`/create`) or adds a resting place
  (`/memorial/[id]/plot/new`) and picks a cemetery, we fuzzy-match the name and year
  of death against that cemetery's unclaimed graves.
- We show one card: "Could this be Mary O'Donnell, died 1987, Row C?"
  - **Yes** adopts the grave. It becomes a normal `Plot` with the family as plot admin.
    If the grave has no pin yet, they drop one with the existing editor.
  - **No** carries on exactly as today.
- **Nothing is ever claimed automatically.**
- If the grave is already adopted, the family gets "Ask to join", using the existing
  `PlotMembership` request flow.
- Matching is on the cemetery's `placeId`, not a radius. Names are normalised for
  Irish spellings (Mc/Mac, O'/Ó, Paddy/Patrick/Pádraig, …).

## Who can do what

There are three account types today: family, partner, and super admin.
**Registrar is not a new account type.** It's a per-cemetery permission on any
account, much like co-managers on a memorial.

- One registrar can cover any number of cemeteries, since a parish often has several.
- **Becoming a registrar is open, with no super-admin approval.**
  - It needs a verified email.
  - The first registrar of a cemetery invites the others, so each parish polices itself.
  - Registrars can only add or fix *unclaimed* records. They can't touch adopted graves
    or memorials.
  - There's a daily cap of a few hundred records per person.
  - A "report this record" link feeds the existing reports inbox. The super admin
    removes a bad registrar with one click, only when something is reported.

## Data and privacy

- Unclaimed graves live in a separate, **private** `graveRecords` collection, not in
  `plots`. Plots are publicly readable and are listed on the cemetery page, and old
  plots have no `status` field. Adopting a grave creates the real `Plot`.
- Records are never publicly browsable. The match endpoint returns only the top few
  suggestions for a name, and it's rate-limited.
- The inscription stays on the private record and is not published on the memorial.

## Cost

- **Map:** Google Maps is already loaded in the app. The free tier (~10k map loads a
  month) far exceeds what registrars will use.
- **Matching:** one small name index per cemetery, kept in a single doc, so each
  suggestion costs one Firestore read. No paid search service.
- **AI transcription:** pennies per page, paid once per register.
- **Build:** step 1 ~1 day once a real register has been seen; steps 2 and 3
  ~1–2 days each.

## Next step

Cathal asks the registrar:
1. What format is the register in?
2. Does it record where each grave is (section/row/plot)?
3. Would they check a spreadsheet afterwards?

Then we run a hand transcription of a few pages before building anything.

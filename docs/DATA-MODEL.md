# Data model

This file records the shape of a saved job and how it lines up with the
*Comparable Sales Platform — Product Strategy Summary* (August 2026). The brief
puts Phase 0 before everything else: **design the long-term data structure
before usage scales**, so the map UI never becomes a dead-end data silo.

What follows is what the map tool writes today, what it deliberately does not
write yet, and where the seams are.

## Schema identity

Every saved job carries two version markers, and they are not the same thing:

| Field | Meaning |
| --- | --- |
| `schema` | The shape of the record — `comparable-sales-map/1`. Anything that later reads these files (a comp repository, a sync service, an importer) keys off this. It carries **no product name**: the saved corpus is the asset the strategy rests on, and a branding decision must never invalidate it. |
| `version` | The build of the map tool that wrote the file. Bumped when the tool's own migration logic changes. |

Separating them means the map tool can change freely without invalidating a
stored corpus, and the record shape can be versioned on its own schedule.

## Current record shape

```jsonc
{
  "schema": "comparable-sales-map/1",
  "version": 2,
  "id": "map_…",            // stable across saves; the map counter dedupes on it
  "title": "…",
  "subtitle": "…",

  "subjects": [ { …property… } ],   // 1..n — a portfolio has many
  "comps":    [ { …property… } ],   // 0..n

  "view": {…}, "style": {…}, "theme": {…},
  "parcelService": {…}, "exportCfg": {…}
}
```

A property record:

```jsonc
{
  "id": "subject_… | comp_…",   // canonical within the job
  "role": "subject" | "comp",
  "number": 1,                   // position within its own list
  "address": "…",
  "lat": 39.74, "lng": -104.98,
  "geocode": { "provider", "matchedAddress", "score", "precision",
               "agreement", "spreadFeet" },
  "pinned": false,               // true once hand-placed, which outranks a geocode
  "parcel": { "geometry", "apn", "owner", "area", "source" },

  "fields": { "saleDate", "salePrice", "size", "unitPrice", "notes" },

  "profile": {},                 // subjects — reserved, see below
  "verifications": [],           // comps — reserved, see below
  "source": null                 // comps — reserved, see below
}
```

## How this maps to the strategy's three records

The brief models the durable asset as **subject profile → comp relationship →
verified sale**. Here is where each one currently lives.

### Subject profile, and who is allowed to see it

`subjects[]` with a `profile` object reserved on each: property type, age range,
size or unit range, class, condition, valuation date, broad submarket.

**The subject address is not hidden from the person who entered it.** It is their
own work product, fully visible to them and to everyone in their environment —
one environment per county assessor's office or appraisal company. Redaction
happens only at the boundary between environments, when someone outside reads the
shared corpus.

That makes anonymisation an **access-layer concern, not a storage concern**. The
record is stored whole and projected down on read according to who is asking.
Stripping fields at write time would destroy the author's own file to protect
them from themselves, and it could not be undone.

| Viewer | Subject address | Subject profile | Comparable sale | Adjustments, notes |
| --- | --- | --- | --- | --- |
| Author | full | full | full | full |
| Same environment | full | full | full | full |
| Another environment | hidden | visible | visible | hidden |
| Platform analytics | hidden | aggregated | visible | aggregated |

The asymmetry is the point. A comparable sale is a recorded public transaction, so
it can be identified and verified across every environment — that is what makes a
shared corpus worth having. A subject under valuation is client work and stays
inside the firm that produced it. **The relationship between the two travels; the
identity of the subject does not.**

The split is already drawn in the right place in the record: what may cross the
boundary lives in `profile`, what may not lives in the sibling fields, so the
read-time projection is a field allow-list rather than a restructuring.

### Comp relationship

**This is the part multiple subjects forced into the open.** With one subject,
"which sale was selected against which subject" was implicit — there was only
one. A portfolio map makes it a real question.

The current model is a **shared pool**: every comparable applies to every
subject on the map. That is correct for the common portfolio case — several
holdings in one submarket valued off one set of sales — and it keeps the UI at
one list instead of a per-subject matrix.

Its limit is real and worth naming: it cannot express *comp 3 was used for
subject 2 but not subject 1*. When Phase 3 needs that, the change is additive —
a `forSubjects: []` array on each comparable, empty meaning "all", which is
exactly today's behaviour. No stored file becomes invalid.

What the map does compute, and what the reader sees, is the **nearest** subject:
distances, connector lines and legend entries are all measured to it and name
it (`0.52 mi NW of S2`). That is the relationship an appraiser reads off a
portfolio exhibit.

### Verified sale

`verifications: []` on each comparable — an append-only list, not a boolean, per
the brief's insistence that verification is a *record* preserving provenance,
disagreement and audit history. `source` is reserved for where the sale data
came from.

Nothing writes either yet. The brief's own MVP test governs here: a user should
produce a map in two to five minutes, and *"if the core workflow is not
meaningfully faster, do not add advanced themes, dashboards, AI or other
complexity yet."* A verification prompt is Phase 3 work. Carrying the field
costs nothing and means jobs saved from the first release are structured
records rather than screenshots with coordinates attached.

## What is deliberately absent

| Not built | Why | Phase |
| --- | --- | --- |
| Accounts, server storage | Everything is local: `localStorage` plus a `.cmap.json` file. No account, no upload, no backend to run. | 2 |
| Environment enforcement | `environmentId` and `createdBy` are carried but unset. With no server there is no cross-environment read to redact — the boundary is enforced where the sharing happens, which does not exist yet. | 2–3 |
| Canonical cross-job sale IDs | Requires a server to reconcile against. Property `id`s are canonical *within* a job only. | 3 |
| Verification UI | See above — it is Phase 3, and adding it now would slow the workflow the brief says to protect. | 3–4 |
| Per-subject comp assignment | Shared pool covers the portfolio case; additive when needed. | 3 |
| Comp reuse / search | Needs the repository first. | 6 |

## Alignment note

The brief's build principle orders the work: **1) make comp maps exceptionally
easy, 2) capture clean structured comp data every time, 3) build trust through
verification and audit.** This repository is squarely in (1), with the record
shape for (2) already in place and the seams for (3) marked.

The one open question worth an explicit decision before Phase 3 is the comp
relationship model above — shared pool versus per-subject assignment. It is
recorded here rather than settled silently.

On naming: the product name appears in exactly one constant
(`CMG.PRODUCT_NAME`) and **never** in the stored record. The `schema` id is
`comparable-sales-map/1` for that reason. The product will sit under the Forma
Valuation umbrella and its own name is not yet fixed; neither fact should ever
be able to invalidate a saved corpus.

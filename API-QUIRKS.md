# Where the World Anvil API differs from its documentation

Established by probing a live world. Every entry here cost a round trip to
find; the point of the file is that it should cost nobody a second one.

**The governing rule, from which most of the rest follows:** the API **ignores
keys it does not recognise and returns `success: true`**. A misspelled field, a
field belonging to another template, or a value of the wrong shape all produce
a cheerful success and no change. A successful write is therefore not evidence
that anything was written. Read it back, or check this table.

The spec is at
`wa-cdn.nyc3.cdn.digitaloceanspaces.com/assets/prod/boromir-documentation/swagger/openapi.yml`
(the Swagger UI renders client-side, so the HTML page contains no schema). Pull
the whole tree with `npm run fetch-spec` — it is deliberately not committed;
see `UPSTREAM.md`.

---

## The spec is wrong or silent

| # | Field / behaviour | Spec says | Live API does |
|---|---|---|---|
| 1 | `articleNext`, `articlePrevious` | `type: object` with `{ id }` | Coerces the object to the literal string **`"Array"`**, reports success. Only a bare UUID string works. |
| 2 | `articleParent` | `type: object` with `{ id }` | Honours `{ id }` *and* a bare string — unlike its two neighbours above |
| 3 | `primarygeographicLocation`, `secondarygeographicLocation`, `species`, `ethnicity`, `currentLocation`, `geographicLocation` | absent — appear nowhere in all 191 spec files | Accepted, reported as success, **silently discarded**. Web editor only. |
| 4 | `relatedPersons`, `plots` | absent | Do not exist on any template tried. Web-editor labels, not API fields. |
| 5 | Per-template schemas | only `article.yml` and `location.yml` are published | Every other template's fields must be established by probing |

Multi-valued reference fields take a **comma-separated string**, not an array.
An array is coerced to `"Array"` exactly as an object is.

## The spec is right, and worth reading first

These were all bugs in this server, fixed, and each is documented behaviour
that reading the spec would have caught.

| Behaviour | Where |
|---|---|
| `/world/blocks` does not exist. Blocks are listed per folder via `/blockfolder/blocks`; a Block has no `world` field at all, only `author` and `blockfolder` | root spec paths |
| `category: "-1"` on `/world/articles` means *uncategorised*, not *unfiltered*. Omit the key to list everything | `world-articles.yml` description |
| `templateType` and `world` are **required** on article create | `ArticleGenericCreate.required` |
| `folderId` and `timeline` are `readOnly` | `schemas/article.yml` |

## Undocumented, found by probing

| Behaviour | Detail |
|---|---|
| Blocks have no `content` field | The payload lives in `textualdata` (dataParser `yaml`), `tabulardata` (csv) or `jsondata` (json) |
| Block folder field is `blockfolder` | Not `folder`. Sending `folder` leaves the block unfiled — and an unfiled block cannot be enumerated |
| Two article serialisations | `PUT`/`GET granularity=2` return a `category` object with `folderId` parked at `-1`; `PATCH` returns no `category` and puts the category id in `folderId`, where `-1` genuinely means the world root |
| `timeline` rejects with 422 | *"Tried to update association from owned side"* — set it from the timeline side |
| Never Markdown-convert structured data | Block payloads are YAML/CSV/JSON. The converter turns a leading `---` into `[hr]` and YAML sequences into `[ul][li]` |
| Rate limiting | Space calls ~750ms apart; Cloudflare returns 429 otherwise |
| `/variablecollection` | Spec shows `/variable_collection`; the live API uses no underscore |

### Valid `templateType` values

Confirmed by creating one article of each against a live world; the API
publishes no enum, and `schemas/article.yml` carries only `enum: [ article ]`
for the generic case.

**Accepted (26):** `article`, `person`, `species`, `ethnicity`, `condition`,
`settlement`, `location`, `landmark`, `organization`, `formation`,
`militaryConflict`, `item`, `material`, `vehicle`, `technology`, `language`,
`myth`, `ritual`, `profession`, `rank`, `law`, `spell`, `document`, `prose`,
`plot`, `report`

`militaryConflict` is **the only camelCase value**; everything else is
lowercase. Casing is checked — `militaryconflict` is rejected.

**Rejected with 422**, including several that read like obvious guesses:
`character`, `geography`, `building`, `conflict`, `militaryformation`,
`militaryFormation`, `naturallaw`, `naturalLaw`, `title`, `titlerank`,
`tradition`, `generic`, `creature`, `monster`, `race`, `faction`, `religion`,
`event`, `quest`, `encounter`, `npc`, `deity`, `war`, `battle`,
`geographicLocation`, `sessionReport`

The display names in the web editor are frequently *not* the API value:
Character is `person`, Geographic Location is `location`, Building/Landmark is
`landmark`, Session Report is `report`, Military Formation is `formation`,
Tradition/Ritual is `ritual`, Rank/Title is `rank`.

---

## Still open

- **`/world/blocks` returns 403** rather than 404, so the route exists but is
  denied. Whether a direct `WA_APP_KEY` succeeds where the shared proxy key
  does not is untested — see *Blocked on an application key* in `ISSUES.md`.
- **Rendering is unverified** for entity references. The values persist and
  round-trip, but whether World Anvil resolves them into working links in the
  rendered article can only be confirmed by eye in the web editor.

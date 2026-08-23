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
| 6 | Block `folderId` | `readOnly` | Writable. Accepts a UUID and persists it — the only way to file a block into a web-editor folder |
| 7 | Block folder on write | `folder: { id }` | Ignored. The field is `blockfolder: { id }`, and its id is a BlockFolder integer — a UUID there returns a **500 HTML page** |
| 8 | Block `RPGSRD` | required on create | Ignored; the block inherits its template's system |
| 9 | `/world/blocks` | absent from the spec | Exists and works on a public world; `403 access_denied` on a private one |
| 10 | Block `world` | absent — a Block has no `world` field | `world: { id }` on create/update is what puts a block in a world. Omit it and the block is created against the account, in no world, reporting success. `world: "uuid"`, `worldId` and `world_id` are all ignored |

Multi-valued reference fields take a **comma-separated string**, not an array.
An array is coerced to `"Array"` exactly as an object is.

## The spec is right, and worth reading first

These were all bugs in this server, fixed, and each is documented behaviour
that reading the spec would have caught.

| Behaviour | Where |
|---|---|
| A Block *reads back* no `world` field at all, only `author`, `blockfolder` and `folderId` — but it is writable, and a block without one belongs to no world | `schemas/block.yml`, and quirk 10 above |
| `category: "-1"` on `/world/articles` means *uncategorised*, not *unfiltered*. Omit the key to list everything | `world-articles.yml` description |
| `templateType` and `world` are **required** on article create | `ArticleGenericCreate.required` |
| `folderId` and `timeline` are `readOnly` | `schemas/article.yml` |

## Undocumented, found by probing

| Behaviour | Detail |
|---|---|
| Blocks have no `content` field | The payload lives in `textualdata` (dataParser `yaml`), `tabulardata` (csv) or `jsondata` (json) |
| Block folder field is `blockfolder` | Not `folder`. Sending `folder` leaves the block unfiled |
| A Block has **two** unrelated folder fields | `blockfolder` (integer BlockFolder, made by this API, enumerable via `/blockfolder/blocks`) and `folderId` (UUID, made by the web editor, enumerable by nothing). A block filed under one reads `-1`/`null` for the other, which reads exactly like a dropped write |
| Block `tags` is a comma-separated string | An array becomes the literal `"Array"` — and the write response **echoes the array back**, so it looks like it worked until you re-read the block. The entity's `tags` is unrelated to the `tags:` key inside a block payload |
| Blocks are created `state: "public"` | Not inherited from the world, and not asked for |
| Two article serialisations | `PUT`/`GET granularity=2` return a `category` object with `folderId` parked at `-1`; `PATCH` returns no `category` and puts the category id in `folderId`, where `-1` genuinely means the world root |
| `timeline` rejects with 422 | *"Tried to update association from owned side"* — set it from the timeline side |
| Never Markdown-convert structured data | Block payloads are YAML/CSV/JSON. The converter turns a leading `---` into `[hr]` and YAML sequences into `[ul][li]` |
| Rate limiting | Space calls ~750ms apart; Cloudflare returns 429 otherwise |
| List endpoints cap a page at 50 | A larger `limit` is accepted and silently reduced — asking for 400 returns 50, with nothing to say the result is partial. Page with `offset` until a short page comes back. Fallen London holds 402 blocks; a single unpaged call shows 50 of them and looks complete |
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

## Publication is reachable, and not guarded

`state` (`enum: [public, private]`) and `subscribergroups` are both settable,
on create and on update. `state` is not `readOnly` in the spec.

This server does not expose `state` on the article tools, but that is not a
guard: `fields` is an arbitrary passthrough, so `fields: { state: "public" }`
publishes. `state` is also exposed outright on `create`/`update` for `marker`,
`timeline`, `era` and `history`.

See ISSUES.md #4. Treat any agent-driven write as capable of publishing.

## The one that cannot be caught by reading the write back

A block's world membership appears on **no field of the block, at any
granularity**: an orphan and a block genuinely in a world are structurally
identical. `/world/blocks` is the only witness — and it is denied on a private
world, so on a private world the association cannot be verified at all.

This is the exception to the rule at the top of this file. Everywhere else,
reading the entity back catches the silent write. Here it cannot, which is why
`world_id` is required rather than defaulted. See ISSUES.md #12.

## Still open

- **Whether a written `folderId` files a block where the web editor shows it**
  is unverified — nothing reads the UUID back except the block. Check the first
  one by eye.
- **Rendering is unverified** for entity references. The values persist and
  round-trip, but whether World Anvil resolves them into working links in the
  rendered article can only be confirmed by eye in the web editor.

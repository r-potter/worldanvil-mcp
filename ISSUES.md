# Issues

Defects found driving `worldanvil-mcp@1.12.0` against a live World Anvil world, ordered by what they actually cost. Each carries the symptom that exposed it, because that is the part which is hard to reconstruct later.

**Verify every fix against the Sandbox world**, never Fallen London — see [CLAUDE.md](CLAUDE.md#testing).

**Upstream?** marks whether a fix looks like a general bug worth a pull request, or a local preference better kept in a fork.

Fixes that have actually landed are catalogued in [UPSTREAM.md](UPSTREAM.md), alongside the local decisions a future merge from upstream must not undo.

[API-QUIRKS.md](API-QUIRKS.md) records where the live API differs from its own OpenAPI spec — read it before diagnosing anything new, because the recurring cause of the defects below is that the API ignores unrecognised keys and returns `success: true`.

---

## 1. Response payloads are enormous — *upstream: probably, behind a flag*

**Symptom.** Publishing six articles cost more tokens in responses than in the article content being sent.

**Detail.** `create_article` returns the complete entity: around 130 fields, of which nearly all are `null` — the entire `ggm*` NPC-generator block, the divine block, every unused Person field — plus the full `world` object with every subscriber group inlined, repeated on every single call.

**Fix.** Return the identifiers and the fields that were actually set. If the full entity is wanted, put it behind a `verbose` parameter rather than making it the default. The same applies to `update_article`, which returns a smaller but still redundant object.

**Impact.** Highest of anything here for an agent-driven workflow.

**Status — fixed and verified against Sandbox on 2026-08-16.** `compactEntity`
in `src/response.js` drops null/empty fields and collapses nested entities to
`{ id, title, slug, url }`. Wired into `create_article` and `update_article`
only; `verbose: true` returns the raw entity. Field values are returned whole —
abridging them would force a verbose re-call to verify a write, costing the
full payload on top of the wasted first call. Tests in `test/response.test.js`
run against `test/fixtures/article-write-response.json`, a real PUT/PATCH pair
captured from Sandbox.

Measured on that captured payload:

| | raw | compacted |
|---|---|---|
| `PUT /article` | 3548 B, 90 keys (54 null) | 1559 B — **56% smaller** |
| `PATCH /article` | 497 B, 14 keys | 451 B — 9% smaller |

**What the live capture corrected.** The entity is at the top level with no
wrapper, so the compaction is safe. `world.subscribergroups` really is inlined
with both Sandbox groups, as described above — that is the single biggest win.
But `update_article` was never the problem: its response is already 497 bytes,
so the "smaller but still redundant" note above overstates it and compaction
buys almost nothing there. The 90 keys are for a *generic* article; a Person
template will carry more.

**Deliberately left in.** 659 of the remaining 1559 bytes are display and
permission defaults the caller never set — `displaySidebar`, `allowComments`,
`showInToc`, `isEmphasized`, `displayTitle`, `coverSource`, `cover` and ten
more. Dropping them would need a hardcoded denylist that drifts as World Anvil
adds fields; 56% was judged enough. Do not add one without a fresh reason.

The `folderId: -1` in the compacted output is issue 8 and is left alone.

---

## 2. `list_articles` does not list articles — *upstream: yes*

**Symptom.** Called on a world with dozens of articles it returned exactly **one** — the single article sitting in the world root — and returned it regardless of `limit`, with an empty result at any `offset`.

**Why it matters.** It looks like a complete listing. Trusting it is how duplicate articles get created, and World Anvil accepts duplicate titles silently, disambiguating with a `-1` slug suffix that is the only warning given.

**Fix.** Paginate properly, or remove the tool so nobody relies on it. The current working practice is to call `get_category` on the target category *and every child category* instead, which is correct but ought not to be necessary.

**Status — fixed and verified against Sandbox on 2026-08-16.**

**It was never a pagination bug.** `listArticles` hardcoded `category: { id: "-1" }`
whenever no category was passed, and `-1` is the *world root*, not "no filter".
Every listing was therefore filtered to root. Fallen London's root holds exactly
one article, which is why `limit` appeared to have no effect and any `offset`
came back empty — there was only ever one row to page through. `limit` and
`offset` both work correctly and always did.

The fix is to stop sending the key. Measured on Sandbox with one article placed
inside a category:

| request | articles | categorised one visible |
|---|---|---|
| no `category_id` (new default) | 5 | **yes** |
| `category_id: "-1"` | 4 | no |
| `category_id: <category>` | 1 | yes |

`category_id` is now exposed on the tool, so filtering to one category — or to
the root with `"-1"` — is available deliberately rather than by accident. The
`get_category` walkaround is no longer necessary.

Tests in `test/list-articles.test.js`.

---

## 3. Three silent write failures — *upstream: yes*

**The priority class.** Each reports `success: true` while doing nothing, or while discarding what was sent.

**3a. `update_block` discards statblock content.** Passing content to a statblock block returns success and changes nothing. Worked around by generating payloads for manual paste.

> **Status — fixed and verified against Sandbox on 2026-08-16. The diagnosis
> above was wrong, and so was the suggested fix.**
>
> Nothing "discards" anything and the write path was never broken.
> `update_block` was building its payload out of a field that does not exist:
> **a Block has no `content` field at all.** Its payload lives in one of three
> fields selected by the block's `dataParser`:
>
> ```
> dataParser:   "yaml"
> textualdata:  "hit_points_current: '5'\nconditions: dead\n..."
> tabulardata:  null      # csv
> jsondata:     null      # json
> ```
>
> The API accepted `{ content: ... }`, ignored the unknown key, and returned
> `success: true` — correctly, from its point of view.
>
> **A second, independent bug sat behind it.** The handler ran
> `markdownToBBCode()` over the payload. Block data is YAML/CSV/JSON, not
> prose, and the converter mangles it: a leading `---` becomes `[hr]`, and YAML
> sequences become `[ul][li]`. So even with the field name corrected, the
> payload would have been corrupted in transit. Both fields are now sent
> verbatim.
>
> The fix is therefore to make the write *work*, not — as suggested under
> **Fix** below — to make it error. Sending `content` now raises an error
> naming the correct parameter, but that is the smaller half.
>
> `create_block` accepts a payload too, and never offered one; it now does, so
> a populated statblock takes one call instead of two. The
> generate-for-manual-paste workaround is no longer needed.
>
> **A third instance of the same bug turned up next door.** `create_block` sent
> `folder: { id }`; the field is `blockfolder`. So `folder_id` had never worked
> — every block created through this server landed unfiled, silently. That
> matters more than it sounds, because **an unfiled block cannot be
> enumerated**: listing goes through `/blockfolder/blocks`. Both `create_block`
> and `update_block` now send `blockfolder`, verified against Sandbox.
>
> **`list_blocks` is broken at the API, not here.** `/world/blocks` is absent
> from the published surface — Swagger documents only `/world/blockfolders`
> and `/blockfolder/blocks` — and returns `403 access_denied` on every call
> tested. It is a real route (it answers with structured JSON rather than an
> HTML 404, unlike `/user/blocks`), so it has not been removed, but the 403 is
> now translated into an error naming the working path: list folders, then list
> blocks per folder. Whether the 403 is tier- or account-dependent, or whether
> a direct `WA_APP_KEY` would succeed where the shared proxy key does not, is
> untested — see *Blocked on an application key* below.
>
> Consistent with all of this, a Block has no `world` field at all; it carries
> `author` and `blockfolder`.
>
> Tests in `test/blocks.test.js`.

**3b. Entity-reference fields accept plain strings.** *(Explained by issue 6: `species` and `ethnicity` are not writable through the API at all, in any shape. `references` now refuses them rather than reporting success.)*

Original note: `ethnicity` and `species` on the Person template want a link to an article. Passing a string returns `success: true` and changes nothing at all. Any field of this kind likely behaves the same way; the list should be established rather than discovered one at a time.

**3c. Wrong link prefixes resolve nowhere.** `@[Display](type:ID)` requires the prefix to match the target's entity class — `person:`, `organization:`, `article:`, `location:`. A mismatched prefix produces a link that looks correct and goes nowhere, with no error. Known entity classes should be validated, and an unknown or mismatched one should raise.

**Fix.** All three should error rather than succeed quietly. A caller writing correct-looking code against a success response will not find out for a long time.

---

## 4. `state` and `subscribergroups` cannot be set — *decision, not a defect*

**Symptom.** Absent from `create_article`, `create_category`, `update_category` and `create_secret`. Every publication therefore ends in manual work in the web editor.

**Do not simply add them.** The consuming project relies on this omission as a safety property — it makes *"nothing is published as a side effect"* mechanically true, and that is load-bearing for a world containing material that must never become public.

**If exposed**, the guard needs re-establishing somewhere explicit: an opt-in flag, a confirmation step, or a server-level setting that defaults to refusing. Decide the design before writing the code.

**Related:** newly created **categories** land `public` while articles land `private`. That asymmetry is a genuine hazard — a new category is exposed the moment it is created — and is worth fixing regardless of the above.

---

### Status — investigated 2026-08-16. **The premise is wrong, and the safety property does not hold.**

**Both fields are fully settable through the API.** This is not a side effect
of the `"Array"` coercion in issue 6 or of any other shape problem — they
simply were never exposed by this server.

| | verified against Sandbox |
|---|---|
| `state` on create *and* update | settable; `enum: [public, private]`, and **not** `readOnly` in the vendor spec |
| `subscribergroups: [{ id }]` | settable, including several groups at once |
| `subscribergroups: "uuid"` | silently ignored |

Note this **inverts** the shape rule from issue 6: for `subscribergroups` the
documented array-of-objects is correct and the bare string fails silently,
the opposite way round from `articleNext`. Shapes are per-field; there is no
general rule to lean on.

#### *"Nothing is published as a side effect"* is not mechanically true

Two holes, neither of which required anything exotic to find:

1. **`fields` is an arbitrary passthrough.** `create_article` and
   `update_article` do `Object.assign(data, convertFieldsToBBCode(args.fields))`,
   so `fields: { state: "public" }` publishes. Confirmed live through the MCP
   server: the article came back `state=public`. The absent `state` parameter
   never prevented publication — it only made it non-obvious.
   (`subscribergroups` happens to be blocked, but only by the scalar guard
   added for issue 6, and incidentally rather than by design.)

2. **`state` is already exposed outright on eight tools** —
   `create`/`update` for `marker`, `timeline`, `era` and `history`, each with
   `enum: ["public", "private"]` in its schema.

So the property holds only for articles, categories and secrets, and only
against a caller that does not touch `fields`.

#### Decided, not yet built

Nothing was changed in this pass — deliberately, since the guard design was
reserved. The agreed direction is that `state` and `subscribergroups` **should**
become first-class parameters on the article tools, **behind a guard**, rather
than staying absent while remaining reachable through `fields`.

The guard has to come first, because it does not exist yet. The options
sketched at the top of this issue still stand; a server-level setting that
defaults to refusing is the only one that also covers the `fields` passthrough
and the eight tools above without being added per tool.

**Until then, treat any agent-driven write as capable of publishing.** A world
holding material that must never become public is not protected by this server
today.

---

## 5. Field length caps return raw SQL, and roll back their neighbours — *upstream: yes*

**Symptom.** An over-length value on a capped field — `currentstatus` is 255 — returns a **422 carrying `Data too long for column`**, a raw database error rather than anything a caller can act on.

**The worse half.** The update is a single statement, so **every other field in the same call is rolled back with it.** A long value in one field silently discards the correct values sent alongside it.

**Fix.** Validate lengths client-side before sending and report *which* field failed and by how much. Failing that, at minimum translate the SQL error into something readable.

---

## 6. Entity-reference fields are not exposed at all — *upstream: yes*

`relatedPersons`, `plots`, `primarygeographicLocation`, `relatedReports`, `articleNext` and `articlePrevious` cannot be set through the server.

**Impact.** This is the sole reason cross-linking session reports to their related articles cannot be scripted, and it is exactly the kind of bulk relational work an API is for. Currently entirely manual web-editor work.

**Status — implemented and verified against Sandbox on 2026-08-16, but the
field list in this issue was partly wrong.**

These are stored as **scalar strings holding article UUIDs**, comma-separated
when a field takes several. The published OpenAPI schema documents the write
shape as a nested `{ id }` object — and for `articleParent` that works, but
for `articleNext` and `articlePrevious` the live API coerces the object to
the literal text **`"Array"`** and reports success. The plain string form is
correct for every writable field tested.

| shape sent | `articleParent` | `articleNext` |
|---|---|---|
| `{ id: uuid }` (as documented) | correct | `"Array"` |
| `"uuid"` | correct | correct |

A new `references` parameter on `create_article` and `update_article` accepts
either shape — bare UUID or the documented `{ id }` — plus arrays of either,
and normalises everything to the string form the API actually stores, joining
arrays with commas. A caller following the official documentation therefore
succeeds. `fields` refuses object values, which hit the coercion unmediated.

**Which of the six named fields are real:**

| field | verdict |
|---|---|
| `articleNext` | writable |
| `articlePrevious` | writable |
| `articleParent` | writable (resolves to an object on read) |
| `relatedReports` | writable |
| `locations` (plot) | writable |
| `primarygeographicLocation` | **accepted and discarded** — success, stays null |
| `secondarygeographicLocation` | **accepted and discarded** |
| `relatedPersons` | **does not exist** on any template tried |
| `plots` | **does not exist** on any template tried |

`relatedPersons` and `plots` appear to be web-editor labels rather than API
fields; the Report template carries `rewards`, `quests`, `interactions`,
`relatedReports` and `reportNotes` instead. Also discarded: `species`,
`ethnicity`, `currentLocation` (person) and `geographicLocation`
(organization) — which is **issue 3b, now explained**: they are not a
string-versus-object problem, they are simply not writable through the API.
`timeline` is different again, rejecting with a 422 *"Tried to update
association from owned side"* — it is set from the timeline side.

All six discarded fields are refused by `references` with an error saying so,
rather than passed through to report a write that did not happen.

**Session-report cross-linking now scripts.** Verified end to end: chaining
Session 4 → Session 5 with `articleNext`/`articlePrevious` and populating
`relatedReports`. The location anchoring in the original complaint cannot be
scripted, and that is World Anvil's limit rather than this server's.

**Checked against the vendor OpenAPI spec** (linked from the Swagger UI at
`wa-cdn.../boromir-documentation/swagger/openapi.yml`). It confirms
`timeline` is `readOnly`, and `templateType` and `world` are required on
create. It does not publish the per-template schemas — `report.yml`,
`person.yml` and friends return 403 — so the discarded fields above are not
documented anywhere, and the empirical findings remain the only source.

Tests in `test/references.test.js`.


---

## 7. 30-second timeout on large multi-field calls — *upstream: investigate*

**Symptom.** A call setting four or five long fields timed out at 30 seconds.

**Mitigating detail.** When it fired, the write had landed **nothing** — `updateDate` was unchanged — so a timeout is safe to retry. But that is only knowable by reading the article back, and a timeout is otherwise indistinguishable from a partial write.

**Fix.** Establish whether the timeout is client-side and configurable. Either way the error should say whether anything was committed.

---

## 8. `folderId` in responses is not the category — *upstream: maybe; possibly a passthrough*

**Symptom.** Create responses return `folderId: -1` even when `category_id` was supplied and applied correctly. Some update responses return the real category; others return `-1` for the same article.

**Why it matters.** It reads exactly like the category having been silently dropped. It cost a needless round trip to disprove — the authoritative value is the `category` object returned by `get_article`.

**Fix.** Map it correctly, or omit it from responses so it cannot mislead. May be upstream API behaviour passed through unchanged, in which case document it.

**Status — fixed and verified against Sandbox on 2026-08-16. Not a malformed
request, and `folderId` is not mismapped.**

The requests were always correct: the category applies every time, confirmed by
reading the article back. `folderId` is not wrong either. World Anvil has **two
article serialisations, and each is internally consistent**:

| response | `category` | `folderId` |
|---|---|---|
| `PUT` (create) | the real category object | `-1` always — carries nothing |
| `GET` granularity=2 | the real category object | `"-1"` always — carries nothing |
| `PATCH`, article in a category | absent | **the category's UUID** |
| `PATCH`, article in the world root | absent | `"-1"`, correctly meaning root |

So "some update responses return the real category; others return `-1` for the
same article" was never inconsistency — it is whether the article *has* a
category, read through a summary serialisation in which `folderId` is the
container id. The misleading half is the *full* serialisation, where `folderId`
sits at `-1` next to a perfectly good category and reads as though the category
had been dropped.

`normaliseArticleCategory()` in `src/response.js` reconciles the two on article
writes: `category` becomes the single answer — present means that category,
absent means the world root — and the raw `folderId` is removed. Applied to
`create_article` and `update_article` only; a Block also carries `folderId` and
means something different by it. `verbose: true` still returns the untouched
entity.

Tests in `test/response.test.js`.

---

## 9. `create_article` rejected every call that omitted `template` — *upstream: yes*

**Symptom.** Found 2026-08-16 while probing issue 8: a create with only `title`
and `world_id` — exactly what the schema said was required — returned a **422
carrying a PHP stack trace**, `missing required field 'templateType'`.

**Why it matters.** The tool advertised `template` as optional and the API
treats it as mandatory, so the documented minimal call could never work. It had
not been noticed because every real caller happened to pass a template.

**Status — fixed 2026-08-16.** `template` is now in the schema's `required`
list, and the handler refuses the call before it reaches the network so the
failure reads as a sentence rather than a stack trace. Marking it required
rather than defaulting to `"article"` was deliberate: a template cannot be
changed later without losing template-specific fields, so a silent default
would quietly commit the caller to the wrong one.

---

## 10. Field-selective `get_article` / `update_article` — *upstream: yes*

**Not yet built.** Recorded 2026-08-16.

**Want.** A pair of article read/write calls that take an explicit list of
field names and return only those fields. Reading one value out of an article
should not cost the whole entity.

**Why it is not already covered by issue 1.** `compactEntity()` is wired into
`create_article` and `update_article` only. `get_article` is untouched and
returns everything — and reading is the more common operation. Compaction also
only removes *empty* fields; it cannot express "just the title and content",
because a populated field is by definition worth keeping under that rule.

**Measured** against a real Person article (`get_article`, Sandbox):

| `granularity` | bytes | keys | `content` present |
|---|---|---|---|
| `-1` | 456 | 15 | no |
| `0` | 3,132 | 138 | no |
| `1` | 9,454 | 144 | **yes** |
| `2` (current default) | 11,031 | 202 | yes |
| `3` | 11,868 | 204 | yes |

**Design notes, from those numbers:**

- **`granularity` is the only server-side lever and it is coarse.** There is no
  field selection in the API, so the filtering has to happen client-side. That
  saves tokens — the thing that actually costs — but not bandwidth or latency.
  Worth being explicit about in the tool description so nobody expects
  otherwise.
- **`granularity=-1` is a genuine bargain at 456 bytes** and is not exposed at
  all today. It answers "does this exist, what is it called, what is its URL"
  for 4% of the current cost. Probably deserves its own thin tool, or a
  documented `fields` shorthand, independent of the general mechanism.
- **Drop the default to `granularity=1` when `content` is wanted** and `2` only
  when a template-specific field is asked for: 9,454 vs 11,031 bytes for the
  same content. Check first which fields vanish between 1 and 2 — 58 keys do,
  and some are template fields callers will legitimately want.
- **Always return `id`**, and probably `title`, whatever is asked for.  A
  response the caller cannot identify is a false economy.
- **An unknown field name must error, naming the article's template.** Field
  names are template-dependent (a `report` has `relatedReports`, a `person` has
  `species`), so a typo would otherwise return an empty object and look like an
  empty article. That is the failure mode this whole file is about; the new
  tool should not add another instance of it.
- **Compose with `verbose`, do not fight it.** `verbose: true` already means
  "give me the raw entity"; an explicit field list should win over both
  compaction and verbose, or the precedence needs stating.

**For `update_article`**, the equivalent is echoing back only the fields that
were written, which is what a caller checks after a write. The compacted
response already approximates this, but by accident rather than by contract.

---

## 11. Block `tags` and folder filing are still unreachable — *upstream: investigate*

**Not yet built.** Recorded 2026-08-16, while importing the first spell statblock
into Fallen London — block `1687174`, *Discern Composition*.

**The content write itself is sound.** This is the other half of issue 3a, and
that fix holds up live: `create_block` with `textualdata` round-tripped
**byte-identical**, including curly apostrophes, en dashes, `[b]` BBCode and
literal `\r\n` escapes, and a follow-up `update_block` persisted an added
`blockId` key. Nothing below is about the payload.

**Symptom.** A block created through the server cannot be made to match the
blocks already in the world. Two metadata fields are unreachable:

| | existing spell blocks | block created via MCP |
|---|---|---|
| `tags` | `spell-matter-1` | `null` |
| `folderId` | `93837178-…` (Spells) | `-1` (world root) |

**`tags` has no parameter at all** on `create_block` or `update_block`. Note the
trap: the block *payload* has its own `tags:` key, and setting it does **not**
populate the entity's `tags` field. The payload sent for `1687174` contained
`tags: spell-matter-1` and the entity still came back `tags: null`. They are
different things with the same name.

**`folder_id` is typed `number`**, but every real `folderId` in this world is a
UUID — `93837178-ac6f-4217-b826-6f66250cfc4b` for Spells, `88bc9e9e-…` for
merits, `1dc3a49e-…` for dread powers, `1ca15d18-…` for attainments. So the
parameter cannot express the value it needs, and the block landed unfiled. This
sits oddly beside 3a's *"Both `create_block` and `update_block` now send
`blockfolder`, verified against Sandbox"* — the wiring may be right while the
parameter type makes it unusable against a world whose folders predate it.
**Establish whether Sandbox's folders are numeric and Fallen London's are UUIDs
before changing anything.**

**The folder entity does not resolve either.** Against Fallen London:

| call | result |
|---|---|
| `list_blockfolders(world)` | `[]` — empty, though blocks sit in six distinct folders |
| `get_blockfolder("93837178-…")` | `404 resource_not_found` |
| `list_blocks_in_folder("93837178-…")` | `404 resource_not_found` |

So the UUID on a block's `folderId` is not the id of any enumerable BlockFolder,
and the documented "list folders, then list blocks per folder" path returns
nothing on a world with 137 blocks. Whether `folderId` is a different namespace,
or block folders are user-scoped rather than world-scoped, is the thing to find
out first.

**`list_blocks` does not 403 here, contradicting the note under *Blocked on an
application key*.** `/world/blocks` answered normally against Fallen London in
proxy mode, returning all 137 blocks across three pages of 50, with `limit` and
`offset` both behaving. Either the 403 is world- or account-specific, or it has
since changed. Recheck before removing the endpoint as unavailable — and note
that with `list_blockfolders` returning empty, `list_blocks` is currently the
*only* way to enumerate blocks at all, which inverts the guidance in 3a.

**Why it matters.** 267 of the 296 spells in the vault's `Game Mechanics/Spells`
JSON are not yet mirrored. Importing them today would produce 267 untagged,
unfiled blocks in the world root, each needing hand-correction in the web
editor — strictly worse than the manual work it replaces. The tags carry the
arcanum and level (`spell-death-3`), so they are not cosmetic. **The bulk import
is blocked on this, and only on this.**

**Fix.** Expose `tags` on `create_block` and `update_block`. Establish what
`folderId` actually refers to and make `folder_id` accept it, whatever its type
turns out to be. Both want verifying against a world with pre-existing folders,
not only against freshly created ones.

**Status — fixed and verified against Sandbox on 2026-08-16.** Both fields are
reachable now. The framing above was right that something was missing and wrong
about what: it is not that Sandbox's folders are numeric and Fallen London's are
UUIDs, but that **a Block has two unrelated folder fields and the two worlds use
different ones**.

| field | id | who sets it | enumerable by |
|---|---|---|---|
| `blockfolder` | integer (`42875`) | `create_blockfolder`, i.e. this server | `list_blocks_in_folder` |
| `folderId` | UUID (`93837178-…`) | the web editor | nothing |

They do not track each other. A block filed correctly into BlockFolder 42875
reads back `blockfolder: { id: 42875 }` and **`folderId: "-1"` regardless** —
so 11's *"`folderId` `-1` (world root)"* was not evidence the block landed
unfiled, exactly the misreading issue 8 describes for articles. Conversely
Fallen London's blocks read `blockfolder: null` with a UUID `folderId`, which is
why `list_blockfolders` returns `[]` there: the world has no BlockFolders at
all, only web-editor folders.

**The UUID is writable, and that is what unblocks the import.** `folderId` is
marked `readOnly` in the vendor spec and is not — it accepts a UUID and persists
it. That is the only way to file a block alongside ones made in the web editor.
The UUID resolves through no endpoint tested (`/blockfolder`, `/category` and
`/article` all 404), and sending it as `blockfolder: { id }` returns a **500
carrying an HTML page**, so the two systems cannot be conflated.

`folder_id` is therefore typed `["number", "string"]` and routed by shape:
integer → `blockfolder`, UUID → `folderId`, anything else refused by name.

**`tags` is a comma-separated string**, and an array becomes the literal
`"Array"` — the `articleNext` coercion from issue 6, one field further on. Worse
here: the write response **echoes back the array you sent** while the stored
value is `"Array"`, so nothing looks wrong until the block is read again. Arrays
are joined client-side; both shapes work.

**`list_blocks` is world-dependent, not key-dependent.** With one token, in
proxy mode, on the same afternoon: 137 blocks on Fallen London, `403
access_denied` on Sandbox. Not explained by either obvious candidate — both
worlds have an RPG system set, and Sandbox still 403d after blocks existed in
it. So the note under *Blocked on an application key* overstates its case: the
endpoint plainly works, and an app key may not be what stands between Sandbox
and a listing. The 403 message no longer claims otherwise, and no longer
recommends the folder walk without qualification — that walk sees only
BlockFolder-filed blocks, so on Fallen London it would report zero.

**Two more silent-ignore instances, found in passing and not acted on:**
`RPGSRD: { id }` on create is discarded (the block inherits its template's
system) even though the spec marks it required; and **blocks are created
`state: "public"`**, which belongs with issue 4 rather than here.

**One thing left to verify by eye, and it cannot be done through the API.**
Persisting `folderId` is confirmed; whether the web editor then *shows* the
block in that folder is not, because nothing reads the UUID back except the
block itself. The evidence is circumstantial but strong — all 29 spell blocks
share one UUID, the merits another. **Import one spell first and look at it in
the editor** before running the remaining 266.

Tests in `test/blocks.test.js`.

**Carry into the import: page references are `MtAw p. 123`, spaced.** APA style,
and the settled convention. The vault JSON is already normalised to it — all 72
references across the ten `Game Mechanics/Spells/*.json` files. **World Anvil is
the inconsistent copy**: block `1634793` (Control Instincts) alone carries both
`MtAw p. 126` and `MtAw p.289`, so the unspaced form is scattered through the 29
blocks that predate this. Do not reconcile them by hand and do not revert the
vault to match — the bulk import rewrites these blocks from the JSON anyway, so
the inconsistency resolves itself as a side effect. Just do not introduce a
`p.123` on the way through.

---

## Blocked on an application key

**Status: requested, not yet issued (as of 2026-08-16).** The server currently
runs in proxy mode — `WA_AUTH_TOKEN` only, with the shared public proxy
injecting its own application key. Setting `WA_APP_KEY` switches to direct mode
against `www.worldanvil.com`. Three things are waiting on that.

**1. The `list_blocks` 403.** `/world/blocks` returns `403 access_denied` on
Sandbox, while `/world/articles`, `/world/categories` and `/world/blockfolders`
all work on the same world with the same token.

**Weakened by issue 11, 2026-08-16.** The same call, same token, same proxy
mode, succeeds on Fallen London — 137 blocks across three pages. So this is
*world*-scoped, not application-scoped, and an app key is no longer the obvious
suspect. Worth one call when the key arrives, but expect it to change nothing.

```bash
WA_APP_KEY=<key> WA_AUTH_TOKEN=<token> node -e "…listBlocks(SANDBOX)…"
```

If it succeeds, remove the 403 translation added in `api-client.js` and
`list_blocks` becomes genuinely useful. If it still 403s, the endpoint is not
available to this account at all and should be removed rather than explained.

**2. 86 integration tests that have never run here.** `test/api.test.js` (75
cases) and `test/timeline.test.js` (38 cases) both gate on
`WA_AUTH_TOKEN && WA_APP_KEY` and skip wholesale without both. Requiring the
key was deliberate — commit `d9bee80`, *"require both credentials for
integration tests to avoid proxy flakiness"* — so this is not a bug to fix by
loosening the gate. It does mean every fix in this file has been verified by
hand-written probes rather than by the suite that exists for the purpose.

**3. Issue 7, the 30-second timeout.** Direct mode removes the proxy hop
entirely, which is the cleanest way to establish whether the timeout is
client-side, proxy-side, or World Anvil's. Investigate that one *after* the key
arrives rather than before.

---


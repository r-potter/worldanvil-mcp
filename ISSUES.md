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


---

## 4. `state` and `subscribergroups` cannot be set — *decision, not a defect*

**Symptom.** Absent from `create_article`, `create_category`, `update_category` and `create_secret`. Every publication therefore ends in manual work in the web editor.

**Do not simply add them.** The consuming project relies on this omission as a safety property — it makes *"nothing is published as a side effect"* mechanically true, and that is load-bearing for a world containing material that must never become public.

**If exposed**, the guard needs re-establishing somewhere explicit: an opt-in flag, a confirmation step, or a server-level setting that defaults to refusing. Decide the design before writing the code.

**Related:** newly created **categories** land `public` while articles land `private`. That asymmetry is a genuine hazard — a new category is exposed the moment it is created — and is worth fixing regardless of the above.

---


---

## 5. Field length caps return raw SQL, and roll back their neighbours — *upstream: yes*

**Symptom.** An over-length value on a capped field — `currentstatus` is 255 — returns a **422 carrying `Data too long for column`**, a raw database error rather than anything a caller can act on.

**The worse half.** The update is a single statement, so **every other field in the same call is rolled back with it.** A long value in one field silently discards the correct values sent alongside it.

**Fix.** Validate lengths client-side before sending and report *which* field failed and by how much. Failing that, at minimum translate the SQL error into something readable.

---


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


---

## 7. 30-second timeout on large multi-field calls — *upstream: investigate*

**Symptom.** A call setting four or five long fields timed out at 30 seconds.

**Mitigating detail.** When it fired, the write had landed **nothing** — `updateDate` was unchanged — so a timeout is safe to retry. But that is only knowable by reading the article back, and a timeout is otherwise indistinguishable from a partial write.

**Fix.** Establish whether the timeout is client-side and configurable. Either way the error should say whether anything was committed.

---


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

## Blocked on an application key

**Status: requested, not yet issued (as of 2026-08-16).** The server currently
runs in proxy mode — `WA_AUTH_TOKEN` only, with the shared public proxy
injecting its own application key. Setting `WA_APP_KEY` switches to direct mode
against `www.worldanvil.com`. Three things are waiting on that.

**1. The `list_blocks` 403.** `/world/blocks` returns `403 access_denied` on
every call tested, while `/world/articles`, `/world/categories` and
`/world/blockfolders` all work on the same world with the same token. That
pattern fits an *application*-scoped permission rather than an account tier —
in which case the shared proxy's app key lacks a scope our own key might carry.

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


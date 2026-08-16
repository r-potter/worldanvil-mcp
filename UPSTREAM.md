# Differences from upstream

What this fork changes, and why. Keep it current — the point of this file is
that a future merge from upstream can be done without re-deriving every local
decision from the diff.

| | |
|---|---|
| **Upstream** | [wlcarden/worldanvil-claude-plugin](https://github.com/wlcarden/worldanvil-claude-plugin) (npm `worldanvil-mcp`) |
| **This fork** | `git@github.com:r-potter/worldanvil-mcp.git` |
| **Fork point** | `f8243b6` — *fix: green CI before v1.12.0 publish*, v1.12.0, 2026-06-01 |

Regenerate the authoritative list of changes, and the commit count, at any
time — do not transcribe either into this file, they go stale on every merge:

```bash
git diff --stat f8243b6 HEAD && git log --oneline f8243b6..HEAD
```

---

## 1. Compact article write responses

**Files:** `src/response.js` (new) · `src/handlers.js` · `src/tools.js` ·
`test/response.test.js` · `test/fixtures/article-write-response.json`

World Anvil echoes the whole entity back on every article write — 90 fields for
a generic article, 202 for a Person, plus the world object with every
subscriber group inlined. `compactEntity()` drops empty fields and collapses
nested entities to `{ id, title, slug, url }`. Values that were set come back
in full; `verbose: true` returns the raw entity.

Measured against payloads captured from Sandbox: generic article 3548 → 1559 B
(56% smaller); Person article 12529 → 7484 B (40%, but the overhead *around*
the content drops 68%).

**Upstream-worthy: yes.** ISSUES.md #1 marked this *upstream: probably, behind
a flag* — the flag now exists, so the condition is met. A PR should lead with
`verbose`, since the change is behaviour-altering by default.

## 2. `list_articles` lists the whole world

**Files:** `src/api-client.js` · `src/handlers.js` · `src/tools.js` ·
`test/list-articles.test.js`

`listArticles` hardcoded `category: { id: "-1" }` when no category was given,
and `-1` is the world root rather than "no filter" — so every listing was
silently restricted to uncategorised articles while looking complete. The key
is no longer sent unless a filter is asked for, and `category_id` is exposed on
the tool for deliberate filtering.

**Upstream-worthy: yes**, unreservedly — a plain defect with a one-line fix and
no local preference in it. ISSUES.md #2.

## 3. `update_block` writes the field a Block actually has

**Files:** `src/handlers.js` · `src/tools.js` · `test/blocks.test.js`

A Block has no `content` field; its payload lives in `textualdata` /
`tabulardata` / `jsondata`, selected by `dataParser`. `update_block` sent
`content`, which the API ignored while returning `success: true` — and ran
Markdown→BBCode over it first, which corrupts YAML (`---` → `[hr]`, `- item` →
`[ul][li]`). Both are fixed: the real fields are exposed and sent verbatim,
`content` now raises, and `create_block` can carry a payload so a populated
statblock takes one call.

The same defect appeared twice more nearby: `create_block` sent `folder`
where the field is `blockfolder`, so `folder_id` never worked and every block
landed unfiled — and an unfiled block cannot be enumerated, because listing
goes through `/blockfolder/blocks`. Both create and update now file correctly.

`list_blocks` calls `/world/blocks`, which is absent from the published API
surface and returns 403 on every call tested. Kept, but the 403 is translated
into an error naming the working path (folders, then blocks per folder).

**Upstream-worthy: yes**, unreservedly. ISSUES.md #3a — note that the issue's
own diagnosis and suggested fix were both wrong, corrected in place.

## 4. One answer for an article's category

**Files:** `src/response.js` · `src/handlers.js` · `test/response.test.js`

World Anvil has two article serialisations. The full one (PUT, GET
granularity=2) reports the category as a `category` object and parks `folderId`
at -1, where it reads as though the category had been dropped. The summary one
(PATCH) omits `category` and puts the containing category's id in `folderId`,
with -1 genuinely meaning the world root. Both are correct; neither is readable
without knowing which you were handed.

`normaliseArticleCategory()` makes `category` the single answer on article
writes and removes the raw `folderId`. Article-shaped responses only — a Block
carries `folderId` too and means something else by it.

**Upstream-worthy: probably**, as response shaping rather than a defect — the
API is not wrong, just inconsistent between verbs. ISSUES.md #8, whose
"folderId is not the category" framing was itself mistaken.

## 5. `create_article` requires a template

**Files:** `src/tools.js` · `src/handlers.js` · `test/response.test.js`

The schema marked only `title` and `world_id` required; the API rejects a
create without `templateType` with a 422 carrying a PHP stack trace. So the
documented minimal call could never succeed. `template` is now required in the
schema and guarded in the handler, which refuses before reaching the network.

Required rather than defaulted to `"article"` on purpose: a template cannot be
changed later without losing template-specific fields, so a silent default
would commit the caller to the wrong one. ISSUES.md #9.

**Upstream-worthy: yes**, unreservedly.

## 6. Entity references can be set

**Files:** `src/handlers.js` · `src/tools.js` · `test/references.test.js`

Reference fields are stored as scalar strings holding article UUIDs,
comma-joined for multiples. The vendor OpenAPI spec documents the write shape
as a nested `{ id }` object, which `articleParent` honours but `articleNext`
and `articlePrevious` coerce to the literal text "Array" while reporting
success. A new `references` parameter on both article write tools accepts
either shape plus arrays of either, normalises everything to the string form
that works, and skips Markdown conversion — so a caller following the official
documentation succeeds. `fields` refuses object values, which hit the coercion
unmediated.

Six fields World Anvil accepts and silently discards — `primarygeographicLocation`,
`secondarygeographicLocation`, `species`, `ethnicity`, `currentLocation`,
`geographicLocation` — are refused with an error saying so.
That also explains ISSUES.md #3b: they were never a string-vs-object problem.

**Upstream-worthy: yes.** ISSUES.md #6, whose field list was partly wrong —
`relatedPersons` and `plots` do not exist on any template.

## 7. Local documentation

**Files:** `CLAUDE.md` (`## Testing`, `## The Auth Token`) · `ISSUES.md` ·
`API-QUIRKS.md` · `scripts/fetch-spec.mjs`

The Sandbox / Fallen London testing rules, the backlog of defects found driving
the server against a live world, and a record of where the live API differs
from its own OpenAPI spec.

`API-QUIRKS.md` is the one worth reading first when something new misbehaves.
The recurring cause of everything in ISSUES.md is that the API ignores keys it
does not recognise and returns `success: true`, so a successful write is not
evidence that anything was written.

**Upstream-worthy: no.** Contains this account's world IDs and subscriber group
IDs. ISSUES.md marks per-issue which findings are worth reporting upstream
independently of this fork.

## 8. Vendor spec, for reference

The Swagger UI at `worldanvil.com/api/external/boromir/swagger-documentation`
renders client-side; the spec itself is at
`wa-cdn.nyc3.cdn.digitaloceanspaces.com/assets/prod/boromir-documentation/swagger/openapi.yml`,
with `$ref`s to sibling `parts/` files. Pull the whole tree (191 files) with
`npm run fetch-spec`.

**The spec itself is deliberately not committed.** Its licence is silent on
redistribution — it restricts commercial use of the API and says nothing
about the schema files — and this package publishes to npm, so vendoring it
is a decision to take deliberately rather than by default. A stale copy also
invites trusting it over live behaviour, which is exactly the mistake it
causes: see API-QUIRKS.md for where it is wrong.

It independently confirms three things this fork relies on: there is no
`/world/blocks` endpoint (#3); `folderId` and `timeline` are `readOnly` (#4);
`templateType` and `world` are required on create (#5). The per-template
schemas are not published — `parts/article/schemas/report.yml` and friends
return 403 — so template-specific fields still have to be established by
probing.

## 9. Recorded test fixture

**File:** `test/fixtures/article-write-response.json`

A real PUT/PATCH `/article` pair captured from Sandbox. Carries this account's
world, author and subscriber group IDs — no credentials, and no request
headers were recorded. See `CLAUDE.md#the-auth-token` before adding more.

**Upstream-worthy: only if re-captured** against a throwaway world.

---

## Deliberate non-changes

Things upstream might reasonably "fix" that this fork depends on staying as
they are. Check these after any merge.

**`state` and `subscribergroups` are not exposed** on `create_article`,
`create_category`, `update_category` or `create_secret`. This is load-bearing:
it makes *"nothing is published as a side effect"* mechanically true, which
matters for a world holding material that must never become public. Verified
2026-08-16 — mirroring a `public` Fallen London article into Sandbox produced a
`private` article, because state simply cannot be carried.

If an upstream merge adds these parameters, the guard has to be re-established
somewhere explicit before the merge lands. See ISSUES.md #4, deferred by
decision rather than oversight.

## Not diverged, though it may look it

- **Version** is still `1.12.0`, matching upstream. Not bumped; decide before
  publishing anything from this fork under the same package name.
- **`main`** tracks upstream linearly — local work is branched and
  fast-forwarded back on, so `main` stays rebasable onto a future upstream.

---

## When merging from upstream

1. `git remote add upstream https://github.com/wlcarden/worldanvil-claude-plugin.git`
2. Re-read *Deliberate non-changes* above before resolving anything.
3. Check whether upstream has independently fixed any ISSUES.md entry — several
   are marked *upstream: yes* and may arrive fixed.
4. Update the fork point in the table above.

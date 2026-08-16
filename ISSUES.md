# Issues

Defects found driving `worldanvil-mcp@1.12.0` against a live World Anvil world, ordered by what they actually cost. Each carries the symptom that exposed it, because that is the part which is hard to reconstruct later.

**Verify every fix against the Sandbox world**, never Fallen London — see [CLAUDE.md](CLAUDE.md#testing).

**Upstream?** marks whether a fix looks like a general bug worth a pull request, or a local preference better kept in a fork.

Fixes that have actually landed are catalogued in [UPSTREAM.md](UPSTREAM.md), alongside the local decisions a future merge from upstream must not undo.

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

---

## 3. Three silent write failures — *upstream: yes*

**The priority class.** Each reports `success: true` while doing nothing, or while discarding what was sent.

**3a. `update_block` discards statblock content.** Passing content to a statblock block returns success and changes nothing. Worked around by generating payloads for manual paste.

**3b. Entity-reference fields accept plain strings.** `ethnicity` and `species` on the Person template want a link to an article. Passing a string returns `success: true` and changes nothing at all. Any field of this kind likely behaves the same way; the list should be established rather than discovered one at a time.

**3c. Wrong link prefixes resolve nowhere.** `@[Display](type:ID)` requires the prefix to match the target's entity class — `person:`, `organization:`, `article:`, `location:`. A mismatched prefix produces a link that looks correct and goes nowhere, with no error. Known entity classes should be validated, and an unknown or mismatched one should raise.

**Fix.** All three should error rather than succeed quietly. A caller writing correct-looking code against a success response will not find out for a long time.

---

## 4. `state` and `subscribergroups` cannot be set — *decision, not a defect*

**Symptom.** Absent from `create_article`, `create_category`, `update_category` and `create_secret`. Every publication therefore ends in manual work in the web editor.

**Do not simply add them.** The consuming project relies on this omission as a safety property — it makes *"nothing is published as a side effect"* mechanically true, and that is load-bearing for a world containing material that must never become public.

**If exposed**, the guard needs re-establishing somewhere explicit: an opt-in flag, a confirmation step, or a server-level setting that defaults to refusing. Decide the design before writing the code.

**Related:** newly created **categories** land `public` while articles land `private`. That asymmetry is a genuine hazard — a new category is exposed the moment it is created — and is worth fixing regardless of the above.

---

## 5. Field length caps return raw SQL, and roll back their neighbours — *upstream: yes*

**Symptom.** An over-length value on a capped field — `currentstatus` is 255 — returns a **422 carrying `Data too long for column`**, a raw database error rather than anything a caller can act on.

**The worse half.** The update is a single statement, so **every other field in the same call is rolled back with it.** A long value in one field silently discards the correct values sent alongside it.

**Fix.** Validate lengths client-side before sending and report *which* field failed and by how much. Failing that, at minimum translate the SQL error into something readable.

---

## 6. Entity-reference fields are not exposed at all — *upstream: yes*

`relatedPersons`, `plots`, `primarygeographicLocation`, `relatedReports`, `articleNext` and `articlePrevious` cannot be set through the server.

**Impact.** This is the sole reason cross-linking session reports to their related articles cannot be scripted, and it is exactly the kind of bulk relational work an API is for. Currently entirely manual web-editor work.

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

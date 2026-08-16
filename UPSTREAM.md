# Differences from upstream

What this fork changes, and why. Keep it current — the point of this file is
that a future merge from upstream can be done without re-deriving every local
decision from the diff.

| | |
|---|---|
| **Upstream** | [wlcarden/worldanvil-claude-plugin](https://github.com/wlcarden/worldanvil-claude-plugin) (npm `worldanvil-mcp`) |
| **This fork** | `git@github.com:r-potter/worldanvil-mcp.git` |
| **Fork point** | `f8243b6` — *fix: green CI before v1.12.0 publish*, v1.12.0, 2026-06-01 |
| **Local commits** | 1 |

Regenerate the authoritative list at any time:

```bash
git diff --stat f8243b6 HEAD
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

## 2. Local documentation

**Files:** `CLAUDE.md` (`## Testing`, `## The Auth Token`) · `ISSUES.md`

The Sandbox / Fallen London testing rules, and the backlog of defects found
driving the server against a live world.

**Upstream-worthy: no.** Contains this account's world IDs and subscriber group
IDs. ISSUES.md marks per-issue which findings are worth reporting upstream
independently of this fork.

## 3. Recorded test fixture

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
- **`main`** sits exactly at the fork point. Local work lives on branches.

---

## When merging from upstream

1. `git remote add upstream https://github.com/wlcarden/worldanvil-claude-plugin.git`
2. Re-read *Deliberate non-changes* above before resolving anything.
3. Check whether upstream has independently fixed any ISSUES.md entry — several
   are marked *upstream: yes* and may arrive fixed.
4. Update the fork point and local commit count in the table above.

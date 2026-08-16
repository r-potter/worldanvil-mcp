#!/usr/bin/env node
/**
 * Fetch the World Anvil OpenAPI spec tree into ./spec (gitignored).
 *
 * The Swagger UI at worldanvil.com/api/external/boromir/swagger-documentation
 * renders client-side, so the page itself contains no schema. The spec lives on
 * a CDN and is split across many files by `$ref`. This walks those refs.
 *
 * The spec is NOT committed: its licence is silent on redistribution, and a
 * stale local copy invites trusting it over live behaviour — which would be a
 * mistake, since it is wrong in places. See API-QUIRKS.md.
 *
 * Usage:  npm run fetch-spec
 * Then:   git diff --no-index spec.prev spec   (to see what the vendor changed)
 */

import { mkdir, writeFile } from "fs/promises";
import { dirname, posix } from "path";

const BASE =
  "https://wa-cdn.nyc3.cdn.digitaloceanspaces.com/assets/prod/boromir-documentation/swagger";
const OUT = new URL("../spec/", import.meta.url);
const ROOT = "openapi.yml";

// Matches the quoted ref targets in the spec, e.g. 'parts/article/article.yml#/article'
const REF = /['"]([^'"#]+\.ya?ml)(?:#[^'"]*)?['"]/g;

const fetched = new Map(); // path -> "ok" | http status
const queue = [ROOT];
const seen = new Set(queue);

/**
 * Resolve a ref against the file that contains it.
 *
 * @param {string} from - Spec-relative path of the referring file
 * @param {string} ref - Ref target as written
 * @returns {string} Normalised spec-relative path
 */
function resolveRef(from, ref) {
  return posix.normalize(posix.join(posix.dirname(from), ref));
}

while (queue.length > 0) {
  const path = queue.shift();
  let response;

  try {
    response = await fetch(`${BASE}/${path}`);
  } catch (e) {
    fetched.set(path, `network: ${e.message}`);
    continue;
  }

  if (!response.ok) {
    fetched.set(path, response.status);
    continue;
  }

  const body = await response.text();
  fetched.set(path, "ok");

  const target = new URL(path, OUT);
  await mkdir(dirname(target.pathname.replace(/^\//, "")), {
    recursive: true,
  }).catch(() => {});
  await mkdir(new URL(".", target), { recursive: true });
  await writeFile(target, body);

  for (const [, ref] of body.matchAll(REF)) {
    const next = resolveRef(path, ref);
    if (next.startsWith("..") || seen.has(next)) continue;
    seen.add(next);
    queue.push(next);
  }
}

const ok = [...fetched.values()].filter((v) => v === "ok").length;
const missing = [...fetched.entries()].filter(([, v]) => v !== "ok");

console.log(`fetched ${ok} spec files into spec/`);

if (missing.length > 0) {
  console.log(`\n${missing.length} not retrievable (the vendor does not publish these):`);
  for (const [path, status] of missing) console.log(`  ${status}  ${path}`);
  console.log(
    "\nPer-template schemas are among these, which is why template-specific\n" +
      "fields have to be established by probing. See API-QUIRKS.md.",
  );
}

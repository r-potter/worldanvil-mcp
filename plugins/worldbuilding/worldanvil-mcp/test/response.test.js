/**
 * Response Compaction Tests
 *
 * Covers ISSUES.md #1 — write endpoints echoing ~130 mostly-null fields plus
 * the full inlined world object on every call.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { compactEntity } from "../src/response.js";
import { handleToolCall } from "../src/handlers.js";

// ---------------------------------------------------------------------------
// Recorded fixture: a real PUT /article response captured from the Sandbox
// world. Preferred over a hand-built shape — the hand-built one got the field
// names and the nesting wrong in ways only the live payload exposed.
// ---------------------------------------------------------------------------

const RECORDED = JSON.parse(
  readFileSync(new URL("./fixtures/article-write-response.json", import.meta.url)),
);

function makeArticleResponse(overrides = {}) {
  return structuredClone({ ...RECORDED.create, ...overrides });
}

describe("compactEntity", () => {
  it("drops the null long tail the live response carries", () => {
    const full = makeArticleResponse();
    const result = compactEntity(full);

    const nullKeys = Object.keys(full).filter((k) => full[k] === null);
    expect(nullKeys.length).toBeGreaterThan(50);
    for (const key of nullKeys) {
      expect(result).not.toHaveProperty(key);
    }
  });

  it("drops empty-collection fields", () => {
    const result = compactEntity(makeArticleResponse());

    expect(result).not.toHaveProperty("subscribergroups");
  });

  it("keeps identifiers and the fields that hold a value", () => {
    const result = compactEntity(makeArticleResponse());

    expect(result.id).toBe(RECORDED.create.id);
    expect(result.title).toBe(RECORDED.create.title);
    expect(result.slug).toBe(RECORDED.create.slug);
    expect(result.templateType).toBe("article");
    expect(result.content).toBe(RECORDED.create.content);
  });

  // `state` is the field that says whether a write landed public. It must
  // survive compaction or the response stops being a usable safety signal.
  it("preserves state", () => {
    const result = compactEntity(makeArticleResponse());

    expect(result.state).toBe("private");
  });

  it("collapses the nested world to a reference, dropping its inlined subscriber groups", () => {
    const full = makeArticleResponse();
    // Guard the premise: the live payload really does inline them.
    expect(full.world.subscribergroups.length).toBe(2);

    const result = compactEntity(full);

    expect(result.world).toEqual({
      id: "f5deaaa1-6464-44dc-821a-e12cb8563692",
      title: "Sandbox",
      slug: "sandbox-god-machine",
      url: "https://www.worldanvil.com/w/sandbox-god-machine",
    });
    expect(result.world).not.toHaveProperty("subscribergroups");
  });

  it("keeps the entity at the top level rather than collapsing it to a reference", () => {
    const result = compactEntity(makeArticleResponse());

    // The article itself carries an `id`; only *nested* entities collapse.
    expect(result.content).toBeDefined();
    expect(Object.keys(result).length).toBeGreaterThan(10);
  });

  it("preserves date objects, which are nested but not entities", () => {
    const result = compactEntity(makeArticleResponse());

    expect(result.updateDate).toEqual(RECORDED.create.updateDate);
    expect(result.updateDate.timezone_type).toBe(3);
  });

  it("roughly halves the recorded create response", () => {
    const full = makeArticleResponse();
    const compactedSize = JSON.stringify(compactEntity(full)).length;

    expect(compactedSize).toBeLessThan(JSON.stringify(full).length * 0.6);
  });

  // Values that were set come back whole: the caller reads them to confirm the
  // write landed, and an abridged value would only force a verbose re-call.
  it("returns long field values in full, never abridged", () => {
    const content = "x".repeat(20000);
    const result = compactEntity(makeArticleResponse({ content }));

    expect(result.content).toBe(content);
  });

  it("collapses arrays of nested entities to references", () => {
    const result = compactEntity({
      id: "article-abc",
      relatedPersons: [
        { id: "p-1", title: "Aldric", biography: "A long history..." },
        { id: "p-2", title: "Elara", biography: "Another history..." },
      ],
    });

    expect(result.relatedPersons).toEqual([
      { id: "p-1", title: "Aldric" },
      { id: "p-2", title: "Elara" },
    ]);
  });

  it("preserves non-entity nested objects", () => {
    const result = compactEntity({
      id: "article-abc",
      meta: { wordcount: 412, revision: 3, notes: null },
    });

    expect(result.meta).toEqual({ wordcount: 412, revision: 3 });
  });

  it("preserves booleans and zero, which are not empty", () => {
    const result = compactEntity({
      id: "article-abc",
      isWip: false,
      wordcount: 0,
      folderId: -1,
    });

    expect(result).toEqual({
      id: "article-abc",
      isWip: false,
      wordcount: 0,
      folderId: -1,
    });
  });

  it("returns primitives and null untouched", () => {
    expect(compactEntity("ok")).toBe("ok");
    expect(compactEntity(42)).toBe(42);
    expect(compactEntity(null)).toBe(null);
  });

  it("returns the original response when everything compacts away", () => {
    const empty = { a: null, b: "" };

    expect(compactEntity(empty)).toEqual(empty);
  });
});

// ---------------------------------------------------------------------------
// Handler integration — compaction on by default, raw entity behind `verbose`
// ---------------------------------------------------------------------------

describe("Article write handlers", () => {
  function makeClient() {
    return {
      createArticle: vi.fn(async () => makeArticleResponse()),
      updateArticle: vi.fn(async () => structuredClone(RECORDED.update)),
    };
  }

  function parse(response) {
    return JSON.parse(response.content[0].text);
  }

  it("compacts the create_article response by default", async () => {
    const client = makeClient();
    const result = parse(
      await handleToolCall(
        "worldanvil_create_article",
        { title: "The Iron Mountains", world_id: "world-1" },
        client,
      ),
    );

    expect(result.id).toBe(RECORDED.create.id);
    expect(result).not.toHaveProperty("authornotes");
    expect(result.world).not.toHaveProperty("subscribergroups");
  });

  it("returns the full entity from create_article when verbose is true", async () => {
    const client = makeClient();
    const result = parse(
      await handleToolCall(
        "worldanvil_create_article",
        { title: "The Iron Mountains", world_id: "world-1", verbose: true },
        client,
      ),
    );

    expect(result).toEqual(makeArticleResponse());
  });

  it("compacts the update_article response by default", async () => {
    const client = makeClient();
    const result = parse(
      await handleToolCall(
        "worldanvil_update_article",
        { article_id: RECORDED.create.id, title: "Renamed" },
        client,
      ),
    );

    expect(result.id).toBe(RECORDED.update.id);
    expect(result).not.toHaveProperty("tags");
    expect(result).not.toHaveProperty("subscribergroups");
  });

  it("returns the full entity from update_article when verbose is true", async () => {
    const client = makeClient();
    const result = parse(
      await handleToolCall(
        "worldanvil_update_article",
        { article_id: RECORDED.create.id, title: "Renamed", verbose: true },
        client,
      ),
    );

    expect(result).toEqual(RECORDED.update);
  });

  it("does not send verbose to the API as an article field", async () => {
    const client = makeClient();
    await handleToolCall(
      "worldanvil_update_article",
      { article_id: "article-abc", title: "Renamed", verbose: true },
      client,
    );

    const [, data] = client.updateArticle.mock.calls[0];
    expect(data).not.toHaveProperty("verbose");
  });
});

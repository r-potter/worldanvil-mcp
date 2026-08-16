/**
 * Response Compaction Tests
 *
 * Covers ISSUES.md #1 — write endpoints echoing ~130 mostly-null fields plus
 * the full inlined world object on every call.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { compactEntity, normaliseArticleCategory } from "../src/response.js";
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
        { title: "The Iron Mountains", world_id: "world-1", template: "article" },
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
        { title: "The Iron Mountains", world_id: "world-1", template: "article", verbose: true },
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

// ---------------------------------------------------------------------------
// ISSUES.md #8 — folderId vs category
//
// Established against Sandbox on 2026-08-16. World Anvil has two article
// serialisations and both are internally correct:
//   PUT / GET granularity=2 -> `category` object, `folderId` always -1
//   PATCH                   -> no `category`, containing category id in
//                              `folderId`, with -1 meaning the world root
// Neither is readable without knowing which one you were handed.
// ---------------------------------------------------------------------------

describe("normaliseArticleCategory", () => {
  it("drops the meaningless -1 from a create response", () => {
    const result = normaliseArticleCategory({
      id: "a1",
      folderId: -1,
      category: { id: "cat-9", title: "Geography" },
    });

    expect(result).not.toHaveProperty("folderId");
    expect(result.category).toEqual({ id: "cat-9", title: "Geography" });
  });

  it("recovers the category from folderId on a patch response", () => {
    const result = normaliseArticleCategory({
      id: "a1",
      folderId: "cat-9",
      category: null,
    });

    expect(result).not.toHaveProperty("folderId");
    expect(result.category).toEqual({ id: "cat-9" });
  });

  it("reports no category for an article in the world root", () => {
    const result = normaliseArticleCategory({
      id: "a1",
      folderId: "-1",
      category: null,
    });

    expect(result).not.toHaveProperty("folderId");
    expect(result.category).toBeFalsy();
  });

  it("does not overwrite a category that is already present", () => {
    const result = normaliseArticleCategory({
      id: "a1",
      folderId: "cat-1",
      category: { id: "cat-9", title: "Geography" },
    });

    expect(result.category).toEqual({ id: "cat-9", title: "Geography" });
  });

  it("leaves responses without folderId alone", () => {
    const entity = { id: "a1", title: "x" };

    expect(normaliseArticleCategory(entity)).toEqual(entity);
  });

  it("passes non-objects through", () => {
    expect(normaliseArticleCategory(null)).toBe(null);
    expect(normaliseArticleCategory("ok")).toBe("ok");
  });
});

describe("article write handlers reconcile the category", () => {
  function parse(response) {
    return JSON.parse(response.content[0].text);
  }

  it("never surfaces a bare folderId on create", async () => {
    const client = {
      createArticle: vi.fn(async () => makeArticleResponse()),
    };
    const result = parse(
      await handleToolCall(
        "worldanvil_create_article",
        { title: "x", world_id: "w1", template: "article" },
        client,
      ),
    );

    expect(result).not.toHaveProperty("folderId");
  });

  it("turns a patch folderId into a category", async () => {
    const client = {
      updateArticle: vi.fn(async () => ({
        success: true,
        id: "a1",
        folderId: "cat-9",
      })),
    };
    const result = parse(
      await handleToolCall(
        "worldanvil_update_article",
        { article_id: "a1", title: "x" },
        client,
      ),
    );

    expect(result).not.toHaveProperty("folderId");
    expect(result.category).toEqual({ id: "cat-9" });
  });

  it("leaves the raw entity untouched under verbose", async () => {
    const raw = { success: true, id: "a1", folderId: "cat-9" };
    const client = { updateArticle: vi.fn(async () => raw) };
    const result = parse(
      await handleToolCall(
        "worldanvil_update_article",
        { article_id: "a1", verbose: true },
        client,
      ),
    );

    expect(result).toEqual(raw);
  });
});

// ---------------------------------------------------------------------------
// create_article requires a template
//
// The API rejects a create without templateType with a 422 carrying a PHP
// stack trace, while the schema previously marked only title and world_id as
// required — so every generic article creation failed unless the caller
// happened to pass one.
// ---------------------------------------------------------------------------

describe("create_article template requirement", () => {
  it("refuses a create with no template, before calling the API", async () => {
    const client = { createArticle: vi.fn() };
    const result = await handleToolCall(
      "worldanvil_create_article",
      { title: "x", world_id: "w1" },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("template");
    expect(client.createArticle).not.toHaveBeenCalled();
  });

  it("sends templateType when a template is given", async () => {
    const client = { createArticle: vi.fn(async () => makeArticleResponse()) };
    await handleToolCall(
      "worldanvil_create_article",
      { title: "x", world_id: "w1", template: "character" },
      client,
    );

    const [data] = client.createArticle.mock.calls[0];
    expect(data.templateType).toBe("character");
  });

  it("declares template required in the tool schema", async () => {
    const { getToolDefinitions } = await import("../src/tools.js");
    const tool = getToolDefinitions().find((t) => t.name === "worldanvil_create_article");

    expect(tool.inputSchema.required).toContain("template");
  });
});

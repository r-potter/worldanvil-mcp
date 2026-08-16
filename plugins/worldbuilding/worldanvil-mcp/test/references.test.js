/**
 * Entity Reference Tests
 *
 * Covers ISSUES.md #6 — entity-reference fields could not be set.
 *
 * Established against Sandbox on 2026-08-16: these fields are scalar string
 * columns holding article UUIDs, comma-separated when a field holds several.
 * They are NOT nested `{ id }` entities like `world` or `category`. Sending an
 * object or an array makes World Anvil store the literal text "Array" and
 * report success — silent corruption, which is what this module prevents.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleToolCall } from "../src/handlers.js";
import { getToolDefinitions } from "../src/tools.js";

const A = "5e799255-321b-4738-b65b-d928b707f7ef";
const B = "395dae9c-96f9-4b50-9393-734bfc3d39a0";

describe("article references", () => {
  let client;

  beforeEach(() => {
    client = {
      createArticle: vi.fn(async () => ({ success: true, id: "new" })),
      updateArticle: vi.fn(async () => ({ success: true, id: "new" })),
    };
  });

  it("sends a single reference as a bare UUID string", async () => {
    await handleToolCall(
      "worldanvil_update_article",
      { article_id: "a1", references: { articleNext: B } },
      client,
    );

    const [, data] = client.updateArticle.mock.calls[0];
    expect(data.articleNext).toBe(B);
  });

  it("joins a list of references with commas", async () => {
    await handleToolCall(
      "worldanvil_update_article",
      { article_id: "a1", references: { relatedReports: [A, B] } },
      client,
    );

    const [, data] = client.updateArticle.mock.calls[0];
    expect(data.relatedReports).toBe(`${A},${B}`);
  });

  it("carries references on create too", async () => {
    await handleToolCall(
      "worldanvil_create_article",
      {
        title: "Session 5",
        world_id: "w1",
        template: "report",
        references: { articlePrevious: A },
      },
      client,
    );

    const [data] = client.createArticle.mock.calls[0];
    expect(data.articlePrevious).toBe(A);
  });

  // The published OpenAPI schema documents { id } for articleNext, but the
  // live API coerces that to the literal text "Array". Callers who follow the
  // documentation must still succeed, so the object is unwrapped to the string
  // form — which is correct for every writable field.
  it("unwraps the documented { id } object to a bare UUID", async () => {
    await handleToolCall(
      "worldanvil_update_article",
      { article_id: "a1", references: { articleNext: { id: B } } },
      client,
    );

    const [, data] = client.updateArticle.mock.calls[0];
    expect(data.articleNext).toBe(B);
  });

  it("unwraps an array of { id } objects", async () => {
    await handleToolCall(
      "worldanvil_update_article",
      { article_id: "a1", references: { relatedReports: [{ id: A }, { id: B }] } },
      client,
    );

    const [, data] = client.updateArticle.mock.calls[0];
    expect(data.relatedReports).toBe(`${A},${B}`);
  });

  it("accepts strings and { id } objects mixed in one array", async () => {
    await handleToolCall(
      "worldanvil_update_article",
      { article_id: "a1", references: { relatedReports: [A, { id: B }] } },
      client,
    );

    const [, data] = client.updateArticle.mock.calls[0];
    expect(data.relatedReports).toBe(`${A},${B}`);
  });

  it("still refuses a value that is neither shape", async () => {
    const result = await handleToolCall(
      "worldanvil_update_article",
      { article_id: "a1", references: { articleNext: { uuid: B } } },
      client,
    );

    expect(result.isError).toBe(true);
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("does not Markdown-convert reference values", async () => {
    // A UUID is inert, but the rule matters for any identifier-like value.
    await handleToolCall(
      "worldanvil_update_article",
      { article_id: "a1", references: { articleNext: "a_b_c" } },
      client,
    );

    const [, data] = client.updateArticle.mock.calls[0];
    expect(data.articleNext).toBe("a_b_c");
  });

  it("leaves prose fields going through `fields` untouched by all this", async () => {
    await handleToolCall(
      "worldanvil_update_article",
      {
        article_id: "a1",
        fields: { authornotes: "**bold**" },
        references: { articleNext: B },
      },
      client,
    );

    const [, data] = client.updateArticle.mock.calls[0];
    expect(data.authornotes).toBe("[b]bold[/b]");
    expect(data.articleNext).toBe(B);
  });
});

describe("fields guard", () => {
  let client;

  beforeEach(() => {
    client = { updateArticle: vi.fn(async () => ({ success: true })) };
  });

  it("refuses an object smuggled through `fields`", async () => {
    const result = await handleToolCall(
      "worldanvil_update_article",
      { article_id: "a1", fields: { species: { id: B } } },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("references");
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("still allows null, which clears a field", async () => {
    await handleToolCall(
      "worldanvil_update_article",
      { article_id: "a1", fields: { authornotes: null } },
      client,
    );

    expect(client.updateArticle).toHaveBeenCalledOnce();
  });
});

describe("references tool schema", () => {
  it("is offered on both article write tools", () => {
    for (const name of [
      "worldanvil_create_article",
      "worldanvil_update_article",
    ]) {
      const tool = getToolDefinitions().find((t) => t.name === name);
      expect(tool.inputSchema.properties.references).toBeDefined();
    }
  });

  it("documents the Array coercion the normalisation works around", () => {
    const tool = getToolDefinitions().find(
      (t) => t.name === "worldanvil_update_article",
    );
    expect(tool.inputSchema.properties.references.description).toContain(
      "Array",
    );
  });
});

// ---------------------------------------------------------------------------
// Fields World Anvil accepts and throws away.
//
// Verified against Sandbox 2026-08-16: each returns success: true and leaves
// the field null, for every entity class tried as a target and for both the
// string and object shapes. Refusing them is the whole point — a caller who
// believes the write landed will not find out for a long time.
// ---------------------------------------------------------------------------

describe("references that World Anvil discards", () => {
  let client;

  beforeEach(() => {
    client = { updateArticle: vi.fn(async () => ({ success: true })) };
  });

  for (const field of [
    "primarygeographicLocation",
    "secondarygeographicLocation",
    "species",
    "ethnicity",
    "currentLocation",
    "geographicLocation",
  ]) {
    it(`refuses ${field} rather than reporting a write that did not happen`, async () => {
      const result = await handleToolCall(
        "worldanvil_update_article",
        { article_id: "a1", references: { [field]: A } },
        client,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("discards");
      expect(client.updateArticle).not.toHaveBeenCalled();
    });
  }

  it("explains that timeline is owned by the other side", async () => {
    const result = await handleToolCall(
      "worldanvil_update_article",
      { article_id: "a1", references: { timeline: A } },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("timeline");
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("still allows the writable fields alongside", async () => {
    await handleToolCall(
      "worldanvil_update_article",
      { article_id: "a1", references: { articleParent: A, locations: B } },
      client,
    );

    const [, data] = client.updateArticle.mock.calls[0];
    expect(data.articleParent).toBe(A);
    expect(data.locations).toBe(B);
  });
});

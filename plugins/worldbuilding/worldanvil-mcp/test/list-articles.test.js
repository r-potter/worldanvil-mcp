/**
 * list_articles Tests
 *
 * Covers ISSUES.md #2 — the tool filtered every listing to the world root, so
 * it returned a handful of uncategorised articles while looking complete.
 *
 * Behaviour pinned here was established against Sandbox on 2026-08-16:
 * omitting `category` returns articles from every category; `{ id: "-1" }`
 * returns only the world root; `limit`/`offset` paginate correctly and always
 * did — the "pagination is broken" symptom was the root filter all along.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleToolCall } from "../src/handlers.js";
import { WorldAnvilClient } from "../src/api-client.js";

describe("WorldAnvilClient.listArticles", () => {
  let client;
  let sent;

  beforeEach(() => {
    client = new WorldAnvilClient({ authToken: "test-token" });
    sent = [];
    client.request = vi.fn(async (endpoint, method, body) => {
      sent.push({ endpoint, method, body });
      return { success: true, entities: [] };
    });
  });

  it("does not filter to the world root by default", async () => {
    await client.listArticles("world-1");

    expect(sent[0].body).not.toHaveProperty("category");
  });

  it("still sends limit and offset defaults as strings", async () => {
    await client.listArticles("world-1");

    expect(sent[0].body.limit).toBe("50");
    expect(sent[0].body.offset).toBe("0");
  });

  it("passes an explicit category filter through untouched", async () => {
    await client.listArticles("world-1", { category: { id: "cat-9" } });

    expect(sent[0].body.category).toEqual({ id: "cat-9" });
  });

  it("allows the world root to be requested deliberately", async () => {
    await client.listArticles("world-1", { category: { id: "-1" } });

    expect(sent[0].body.category).toEqual({ id: "-1" });
  });

  it("coerces pagination numbers to the strings the API expects", async () => {
    await client.listArticles("world-1", { limit: 25, offset: 100 });

    expect(sent[0].body.limit).toBe("25");
    expect(sent[0].body.offset).toBe("100");
  });

  it("posts to the world articles endpoint", async () => {
    await client.listArticles("world-1");

    expect(sent[0].endpoint).toBe("/world/articles?id=world-1");
    expect(sent[0].method).toBe("POST");
  });
});

describe("worldanvil_list_articles handler", () => {
  let client;

  beforeEach(() => {
    client = {
      listArticles: vi.fn(async () => ({ success: true, entities: [] })),
    };
  });

  it("sends no category filter when none is asked for", async () => {
    await handleToolCall(
      "worldanvil_list_articles",
      { world_id: "world-1" },
      client,
    );

    const [, options] = client.listArticles.mock.calls[0];
    expect(options).not.toHaveProperty("category");
  });

  it("wraps category_id into the nested object the API wants", async () => {
    await handleToolCall(
      "worldanvil_list_articles",
      { world_id: "world-1", category_id: "cat-9" },
      client,
    );

    const [, options] = client.listArticles.mock.calls[0];
    expect(options.category).toEqual({ id: "cat-9" });
  });

  it("passes pagination through", async () => {
    await handleToolCall(
      "worldanvil_list_articles",
      { world_id: "world-1", offset: 50, limit: 25 },
      client,
    );

    const [worldId, options] = client.listArticles.mock.calls[0];
    expect(worldId).toBe("world-1");
    expect(options.offset).toBe(50);
    expect(options.limit).toBe(25);
  });
});

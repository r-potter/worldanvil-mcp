/**
 * Article Subscriber Group Tests
 *
 * Covers the gating half of ISSUES.md #4 — subscriber groups could not be set
 * on an article through this server, though the API has always accepted them.
 *
 * Established against Sandbox on 2026-09-05, on both PUT and PATCH /article:
 * the writable shape is an array of `{ id }` objects, `[]` clears every group,
 * a bare string reports success and silently clears them, and an array of bare
 * strings 422s. Everything is normalised to `[{ id }]` here and anything that
 * is not a UUID is refused before the network — the silent clear is the whole
 * reason this module exists.
 *
 * Note `state` is deliberately NOT settable. Gating restricts access and can
 * never publish; publication is the reserved decision in ISSUES.md #4.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleToolCall } from "../src/handlers.js";
import { getToolDefinitions } from "../src/tools.js";

const GROUP_A = "a781174f-8c28-4fd3-bb3d-d893436598b1";
const GROUP_B = "2645a915-01fd-4229-836f-44dea5eed715";

describe("article subscriber groups", () => {
  let client;

  beforeEach(() => {
    client = {
      createArticle: vi.fn(async () => ({ success: true, id: "new" })),
      updateArticle: vi.fn(async () => ({ success: true, id: "new" })),
    };
  });

  const update = (args) =>
    handleToolCall("worldanvil_update_article", { article_id: "a1", ...args }, client);

  it("wraps a list of UUIDs into the { id } objects the API writes", async () => {
    await update({ subscribergroups: [GROUP_A, GROUP_B] });

    const [, data] = client.updateArticle.mock.calls[0];
    expect(data.subscribergroups).toEqual([{ id: GROUP_A }, { id: GROUP_B }]);
  });

  it("accepts a single UUID string without sending the shape that clears", async () => {
    await update({ subscribergroups: GROUP_A });

    const [, data] = client.updateArticle.mock.calls[0];
    expect(data.subscribergroups).toEqual([{ id: GROUP_A }]);
  });

  it("passes the documented { id } object through unchanged", async () => {
    await update({ subscribergroups: [{ id: GROUP_A }] });

    const [, data] = client.updateArticle.mock.calls[0];
    expect(data.subscribergroups).toEqual([{ id: GROUP_A }]);
  });

  it("accepts strings and { id } objects mixed in one array", async () => {
    await update({ subscribergroups: [GROUP_A, { id: GROUP_B }] });

    const [, data] = client.updateArticle.mock.calls[0];
    expect(data.subscribergroups).toEqual([{ id: GROUP_A }, { id: GROUP_B }]);
  });

  it("sends [] to remove every group, since that is how the API clears them", async () => {
    await update({ subscribergroups: [] });

    const [, data] = client.updateArticle.mock.calls[0];
    expect(data.subscribergroups).toEqual([]);
  });

  it("carries groups on create too", async () => {
    await handleToolCall(
      "worldanvil_create_article",
      {
        title: "Party Secrets",
        world_id: "w1",
        template: "article",
        subscribergroups: [GROUP_A],
      },
      client,
    );

    const [data] = client.createArticle.mock.calls[0];
    expect(data.subscribergroups).toEqual([{ id: GROUP_A }]);
  });

  it("leaves the field off entirely when not asked, so a write cannot un-gate", async () => {
    await update({ title: "Renamed" });

    const [, data] = client.updateArticle.mock.calls[0];
    expect(data).not.toHaveProperty("subscribergroups");
  });

  // The failure that matters. A non-UUID reaches the API as a shape it accepts
  // and answers `success: true` to, having removed the article's groups. It is
  // refused here instead of being sent.
  it("refuses a non-UUID before the network rather than silently clearing", async () => {
    const result = await update({ subscribergroups: "Adventurers of Sandbox Party" });

    expect(result.isError).toBe(true);
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("refuses an object that is not the { id } shape", async () => {
    const result = await update({ subscribergroups: [{ uuid: GROUP_A }] });

    expect(result.isError).toBe(true);
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("refuses one bad entry even when the rest are valid", async () => {
    const result = await update({ subscribergroups: [GROUP_A, "not-a-uuid"] });

    expect(result.isError).toBe(true);
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("says what to pass, and warns about the clear", async () => {
    const result = await update({ subscribergroups: ["nope"] });

    expect(result.content[0].text).toMatch(/worldanvil_list_subscribergroups/);
    expect(result.content[0].text).toMatch(/silently clears/);
  });

  // `state` is the half of ISSUES.md #4 that stays reserved: gating can only
  // restrict, publication cannot be undone by the person it leaked to.
  it("does not expose `state` alongside it", () => {
    for (const name of [
      "worldanvil_create_article",
      "worldanvil_update_article",
      "worldanvil_create_secret",
      "worldanvil_update_secret",
    ]) {
      const tool = getToolDefinitions().find((t) => t.name === name);
      expect(tool.inputSchema.properties.subscribergroups).toBeDefined();
      expect(tool.inputSchema.properties.state).toBeUndefined();
    }
  });
});

/**
 * Secrets take the same field, verified separately against Sandbox on
 * 2026-09-05 rather than assumed from the article behaviour — the vendor spec
 * documents plenty this API does not honour.
 *
 * Two differences from articles, neither of which changes the payload shape:
 * a bare secret create lands `state: private` where an article lands `public`,
 * so a secret's groups gate it immediately; and the array-of-bare-strings
 * shape returns a 500 HTML page here rather than the article's 422.
 */
describe("secret subscriber groups", () => {
  let client;

  beforeEach(() => {
    client = {
      createSecret: vi.fn(async () => ({ success: true, id: "new" })),
      updateSecret: vi.fn(async () => ({ success: true, id: "new" })),
    };
  });

  it("wraps UUIDs into { id } objects on create", async () => {
    await handleToolCall(
      "worldanvil_create_secret",
      {
        title: "The Merchant is a spy",
        world_id: "w1",
        content: "hidden",
        subscribergroups: [GROUP_A, GROUP_B],
      },
      client,
    );

    const [data] = client.createSecret.mock.calls[0];
    expect(data.subscribergroups).toEqual([{ id: GROUP_A }, { id: GROUP_B }]);
  });

  it("wraps UUIDs into { id } objects on update", async () => {
    await handleToolCall(
      "worldanvil_update_secret",
      { secret_id: "s1", subscribergroups: GROUP_A },
      client,
    );

    const [, data] = client.updateSecret.mock.calls[0];
    expect(data.subscribergroups).toEqual([{ id: GROUP_A }]);
  });

  it("sends [] to remove every group", async () => {
    await handleToolCall(
      "worldanvil_update_secret",
      { secret_id: "s1", subscribergroups: [] },
      client,
    );

    const [, data] = client.updateSecret.mock.calls[0];
    expect(data.subscribergroups).toEqual([]);
  });

  it("leaves the field off entirely when not asked", async () => {
    await handleToolCall(
      "worldanvil_update_secret",
      { secret_id: "s1", title: "Renamed" },
      client,
    );

    const [, data] = client.updateSecret.mock.calls[0];
    expect(data).not.toHaveProperty("subscribergroups");
  });

  it("refuses a non-UUID before the network rather than silently clearing", async () => {
    const result = await handleToolCall(
      "worldanvil_update_secret",
      { secret_id: "s1", subscribergroups: "Sandbox Campaign Players" },
      client,
    );

    expect(result.isError).toBe(true);
    expect(client.updateSecret).not.toHaveBeenCalled();
  });

  it("refuses a bad entry on create too, before anything is made", async () => {
    const result = await handleToolCall(
      "worldanvil_create_secret",
      {
        title: "Half-gated",
        world_id: "w1",
        subscribergroups: [GROUP_A, "not-a-uuid"],
      },
      client,
    );

    expect(result.isError).toBe(true);
    expect(client.createSecret).not.toHaveBeenCalled();
  });

  it("still carries the article attachment alongside the groups", async () => {
    await handleToolCall(
      "worldanvil_create_secret",
      {
        title: "Attached",
        world_id: "w1",
        article_id: "art1",
        subscribergroups: [GROUP_A],
      },
      client,
    );

    const [data] = client.createSecret.mock.calls[0];
    expect(data.article).toEqual({ id: "art1" });
    expect(data.subscribergroups).toEqual([{ id: GROUP_A }]);
  });
});

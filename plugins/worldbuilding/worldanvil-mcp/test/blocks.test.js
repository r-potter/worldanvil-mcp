/**
 * Block Handler Tests
 *
 * Covers ISSUES.md #3a — update_block reported success while writing nothing.
 *
 * Established against Sandbox on 2026-08-16: a Block has no `content` field at
 * all. Its payload lives in `textualdata` / `tabulardata` / `jsondata`, chosen
 * by the block's `dataParser`. Writing was never broken; the tool was sending
 * a key the entity does not have, and running Markdown conversion over
 * structured data on the way.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleToolCall } from "../src/handlers.js";
import { markdownToBBCode } from "../src/utils.js";
import { WorldAnvilClient } from "../src/api-client.js";

const YAML = "merit_name: Danger Sense\nmerit_dots: '2'";
const WORLD = "f5deaaa1-6464-44dc-821a-e12cb8563692"; // Sandbox

describe("worldanvil_update_block", () => {
  let client;

  beforeEach(() => {
    client = {
      updateBlock: vi.fn(async () => ({ success: true, id: 1687079 })),
      createBlock: vi.fn(async () => ({ success: true, id: 1687079 })),
    };
  });

  it("writes textualdata to the field the entity actually has", async () => {
    await handleToolCall(
      "worldanvil_update_block",
      { block_id: "1687079", textualdata: YAML },
      client,
    );

    const [blockId, data] = client.updateBlock.mock.calls[0];
    expect(blockId).toBe("1687079");
    expect(data.textualdata).toBe(YAML);
    expect(data).not.toHaveProperty("content");
  });

  it("sends the payload verbatim, without Markdown conversion", async () => {
    // A YAML sequence and a document separator are both Markdown syntax.
    const yamlList = "---\neffects:\n- Reflexive roll\n- +2 Initiative";
    expect(markdownToBBCode(yamlList)).toContain("[ul]"); // guard the premise

    await handleToolCall(
      "worldanvil_update_block",
      { block_id: "1687079", textualdata: yamlList },
      client,
    );

    const [, data] = client.updateBlock.mock.calls[0];
    expect(data.textualdata).toBe(yamlList);
    expect(data.textualdata).not.toContain("[ul]");
    expect(data.textualdata).not.toContain("[hr]");
  });

  it("carries tabulardata and jsondata through untouched", async () => {
    await handleToolCall(
      "worldanvil_update_block",
      { block_id: "1687079", tabulardata: "a,b\n1,2", jsondata: '{"x":1}' },
      client,
    );

    const [, data] = client.updateBlock.mock.calls[0];
    expect(data.tabulardata).toBe("a,b\n1,2");
    expect(data.jsondata).toBe('{"x":1}');
  });

  it("serialises a jsondata object rather than sending [object Object]", async () => {
    await handleToolCall(
      "worldanvil_update_block",
      { block_id: "1687079", jsondata: { x: 1 } },
      client,
    );

    const [, data] = client.updateBlock.mock.calls[0];
    expect(data.jsondata).toBe('{"x":1}');
  });

  it("updates the title on its own", async () => {
    await handleToolCall(
      "worldanvil_update_block",
      { block_id: "1687079", title: "Renamed" },
      client,
    );

    const [, data] = client.updateBlock.mock.calls[0];
    expect(data).toEqual({ title: "Renamed" });
  });

  // The regression this issue is about: it used to return success and write
  // nothing at all.
  it("refuses `content` instead of silently discarding it", async () => {
    const result = await handleToolCall(
      "worldanvil_update_block",
      { block_id: "1687079", content: YAML },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("textualdata");
    expect(client.updateBlock).not.toHaveBeenCalled();
  });

  it("refuses a call that would write nothing", async () => {
    const result = await handleToolCall(
      "worldanvil_update_block",
      { block_id: "1687079" },
      client,
    );

    expect(result.isError).toBe(true);
    expect(client.updateBlock).not.toHaveBeenCalled();
  });
});

describe("worldanvil_create_block", () => {
  let client;

  beforeEach(() => {
    client = { createBlock: vi.fn(async () => ({ success: true, id: 1 })) };
  });

  it("sends a payload supplied at creation time", async () => {
    await handleToolCall(
      "worldanvil_create_block",
      { title: "Danger Sense", template_id: 19552, world_id: WORLD, textualdata: YAML },
      client,
    );

    const [data] = client.createBlock.mock.calls[0];
    expect(data.title).toBe("Danger Sense");
    expect(data.template).toEqual({ id: 19552 });
    expect(data.textualdata).toBe(YAML);
  });

  it("still works with no payload", async () => {
    await handleToolCall(
      "worldanvil_create_block",
      { title: "Empty", template_id: 19552, world_id: WORLD },
      client,
    );

    const [data] = client.createBlock.mock.calls[0];
    expect(data).not.toHaveProperty("textualdata");
  });
});

// ISSUES.md #12: a block created without a world reads back perfectly and
// exists in no world. Nothing on the entity reports the association, so the
// read-back check that catches every other silent write here does not catch
// this one — hence a refusal before the network rather than a default.
describe("block world association", () => {
  let client;

  beforeEach(() => {
    client = {
      createBlock: vi.fn(async () => ({ success: true, id: 1 })),
      updateBlock: vi.fn(async () => ({ success: true, id: 1 })),
    };
  });

  it("sends the world as the { id } object the API honours", async () => {
    await handleToolCall(
      "worldanvil_create_block",
      { title: "Discern Composition", template_id: 19719, world_id: WORLD },
      client,
    );

    const [data] = client.createBlock.mock.calls[0];
    expect(data.world).toEqual({ id: WORLD });
    // `world: "uuid"`, `worldId` and `world_id` are all accepted and ignored.
    expect(data).not.toHaveProperty("worldId");
    expect(data).not.toHaveProperty("world_id");
  });

  it("refuses to create an orphan", async () => {
    const result = await handleToolCall(
      "worldanvil_create_block",
      { title: "Discern Composition", template_id: 19719 },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("world_id");
    expect(client.createBlock).not.toHaveBeenCalled();
  });

  it("adopts an existing orphan into a world", async () => {
    await handleToolCall(
      "worldanvil_update_block",
      { block_id: "1687174", world_id: WORLD },
      client,
    );

    const [, data] = client.updateBlock.mock.calls[0];
    expect(data.world).toEqual({ id: WORLD });
  });
});

// ---------------------------------------------------------------------------
// Block filing and enumeration
// ---------------------------------------------------------------------------

describe("block folder filing", () => {
  let client;

  beforeEach(() => {
    client = {
      createBlock: vi.fn(async () => ({ success: true, id: 1 })),
      updateBlock: vi.fn(async () => ({ success: true, id: 1 })),
    };
  });

  // `folder` is silently ignored by the API; the field is `blockfolder`.
  it("files a new block using the blockfolder key", async () => {
    await handleToolCall(
      "worldanvil_create_block",
      { title: "Merit", template_id: 19552, world_id: WORLD, folder_id: 42873 },
      client,
    );

    const [data] = client.createBlock.mock.calls[0];
    expect(data.blockfolder).toEqual({ id: 42873 });
    expect(data).not.toHaveProperty("folder");
  });

  // ISSUES.md #11: `folder_id` was typed `number`, and the folders a world
  // already uses are UUIDs — so the parameter could not express the value it
  // needed and blocks landed unfiled. The two ids are different systems, and
  // a UUID sent as `blockfolder.id` returns a 500.
  it("files a UUID folder under folderId, not blockfolder", async () => {
    await handleToolCall(
      "worldanvil_create_block",
      {
        title: "Discern Composition",
        template_id: 19552,
        world_id: WORLD,
        folder_id: "93837178-ac6f-4217-b826-6f66250cfc4b",
      },
      client,
    );

    const [data] = client.createBlock.mock.calls[0];
    expect(data.folderId).toBe("93837178-ac6f-4217-b826-6f66250cfc4b");
    expect(data).not.toHaveProperty("blockfolder");
  });

  it("treats a numeric string as a BlockFolder id", async () => {
    await handleToolCall(
      "worldanvil_update_block",
      { block_id: "1687079", folder_id: "42875" },
      client,
    );

    const [, data] = client.updateBlock.mock.calls[0];
    expect(data.blockfolder).toEqual({ id: "42875" });
    expect(data).not.toHaveProperty("folderId");
  });

  it("refuses a folder id that is neither", async () => {
    const result = await handleToolCall(
      "worldanvil_update_block",
      { block_id: "1687079", folder_id: "Spells" },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("folder_id");
    expect(client.updateBlock).not.toHaveBeenCalled();
  });

  it("moves an existing block into a UUID folder", async () => {
    await handleToolCall(
      "worldanvil_update_block",
      { block_id: "1687079", folder_id: "1ca15d18-73d6-4d03-a8f0-a007055597e9" },
      client,
    );

    const [, data] = client.updateBlock.mock.calls[0];
    expect(data.folderId).toBe("1ca15d18-73d6-4d03-a8f0-a007055597e9");
  });

  it("omits the folder entirely when none is given", async () => {
    await handleToolCall(
      "worldanvil_create_block",
      { title: "Merit", template_id: 19552, world_id: WORLD },
      client,
    );

    const [data] = client.createBlock.mock.calls[0];
    expect(data).not.toHaveProperty("blockfolder");
    expect(data).not.toHaveProperty("folder");
  });

  it("can refile an existing block", async () => {
    await handleToolCall(
      "worldanvil_update_block",
      { block_id: "1687079", folder_id: 42873 },
      client,
    );

    const [, data] = client.updateBlock.mock.calls[0];
    expect(data.blockfolder).toEqual({ id: 42873 });
  });
});

// ISSUES.md #11: the entity's `tags` had no parameter at all, so a block
// created here could not be made to match the ones already in a world.
describe("block tags", () => {
  let client;

  beforeEach(() => {
    client = {
      createBlock: vi.fn(async () => ({ success: true, id: 1 })),
      updateBlock: vi.fn(async () => ({ success: true, id: 1 })),
    };
  });

  it("sets tags on create", async () => {
    await handleToolCall(
      "worldanvil_create_block",
      { title: "Spell", template_id: 19552, world_id: WORLD, tags: "spell-matter-1" },
      client,
    );

    const [data] = client.createBlock.mock.calls[0];
    expect(data.tags).toBe("spell-matter-1");
  });

  // An array reaches the API as the literal text "Array" — and the write
  // response echoes the array back, so the loss is invisible until a re-read.
  it("joins an array rather than letting it become \"Array\"", async () => {
    await handleToolCall(
      "worldanvil_update_block",
      { block_id: "1687079", tags: ["spell-death-3", "rote"] },
      client,
    );

    const [, data] = client.updateBlock.mock.calls[0];
    expect(data.tags).toBe("spell-death-3,rote");
  });

  it("clears tags with an empty string", async () => {
    await handleToolCall(
      "worldanvil_update_block",
      { block_id: "1687079", tags: "" },
      client,
    );

    const [, data] = client.updateBlock.mock.calls[0];
    expect(data.tags).toBe("");
  });

  it("counts tags as something to update", async () => {
    const result = await handleToolCall(
      "worldanvil_update_block",
      { block_id: "1687079", tags: "merit" },
      client,
    );

    expect(result.isError).toBeUndefined();
    expect(client.updateBlock).toHaveBeenCalled();
  });
});

describe("WorldAnvilClient.listBlocks", () => {
  it("explains the 403 and names the working alternative", async () => {
    const client = new WorldAnvilClient({ authToken: "test-token" });
    client.request = vi.fn(async () => {
      throw new Error("API Error (403): access_denied");
    });

    await expect(client.listBlocks("world-1")).rejects.toThrow(
      /list_blocks_in_folder/,
    );
  });

  it("does not swallow unrelated errors", async () => {
    const client = new WorldAnvilClient({ authToken: "test-token" });
    client.request = vi.fn(async () => {
      throw new Error("API Error (500): boom");
    });

    await expect(client.listBlocks("world-1")).rejects.toThrow(/500/);
  });
});

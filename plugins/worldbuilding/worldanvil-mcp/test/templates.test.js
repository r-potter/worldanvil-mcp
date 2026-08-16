/**
 * Template Value Tests
 *
 * The set of valid `templateType` values, confirmed by creating one article of
 * each against a live world on 2026-08-16. The API publishes no enum, so this
 * list is the only record — and the guidance in CLAUDE.md recommended several
 * values that are rejected with a 422 until it was corrected.
 *
 * These tests guard the documentation, not the wire format: the handler passes
 * `template` through untouched, so the risk is a doc or schema drifting back to
 * naming a value that does not exist.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { getToolDefinitions } from "../src/tools.js";

const VALID = [
  "article",
  "person",
  "species",
  "ethnicity",
  "condition",
  "settlement",
  "location",
  "landmark",
  "organization",
  "formation",
  "militaryConflict",
  "item",
  "material",
  "vehicle",
  "technology",
  "language",
  "myth",
  "ritual",
  "profession",
  "rank",
  "law",
  "spell",
  "document",
  "prose",
  "plot",
  "report",
];

// Values that read like reasonable guesses and are rejected with a 422.
const REJECTED = [
  "character",
  "geography",
  "building",
  "conflict",
  "militaryformation",
  "naturallaw",
  "title",
  "tradition",
  "generic",
];

const guide = readFileSync(
  new URL("../CLAUDE.md", import.meta.url),
  "utf8",
);

describe("create_article template schema", () => {
  const tool = getToolDefinitions().find(
    (t) => t.name === "worldanvil_create_article",
  );

  it("requires template", () => {
    expect(tool.inputSchema.required).toContain("template");
  });

  it("names every valid value in its description", () => {
    for (const value of VALID) {
      expect(tool.inputSchema.properties.template.description).toContain(value);
    }
  });

  it("offers no value the API rejects", () => {
    // Only the enumerated list is checked — the prose afterwards legitimately
    // mentions rejected names to explain what they map to.
    const description = tool.inputSchema.properties.template.description;
    const listed = description
      .slice(description.indexOf("these exact values:"))
      .split(".")[0];

    for (const value of REJECTED) {
      const offered = new RegExp(`[\\s:,]${value}[,.\\s]`).test(listed);
      expect(offered, `schema offers rejected template "${value}"`).toBe(false);
    }
  });
});

describe("worldbuilding guide template list", () => {
  it("documents every valid value", () => {
    for (const value of VALID) {
      expect(guide, `guide omits template "${value}"`).toContain(`\`${value}\``);
    }
  });

  it("does not steer a caller toward a rejected value", () => {
    // Scoped to the article template decision tree. Elsewhere the guide
    // legitimately says "generic templates" about statblocks, and names
    // rejected values to explain what they map to.
    const start = guide.indexOf("ARTICLE TEMPLATE DECISION TREE");
    expect(start, "decision tree not found").toBeGreaterThan(-1);
    const tree = guide.slice(start, guide.indexOf("```", start));

    for (const value of REJECTED) {
      const recommended = new RegExp(`→\\s*${value}\\b`, "i").test(tree);
      expect(recommended, `decision tree recommends "${value}"`).toBe(false);
    }
  });
});

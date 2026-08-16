/**
 * World Anvil MCP Server - Response Compaction
 *
 * World Anvil write endpoints echo the complete entity back: ~130 fields for an
 * article, nearly all of them null, plus the entire `world` object with every
 * subscriber group inlined. For an agent-driven workflow that response costs
 * more tokens than the content being written.
 *
 * `compactEntity` removes the parts that carry no information — empty fields
 * and the inlined relations — while leaving every value that was actually set
 * intact. Field values are never abridged: a caller reads them back to confirm
 * the write landed, and a partial value would only force a second verbose call
 * that costs the full payload anyway.
 *
 * Callers that want the raw entity pass `verbose: true` on the tool call.
 */

// Fields kept when collapsing a nested entity (world, category, author, ...)
// down to a reference. Everything else on the nested object is dropped.
const REFERENCE_KEYS = ["id", "title", "slug", "url"];

/**
 * Compact a World Anvil API response for return to an MCP client.
 *
 * Drops null/empty fields and collapses nested entities to
 * `{ id, title, slug, url }` references. Values that were set are returned in
 * full.
 *
 * @param {*} entity - Parsed API response
 * @returns {*} Compacted response
 */
export function compactEntity(entity) {
  const compacted = compactValue(entity, 0);
  // A response that compacts away entirely is more useful returned as-is than
  // as `undefined` — the caller still needs to see that something came back.
  return compacted === undefined ? entity : compacted;
}

/**
 * Compact a single value by type.
 *
 * @param {*} value - Value to compact
 * @param {number} depth - Current nesting depth
 * @returns {*} Compacted value, or undefined if it holds nothing
 */
function compactValue(value, depth) {
  if (isEmpty(value)) return undefined;

  if (Array.isArray(value)) {
    const items = value
      .map((item) => compactValue(item, depth + 1))
      .filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }

  if (typeof value === "object") {
    // A nested object carrying an `id` is another entity. Collapse it to a
    // reference so the full world object does not ride along on every write.
    if (depth > 0 && value.id !== undefined) {
      return compactReference(value);
    }
    return compactObject(value, depth);
  }

  return value;
}

/**
 * Compact an object's own fields, dropping those that hold nothing.
 *
 * @param {Object} object - Object to compact
 * @param {number} depth - Current nesting depth
 * @returns {Object|undefined} Compacted object, or undefined if empty
 */
function compactObject(object, depth) {
  const result = {};

  for (const [key, value] of Object.entries(object)) {
    const compacted = compactValue(value, depth + 1);
    if (compacted !== undefined) result[key] = compacted;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Reduce a nested entity to its identifying fields.
 *
 * @param {Object} entity - Nested entity object
 * @returns {Object} Reference object
 */
function compactReference(entity) {
  const reference = {};

  for (const key of REFERENCE_KEYS) {
    if (!isEmpty(entity[key])) reference[key] = entity[key];
  }

  return reference;
}

/**
 * Whether a value carries no information worth returning.
 *
 * @param {*} value - Value to test
 * @returns {boolean} True if the value is null, empty, or blank
 */
function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

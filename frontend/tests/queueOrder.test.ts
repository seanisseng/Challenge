import assert from "node:assert/strict";
import { test } from "node:test";
import { moveQueueItem } from "../src/lib/queueOrder.ts";

test("dragging a card before or after another preserves the rest of the queue", () => {
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(moveQueueItem(ids, "d", "b", false), ["a", "d", "b", "c"]);
  assert.deepEqual(moveQueueItem(ids, "a", "c", true), ["b", "c", "a", "d"]);
  assert.deepEqual(ids, ["a", "b", "c", "d"]);
});

test("missing targets, missing cards and dropping onto yourself do not reorder", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(moveQueueItem(ids, "a", "missing", true), ids);
  assert.deepEqual(moveQueueItem(ids, "missing", "a", false), ids);
  assert.deepEqual(moveQueueItem(ids, "b", "b", true), ids);
});

test("dragging to either end and adjacent keyboard moves use the same ordering", () => {
  assert.deepEqual(moveQueueItem(["a", "b", "c"], "c", "a", false), ["c", "a", "b"]);
  assert.deepEqual(moveQueueItem(["a", "b", "c"], "a", "c", true), ["b", "c", "a"]);
  assert.deepEqual(moveQueueItem(["a", "b", "c"], "b", "a", false), ["b", "a", "c"]);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareModelsByInputPrice,
  compareModelsByName,
  lookupModelPrice,
  sortModels,
  type ModelSortMode,
} from "../src/pricing.ts";

function detail(inputPerMillion: number) {
  return {
    inputPerMillion,
    outputPerMillion: 0,
    cacheReadPerMillion: 0,
    cacheWritePerMillion: 0,
  };
}

const byName = (list: any[]) => list.map((m) => m.id);
const modes: ModelSortMode[] = ["name", "input"];

test("sortModels defaults to a case-insensitive alphabetical order", () => {
  const models = [{ id: "zeta" }, { id: "Alpha" }, { id: "beta" }];
  assert.deepEqual(byName(sortModels(models, "name")), ["Alpha", "beta", "zeta"]);
});

test("sortModels orders by ascending input price when asked", () => {
  const models = [{ id: "zeta" }, { id: "alpha" }, { id: "beta" }];
  const matrix = {
    zeta: detail(0.2),
    alpha: detail(3),
    beta: detail(1),
  };
  assert.deepEqual(byName(sortModels(models, "input", matrix)), ["zeta", "beta", "alpha"]);
});

test("sortModels breaks input-price ties alphabetically", () => {
  const models = [{ id: "beta" }, { id: "alpha" }];
  const matrix = { alpha: detail(0.5), beta: detail(0.5) };
  assert.deepEqual(byName(sortModels(models, "input", matrix)), ["alpha", "beta"]);
});

test("sortModels falls back to the native catalog cost when the matrix is empty", () => {
  const models = [
    { id: "expensive", cost: [{ input: 2 }] },
    { id: "cheap", cost: [{ input: 1 }] },
  ];
  assert.deepEqual(byName(sortModels(models, "input")), ["cheap", "expensive"]);
});

test("sortModels returns a new array and never mutates the input", () => {
  const models = [{ id: "b" }, { id: "a" }];
  const sorted = sortModels(models, "name");
  assert.deepEqual(byName(sorted), ["a", "b"]);
  assert.notEqual(sorted, models);
  assert.deepEqual(byName(models), ["b", "a"]);
});

test("comparators agree with the requested mode", () => {
  const matrix = { a: detail(1), b: detail(0.5) };
  assert.ok(compareModelsByName({ id: "a" }, { id: "b" }) < 0);
  assert.ok(compareModelsByInputPrice({ id: "a" }, { id: "b" }, matrix) > 0);
});

test("lookupModelPrice resolves full id, then short id, then raw id", () => {
  const matrix = {
    "openai/gpt-6": detail(1),
    "gpt-6": detail(2),
    "OpenAI/GPT-5": detail(3),
  };
  assert.equal(
    lookupModelPrice({ id: "openai/gpt-6", modelID: "gpt-6" }, matrix).inputPerMillion,
    1,
  );
  assert.equal(
    lookupModelPrice({ id: "other/gpt-6", modelID: "gpt-6" }, matrix).inputPerMillion,
    2,
  );
  assert.equal(
    lookupModelPrice({ id: "OpenAI/GPT-5", modelID: "gpt-5" }, matrix).inputPerMillion,
    3,
  );
});

test("lookupModelPrice uses the native cost tier when nothing matches", () => {
  const price = lookupModelPrice({
    id: "unknown/model",
    cost: [{ input: 4, output: 8, cache: { read: 0.5, write: 1 } }],
    limit: { context: 128000, output: 4096 },
  });
  assert.deepEqual(price, {
    inputPerMillion: 4,
    outputPerMillion: 8,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 1,
    contextLimit: 128000,
    outputLimit: 4096,
  });
});

test("lookupModelPrice is safe for an undefined model", () => {
  assert.equal(lookupModelPrice(undefined).inputPerMillion, 0);
});

test("sortModels handles both modes without throwing on empty input", () => {
  for (const mode of modes) {
    assert.deepEqual(sortModels([], mode), []);
  }
});

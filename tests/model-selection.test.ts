import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeModelRef,
  errorMessage,
  isSameModel,
  matchesModelRef,
  parseStoredModel,
  resolveActiveSessionID,
  shouldApplyNextModel,
  toModelTarget,
} from "../src/model-selection.ts";

test("resolveActiveSessionID returns the session displayed by the prompt", () => {
  assert.equal(resolveActiveSessionID({ type: "session", sessionID: "ses_abc" }), "ses_abc");
});

test("resolveActiveSessionID ignores the home route", () => {
  assert.equal(resolveActiveSessionID({ type: "home" }), undefined);
});

test("resolveActiveSessionID ignores a session route without an id", () => {
  assert.equal(resolveActiveSessionID({ type: "session", sessionID: "   " }), undefined);
  assert.equal(resolveActiveSessionID({ type: "session" }), undefined);
  assert.equal(resolveActiveSessionID(undefined), undefined);
});

test("resolveActiveSessionID does not depend on session list order", () => {
  // Two sessions open, prompt on the second one: the route wins.
  const route = { type: "session", sessionID: "ses_second" };
  assert.equal(resolveActiveSessionID(route), "ses_second");
});

test("toModelTarget uses the catalog id expected by session.switchModel", () => {
  // Aliased models: `id` is the catalog reference, `modelID` is provider-facing.
  assert.deepEqual(
    toModelTarget({
      providerID: "openai",
      modelID: "gpt-6.1-sol",
      id: "openai/coding-default",
    }),
    { providerID: "openai", modelID: "openai/coding-default" },
  );
});

test("toModelTarget falls back to modelID when the catalog id is missing", () => {
  assert.deepEqual(toModelTarget({ providerID: "kilo", modelID: "deepseek/deepseek-v4" }), {
    providerID: "kilo",
    modelID: "deepseek/deepseek-v4",
  });
});

test("toModelTarget falls back to the catalog id", () => {
  assert.deepEqual(toModelTarget({ providerID: "kilo", id: "deepseek/deepseek-v4" }), {
    providerID: "kilo",
    modelID: "deepseek/deepseek-v4",
  });
});

test("toModelTarget rejects incomplete identifiers", () => {
  assert.throws(() => toModelTarget({ modelID: "m" }), /provider/);
  assert.throws(() => toModelTarget({ providerID: "p" }), /model ID/);
  assert.throws(() => toModelTarget(undefined), /provider/);
});

test("isSameModel compares provider and model, ignoring the variant", () => {
  const target = { providerID: "anthropic", modelID: "claude-sonnet-4" };
  assert.equal(isSameModel({ ...target, variant: "high" } as any, target), true);
  assert.equal(isSameModel({ providerID: "anthropic", modelID: "claude-haiku" }, target), false);
  assert.equal(isSameModel({ providerID: "openai", modelID: "claude-sonnet-4" }, target), false);
  assert.equal(isSameModel(undefined, target), false);
});

test("matchesModelRef confirms the committed session model", () => {
  const target = { providerID: "anthropic", modelID: "claude-sonnet-4" };
  assert.equal(matchesModelRef({ providerID: "anthropic", id: "claude-sonnet-4" }, target), true);
  assert.equal(matchesModelRef({ providerID: "anthropic", id: "claude-haiku" }, target), false);
  assert.equal(matchesModelRef({ providerID: "openai", id: "claude-sonnet-4" }, target), false);
  assert.equal(matchesModelRef(undefined, target), false);
});

test("describeModelRef is safe for empty values", () => {
  assert.equal(describeModelRef({ providerID: "anthropic", id: "claude" }), "anthropic/claude");
  assert.equal(describeModelRef(undefined), "unknown");
  assert.equal(describeModelRef({ providerID: "anthropic" }), "unknown");
});

test("errorMessage unwraps Error and string values", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage("plain"), "plain");
  assert.equal(errorMessage({}), "Unknown error");
  assert.equal(errorMessage(undefined), "Unknown error");
});

test("parseStoredModel accepts a valid stored reference and trims it", () => {
  assert.deepEqual(parseStoredModel({ providerID: " kilo ", modelID: " openai/gpt " }), {
    providerID: "kilo",
    modelID: "openai/gpt",
  });
});

test("parseStoredModel rejects malformed stored values", () => {
  assert.equal(parseStoredModel(undefined), undefined);
  assert.equal(parseStoredModel(null), undefined);
  assert.equal(parseStoredModel("kilo/model"), undefined);
  assert.equal(parseStoredModel({ providerID: "kilo" }), undefined);
  assert.equal(parseStoredModel({ providerID: "  ", modelID: "m" }), undefined);
  assert.equal(parseStoredModel({ providerID: "kilo", modelID: 42 }), undefined);
});

test("shouldApplyNextModel only targets the first prompt of a new root session", () => {
  const pending = { providerID: "kilo", modelID: "deepseek/deepseek-v4" };

  // A TUI-created session may already hold `model-switched` control messages;
  // only real user/assistant turns count as a conversation.
  assert.equal(shouldApplyNextModel({ pending, hasConversation: false }), true);
  assert.equal(shouldApplyNextModel({ pending: undefined, hasConversation: false }), false);
  assert.equal(shouldApplyNextModel({ pending, hasConversation: true }), false);
  assert.equal(
    shouldApplyNextModel({ pending, parentID: "ses_parent", hasConversation: false }),
    false,
  );
});

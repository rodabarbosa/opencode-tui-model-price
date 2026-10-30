/**
 * Pure helpers used by the pricing dialog to resolve the session that owns the
 * prompt and to validate/model identifiers before calling OpenCode.
 *
 * No OpenTUI/Solid imports here on purpose: this module is unit-tested with
 * `node --test` and must stay independent from the TUI runtime.
 */

/** Minimal shape of `context.ui.router.current()`. */
export interface RouteLike {
  readonly type: string;
  readonly sessionID?: string;
}

/** Provider + model identifiers accepted by `session.switchModel`. */
export interface ModelTarget {
  readonly providerID: string;
  readonly modelID: string;
}

/** Shape of `context.ui.model.current()`. */
export interface ModelSelectionLike {
  readonly providerID: string;
  readonly modelID: string;
}

/** Shape of `SessionInfo.model` (`ModelRef`). */
export interface ModelRefLike {
  readonly providerID?: string;
  readonly id?: string;
}

/**
 * Returns the session displayed by the prompt, or `undefined` when the prompt
 * is not attached to a session (home route).
 */
export function resolveActiveSessionID(route: RouteLike | undefined): string | undefined {
  if (!route || route.type !== "session") return undefined;
  const sessionID = route.sessionID;
  if (typeof sessionID !== "string") return undefined;
  const trimmed = sessionID.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Normalizes a model from the catalog into the identifiers the server API
 * expects. `modelID` is authoritative; `id` is only a fallback because some
 * providers expose the same value in both fields.
 */
export function toModelTarget(model: {
  readonly providerID?: string;
  readonly modelID?: string;
  readonly id?: string;
} | undefined): ModelTarget {
  const providerID = typeof model?.providerID === "string" ? model.providerID.trim() : "";
  const preferredModelID = typeof model?.modelID === "string" ? model.modelID.trim() : "";
  const fallbackModelID = typeof model?.id === "string" ? model.id.trim() : "";
  const modelID = preferredModelID || fallbackModelID;

  if (!providerID) throw new Error("The selected model has no provider ID.");
  if (!modelID) throw new Error("The selected model has no model ID.");

  return { providerID, modelID };
}

/** Whether the prompt already uses the target model (variant is preserved). */
export function isSameModel(
  selection: ModelSelectionLike | undefined,
  target: ModelTarget,
): boolean {
  if (!selection) return false;
  return selection.providerID === target.providerID && selection.modelID === target.modelID;
}

/** Whether a committed `SessionInfo.model` matches the target model. */
export function matchesModelRef(ref: ModelRefLike | undefined, target: ModelTarget): boolean {
  if (!ref) return false;
  return ref.providerID === target.providerID && ref.id === target.modelID;
}

/** Human-readable identifier for error messages. */
export function describeModelRef(ref: ModelRefLike | undefined): string {
  if (!ref || !ref.providerID || !ref.id) return "unknown";
  return `${ref.providerID}/${ref.id}`;
}

/** Extracts a message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return "Unknown error";
}

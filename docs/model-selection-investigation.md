# Model selection investigation

Findings that back the fix in `src/tui.tsx` for applying a model chosen in the
pricing dialog to the prompt that is actually open.

Verified against:

- OpenCode `v2.2.1` (installed CLI / bundled TUI).
- `@opencode/plugin` TUI types `v2.1.2` (`dist/tui/context.d.ts`).
- `@opencode/client` generated types (`SessionSwitchModelInput`, `SessionInfo.model`).
- Official docs: <https://opencode.ai/v2/docs/build/plugins/cli>.

## 1. Public APIs involved

| Concern | API | Notes |
| ------- | --- | ----- |
| Session displayed by the prompt | `context.ui.router.current()` | Returns `Route`. A session route is `{ type: "session", sessionID }`. |
| Prompt's selected model (read-only) | `context.ui.model.current()` | `{ providerID, modelID, variant? } \| undefined`; reactive inside a Solid computation. |
| Variant change | `context.ui.model.variant.set(variant)` | Only changes the variant of the **current** model. It is not a model setter. |
| Apply a model | `context.client.session.switchModel({ sessionID, model })` | Official server operation (`POST /api/session/:sessionID/model`). `model` is `{ id, providerID, variant? }`; returns `Promise<void>` and rejects on failure. |
| Refresh the TUI session cache | `context.data.session.sync(sessionID)` | Refetches the session and writes it into the reactive `session.info` store. |
| Read the committed model from cache | `context.data.session.get(sessionID)?.model` | `ModelRef` is `{ id, providerID, variant? }`. |
| Read the committed model from the server | `context.client.session.get({ sessionID })` | Authoritative fallback used for confirmation. |

## 2. Why the previous implementation failed

```ts
const activeSessionID = context.data.session.list()?.[0]?.id;
```

`data.session.list()` returns the cached sessions, ordered by activity, not by
what the prompt is showing. With more than one session (or a subagent session),
the first item is frequently **not** the open one, so the server switched the
model of a different session while the visible prompt kept its model. The
dialog then closed and reported success because `switchModel` resolved.

Two secondary defects:

- The dialog closed before verifying that the commit was visible.
- Errors were toasted as `variant: "danger"`, which is not a valid
  `ToastVariant` (`info | success | warning | error`).

## 3. How the active session is resolved

The prompt is rendered from the current route; the router is the source of
truth for "which session is on screen". The dialog captures it **once, at open
time**:

```ts
const sessionID = resolveActiveSessionID(context.ui.router.current());
```

- Home route → `undefined`; the dialog refuses to switch and keeps open.
- Session route → the exact session whose prompt opened the dialog.
- Reading at open time means a later navigation cannot leave a stale id in the
  dialog.

The slot alternative (`session.composer.top`, `render: ({ sessionID }) => ...`)
publishes the same identity, but it is only mounted while the composer is
visible and would require keeping the last rendered id in plugin state. The
route already exposes the identity directly, so the slot is not needed.

## 4. How the model is applied and confirmed

```
dialog confirm
  └─ resolve session (route)          → undefined? show error, stay open
  └─ normalize providerID/modelID     → invalid? show error, stay open
  └─ same as context.ui.model.current()? → close, toast "already active"
  └─ session.switchModel({ sessionID, model: { providerID, id: modelID } })
        └─ rejected? show error, stay open
  └─ data.session.sync(sessionID)
  └─ session.get(sessionID).model matches target?
        ├─ yes → close, toast success
        └─ no  → client.session.get({ sessionID }).model matches target?
                   ├─ yes → close, toast success
                   └─ no  → show error "did not switch", stay open
```

Success is only reported after a committed `ModelRef` matches the selection.
`switchModel` resolving is not treated as success by itself.

`data.session.sync` updates the reactive session store, so the prompt footer
(`context.ui.model.current()` derives from `session.model` when no local draft
exists) reflects the new model even if the `session.model.selected` event
arrives late. The `model.list` command is overridden by this plugin, so the
built-in dialog's local draft is not in play for the normal flow.

## 5. Identifier shapes

| Information | Source | Example |
| ----------- | ------ | ------- |
| Display name | `model.name` | `Claude Sonnet 4` |
| Provider | `model.providerID` | `anthropic` |
| Model id sent to the server | `model.modelID` (fallback `model.id`) | `claude-sonnet-4` |

The catalog `ModelInfo` exposes both `id` and `modelID`; `id` is also the value
stored in `SessionInfo.model.id`. The dialog always sends
`{ providerID: model.providerID, id: model.modelID }`.

## 6. Behavior matrix of the dialog

| Action | Behavior |
| ------ | -------- |
| Confirm a valid model | Apply, confirm, close |
| Confirm the model already active | No server call, close with info toast |
| Confirm with no active session | Error toast + inline error, dialog stays open |
| Switch rejected / not reflected | Error toast + inline error, dialog stays open |
| Cancel / `Esc` | Close without changes (ignored while a switch is in flight) |

## 7. Known limitations

- **Home route:** the new-session prompt has a model draft, but the public TUI
  API exposes no setter for it (`ui.model.variant.set` only changes a variant).
  The dialog therefore asks the user to open a session first.
- **Local draft overrides:** if the user cycled a model/variant with
  `F2`/`Ctrl+T`/the built-in dialog before opening this one, the prompt may
  still show that draft until the next submit. The plugin's own flow does not
  create such drafts.
- **Variant on model change:** changing the model does not carry the previous
  variant; the server default applies. Selecting the already active model keeps
  the current variant.

## 8. References

- TUI plugins: <https://opencode.ai/v2/docs/build/plugins/cli>
- Server plugin API: <https://opencode.ai/v2/docs/build/plugins>
- `@opencode/plugin` TUI context types: `dist/tui/context.d.ts`
- `@opencode/client` generated types: `dist/promise/generated/types.d.ts`
  (`SessionSwitchModelInput`, `SessionInfo`, `ModelInfo`, `ModelRef`)

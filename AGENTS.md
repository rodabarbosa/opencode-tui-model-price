# AGENTS.md

OpenCode v2 plugin that shows model token prices in a split-view TUI dialog.
OpenCode loads the TypeScript sources directly — there is no build step.

## Entrypoints (`package.json` `exports`)

| Export | File | Role |
| ------ | ---- | ---- |
| `.` | `src/index.ts` | Server plugin: daily sync, `ctx.storage` cache, RPC, injects `model.cost` |
| `./tui` | `src/tui.tsx` | OpenTUI/Solid `/models-price` dialog (CLI TUI) |
| `./rpc` | `src/rpc.ts` | Shared RPC contract and `PricingMatrix` types |

Pure support modules: `src/pricing.ts` (fetch/normalize/format) and
`src/model-selection.ts` (session/model helpers). Adding an entrypoint requires
updating `package.json` `exports` — OpenCode discovers the plugin through it.

## Commands

```bash
npm test        # node --test tests/ — the only automated check
node --test --test-name-pattern="toModelTarget" tests/model-selection.test.ts
./install.sh    # opencode plugin add rodabarbosa/opencode-tui-model-price
```

- No build, lint, typecheck, formatter or CI is configured. Do not invent them.
- There is no `node_modules`: `@opencode/plugin`, `@opentui/solid` and `solid-js`
  come from the OpenCode runtime. Keep dependencies at zero unless asked.
- Manual check: edit files, then run `/reload` inside OpenCode (v2 watches plugin files).

## Conventions that are easy to get wrong

- **English only** for every user-visible string: UI labels, toasts, logs, README.
- Source-to-source imports use `.js` extensions (NodeNext) even though the files
  are `.ts`; tests import `../src/*.ts` directly because `node --test` strips types.
- `src/tui.tsx` line 1 must keep `/** @jsxImportSource @opentui/solid */`;
  `tsconfig.json` defaults to `solid-js`. Any new file rendering OpenTUI primitives
  needs the same pragma.
- Keep `src/model-selection.ts` free of OpenTUI/Solid/OpenCode imports — it is the
  only module testable outside the runtime.
- Names differ on purpose: directory/repo `opencode-tui-model-price`, package
  `opencode-model-pricing`, plugin ids `model-pricing` (server) and
  `model-pricing-tui` (TUI). Renaming one means renaming every reference
  (README, `install.sh`, config).

## Behavior invariants

- Do **not** override the built-in `/models`; `/models-price` is the only command.
- Capture the prompt's session at dialog open with
  `resolveActiveSessionID(context.ui.router.current())`. Never use
  `session.list()[0]` — that is only the most recently updated session.
- Without a session the dialog is browse-only: `Enter` / `[ Select Model ]` must be
  refused with a message and the dialog stays open.
- Switch models with the catalog `id` (`toModelTarget`), not the provider-facing
  `modelID`; confirm against the committed `session.model` before closing and keep
  the dialog open on error.
- Pricing is cached in `ctx.storage` under `pricing_matrix`, `last_sync` and
  `last_sync_timestamp`; `forceRefresh` re-fetches `https://models.dev/api.json`
  and emits `updated`. Matrix lookups go full id → short id → raw id, all lowercase
  first.
- `ctx.model.transform` only fills `model.cost` when it is empty; never overwrite
  native prices or rename models.

## CLI + Desktop compatibility

- CLI is the primary target, but keep server/RPC/pricing modules free of TUI
  imports so the package can load outside the terminal.
- Treat `context.theme`, dialog, mouse and keymap APIs as CLI surfaces: use optional
  access and try/catch around unsupported calls, as the existing code does.
- Keep the README in sync when changing commands, keybindings, storage keys or behavior.

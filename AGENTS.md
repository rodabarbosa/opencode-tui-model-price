# AGENTS.md

OpenCode v2 plugin that shows model token prices in a split-view TUI dialog.
OpenCode loads the TypeScript sources directly — there is no build step.

## Entrypoints (`package.json` `exports`)

| Export | File | Role |
| ------ | ---- | ---- |
| `.` | `src/index.ts` | Server plugin: daily sync, `ctx.storage` cache, RPC, injects `model.cost` |
| `./tui` | `src/tui.tsx` | OpenTUI/Solid `/models-price` dialog (CLI TUI) |
| `./rpc` | `src/rpc.ts` | Shared RPC contract and `PricingMatrix` types |

Pure support modules: `src/pricing.ts` (fetch/normalize/format, price lookup and
model sorting) and `src/model-selection.ts` (session/model helpers). Adding an
entrypoint requires updating `package.json` `exports` — OpenCode discovers the
plugin through it.

## Commands

```bash
npm test        # node --test tests/ — the only automated check
node --test --test-name-pattern="toModelTarget" tests/model-selection.test.ts
opencode plugin add rodabarbosa/opencode-tui-model-price   # install/update the package
./install.sh    # wrapper for the same command
```

- No build, lint, typecheck, formatter or CI is configured. Do not invent them.
- There is no `node_modules`: `@opencode/plugin`, `@opentui/solid`, `solid-js` and
  `@opentui/core` come from the OpenCode runtime and stay optional peers; do not
  turn them into installed dependencies.
- Manual check: edit files, then run `/reload` inside OpenCode (v2 watches plugin files).

## Distribution

The plugin is a publishable package and **must stay installable with
`opencode plugin add`** — from Git and from npm (`opencode-model-pricing`,
published at 1.0.0).

```bash
opencode plugin add rodabarbosa/opencode-tui-model-price   # Git (works now)
opencode plugin add opencode-model-pricing                # npm (after `npm publish`)
```

Rules:

- `package.json` keeps `name: opencode-model-pricing`, `type: module`, the
  `exports` map (`.`, `./tui`, `./rpc`) pointing at `src/*.ts(x)`, and the `files`
  allowlist (`src`, `AGENTS.md`, `install.sh`, `README.md`). Entrypoints ship as
  source; there is no build step, no `main` and no `bin`.
- Runtime libraries: `@opencode/plugin` is an **optional** peer (OpenCode provides
  it), while `@opentui/core`, `@opentui/solid` and `solid-js` are **regular
  (installed) peers**. OpenCode resolves `@opentui/solid` for local plugins but not
  for packages loaded from `~/.cache/opencode/npm`, so npm must install those three
  next to the plugin (install is ~85 MB; do not mark them optional again — issue #1).
- `npm publish` ships source only; verify with `npm pack --dry-run` (10 files:
  `package.json`, docs, `install.sh`, `src/**`, no tests).
- Verify the install in an isolated config before releasing:

  ```bash
  XDG_CONFIG_HOME=/tmp/opencode/inst/config XDG_CACHE_HOME=/tmp/opencode/inst/cache \
    opencode plugin add rodabarbosa/opencode-tui-model-price
  ```

  It must print `Plugin "..." installed and added to <config>` and leave the real
  `~/.config/opencode` untouched. The user's `~/.npmrc` sets `min-release-age=7`,
  so a version published minutes ago is refused: prefix the command with
  `npm_config_min_release_age=0` to verify a fresh release.
- Bump `version` for every published change; the Git spec always installs the
  default branch. Keep README installation steps and `install.sh` in sync with the
  package name and repository path.

## Conventions that are easy to get wrong

- **English only** for every user-visible string: UI labels, toasts, logs, README.
- Source-to-source imports use `.js` extensions (NodeNext) even though the files
  are `.ts`; tests import `../src/*.ts` directly because `node --test` strips types.
- `src/tui.tsx` line 1 must keep `/** @jsxImportSource @opentui/solid */`;
  `tsconfig.json` defaults to `solid-js`. Any new file rendering OpenTUI primitives
  needs the same pragma.
- Keep `src/model-selection.ts` and `src/pricing.ts` free of OpenTUI/Solid/OpenCode
  imports — they are the only modules testable outside the runtime.
- Names differ on purpose: directory/repo `opencode-tui-model-price`, package
  `opencode-model-pricing`, plugin ids `model-pricing` (server) and
  `model-pricing-tui` (TUI). Renaming one means renaming every reference
  (README, `install.sh`, config).

## Behavior invariants

- Do **not** override the built-in `/models`; `/models-price` is the only command.
- Capture the prompt's session at dialog open with
  `resolveActiveSessionID(context.ui.router.current())`. Never use
  `session.list()[0]` — that is only the most recently updated session.
- Without a session the dialog is browse-only: `Enter` / double-click must be
  refused with a message and the dialog stays open.
- The dialog is sized to 70% of the terminal rows (`context.renderer.height`); the
  visible model window is computed in rows (group headers cost 2) and always keeps
  the selection visible.
- Each group is sorted by name by default; `Ctrl+S` (or the footer `[Sort: ...]`
  button) toggles ascending input price with name as the tie-breaker.
- The footer stays two lines: hints plus clickable `[Refresh]` and `[Sort: ...]`,
  then the keyboard shortcuts. Keep the action group from shrinking.
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

# OpenCode Model Pricing Plugin (`opencode-model-pricing`)

A plugin for **OpenCode v2** that displays detailed token costs for **Input**, **Output**, and **Cache** (read/write) per million tokens during model selection, featuring once-a-day synchronization, favorite model pinning, and an interactive Split-View interface in the OpenCode CLI (TUI).

![Model Selection Window](src/images/model-window.png)

---

## 🎯 Objectives

1. **Cost Transparency**: View real-time token pricing (input, output, and cache) before selecting an AI model.
2. **Intuitive CLI Split-View**: Replace the default selection picker with an expanded, balanced two-column modal:
   - **Left Pane**: Categorized, navigable model list with visual group dividers and selection indicator (`▶`).
   - **Right Pane (Secondary Area)**: Dedicated card detailing USD rates per 1M tokens, maximum context window, and generation limits.
3. **Favorites Support**: Pin preferred models with `Ctrl+F` so they automatically appear at the top of the list in a dedicated `★ FAVORITES` section.
4. **Bandwidth & Latency Efficiency (Daily Cache)**: Fetch the global pricing matrix once per day on the user's first OpenCode access, storing data locally in persistent storage.
5. **On-Demand Updates**: Provide a quick slash command (`/update-model-prices`) to immediately refresh pricing whenever new models or rates are announced.

---

## 🚀 Key Features

- **Single `/models` Command**: Cleanly replaces the built-in `model.list` command without duplicate entries in the slash autocomplete menu.
- **Detailed Pricing Metrics**:
  - `Input` per 1M tokens
  - `Output` per 1M tokens
  - `Cache Read` per 1M tokens
  - `Cache Write` per 1M tokens
  - `Context Window` & `Max Output` limits
- **Alphabetical Sorting**: Models within Favorites and each provider group are automatically sorted alphabetically by name.
- **Instant Search / Filtering**: Dedicated search input bar at the top of the modal (`Type to Search`) supporting real-time filtering by model name, ID, or provider.
- **Visual Provider Grouping**: Clean provider section headers without separation lines (`GitHub Copilot`, `OpenRouter`, `OpenCode`, etc.).
- **Hybrid Synchronization**: Seamlessly combines native OpenCode cost structures with public matrices from `models.dev` (covering OpenAI, Anthropic, Google Gemini, OpenRouter, DeepSeek, Qwen, etc.).
- **Keyboard & Mouse Support in Modal**:
  - `Type`: Direct typing into the search bar to filter models.
  - `Mouse Wheel`: Scroll up/down through the model list using the mouse wheel.
  - `Mouse Click`: Click to highlight, double-click or click `[ Select Model ]` to confirm. Click `[ Favorite ]` to toggle favorite status.
  - `↑` / `↓` or `Ctrl+P` / `Ctrl+N`: Navigate through filtered models.
  - `PageUp` / `PageDown`: Jump across batches of models.
  - `Enter`: Applies the highlighted model to the session that owns the open prompt, then closes the dialog only after OpenCode confirms the switch. On the home screen (no session yet) it stores the model for the first prompt of the next new session instead of failing.
  - The model currently used by the prompt is preselected when the dialog opens (and stays highlighted until you move with the arrow keys). With no session, the stored next-session model is highlighted.
  - `Ctrl + F`: Toggle the highlighted model as **Favorite (★)** (pinned to the top group).
  - `Ctrl + R`: Force real-time price synchronization directly from within the modal.
  - `Esc`: Clear search filter, or close the dialog if the search query is empty.

---

## 📦 Installation

### 1. Place the plugin directory

Ensure the `opencode-model-pricing` folder is located in your OpenCode plugins directory (default is `~/.config/opencode/plugins/`):

```bash
# Windows (PowerShell)
cd $env:USERPROFILE\.config\opencode\plugins\
# Linux / macOS
cd ~/.config/opencode/plugins/
```

### 2. Register in configuration

Open your global `opencode.jsonc` file (`~/.config/opencode/opencode.jsonc`) and add the plugin path to the `"plugins"` array:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "./plugins/opencode-model-pricing"
  ]
}
```

> **Tip**: OpenCode v2 watches configuration and plugin files automatically. If your terminal is already running, type `/reload` to apply changes immediately.

---

## 💻 Commands

| Command | Description |
|---|---|
| `/models` | Opens the wide split-screen modal with the model list on the left and input/output/cache rates in the secondary details area on the right. |
| `/update-model-prices` | Forces an immediate online fetch and update of the pricing table, persisting values to local storage. |

---

## 🎛️ Model Switching

Selecting a model is a real switch, not just a UI highlight:

1. The dialog captures the session that owns the prompt when it opens
   (`context.ui.router.current()`), never the first entry of the session list.
2. `Enter` / `Select Model` calls `session.switchModel` with the catalog
   `providerID` and `modelID`.
3. The plugin refreshes the session cache and checks the committed
   `session.model`; it only closes and reports success after the model matches.
4. On failure the dialog stays open and shows the error, so the previous model
   remains untouched. Selecting the already active model does not round-trip.

**No session yet.** The dialog works on the home screen too: the choice is
persisted on the server (`next_model` in plugin storage) and applied to the
**first prompt of the next new session**. A server-side `session.prompt` hook
runs before admission, so the same request that opens the session already uses
the chosen model; no artificial session is created. The preference survives
restarts until it is consumed, and child (subagent) sessions and sessions that
already have a conversation are never touched. Picking the model OpenCode
already shows clears the stored preference.

Changing the model inside a session resets the variant to the model default;
selecting the current model keeps it. Aliased models are switched by their
catalog ID (`id`), not by the provider-facing `modelID`.

---

## 📁 Project Structure

```text
opencode-model-pricing/
├── package.json        # Plugin manifest (exports for server, tui, and rpc)
├── tsconfig.json       # TypeScript and JSX configuration for OpenTUI/SolidJS
├── README.md           # Documentation and usage guide
├── tests/
│   └── model-selection.test.ts            # Unit tests for session/model helpers
└── src/
    ├── images/         # UI preview screenshots and assets
    │   └── model-window.png
    ├── rpc.ts          # RPC contract with Standard Schema for inter-process communication
    ├── pricing.ts      # Data fetching, normalization, and USD formatting
    ├── model-selection.ts  # Pure helpers: session, model identifiers, next-session rules
    ├── index.ts        # OpenCode server daemon: daily sync, storage, prompt hook, RPC
    └── tui.tsx         # TUI (CLI) interface: xlarge split-view modal and keymaps
```

## 🧪 Development

```bash
npm test          # node --test tests/model-selection.test.ts
```

The helper module (`src/model-selection.ts`) is intentionally free of
OpenTUI/Solid imports so it can be tested without the TUI runtime.

---

## 📄 License

MIT License

Copyright (c) 2026 OpenCode Model Pricing Plugin Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

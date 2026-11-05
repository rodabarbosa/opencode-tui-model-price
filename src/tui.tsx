/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js";
import {
  formatUSD,
  lookupModelPrice,
  sortModels,
  type ModelSortMode,
} from "./pricing.js";
import {
  describeModelRef,
  errorMessage,
  isSameModel,
  matchesModelRef,
  resolveActiveSessionID,
  toModelTarget,
  type ModelRefLike,
  type ModelTarget,
} from "./model-selection.js";
import {
  ModelPricingRpc,
  type ModelPriceDetail,
  type PricingMatrix,
} from "./rpc.js";

type VisualItem =
  | { type: "header"; id: string; title: string; count: number; isFav: boolean }
  | {
      type: "model";
      id: string;
      model: any;
      modelIndex: number;
      isFav: boolean;
    };

function formatProviderTitle(provider: string): string {
  if (!provider) return "OTHER PROVIDERS";
  const p = provider.toLowerCase();
  if (p === "github-copilot" || p === "copilot") return "GITHUB COPILOT";
  if (p === "openrouter") return "OPENROUTER";
  if (p === "opencode") return "OPENCODE";
  if (p === "openai") return "OPENAI";
  if (p === "anthropic") return "ANTHROPIC";
  if (p === "google") return "GOOGLE GEMINI";
  return provider.toUpperCase();
}

export default Plugin.define({
  id: "model-pricing-tui",
  setup(context) {
    const pricingRpc = context.client.rpc(ModelPricingRpc);

    // Durable storage for favorite models
    const [favoritesStore, updateFavorites] = context.storage.store(
      "favorites",
      {
        initial: { ids: [] as string[] },
      },
    );

    /**
     * Applies the selected model to the given session through the official
     * server API and only reports success after the committed session model
     * matches the selection.
     *
     * Returns "unchanged" when the prompt already uses the model, so the
     * dialog can avoid a redundant round-trip.
     */
    async function applySelectedModel(
      sessionID: string,
      target: ModelTarget,
    ): Promise<"applied" | "unchanged"> {
      if (isSameModel(context.ui.model.current(), target)) return "unchanged";

      try {
        await context.client.session.switchModel({
          sessionID,
          model: { providerID: target.providerID, id: target.modelID },
        });
      } catch (error) {
        throw new Error(`OpenCode rejected the model switch: ${errorMessage(error)}`);
      }

      // Refresh the TUI session cache so the prompt footer reflects the
      // committed model even if the `session.model.selected` event is late.
      try {
        await context.data.session.sync(sessionID);
      } catch {
        // Confirmation below reads the authoritative server state instead.
      }

      const cached = context.data.session.get(sessionID)?.model;
      if (matchesModelRef(cached, target)) return "applied";

      let committed: ModelRefLike | undefined;
      try {
        committed = (await context.client.session.get({ sessionID }))?.model;
      } catch (error) {
        throw new Error(
          `Unable to confirm the model switch for session ${sessionID}: ${errorMessage(error)}`,
        );
      }

      if (matchesModelRef(committed, target)) {
        try {
          await context.data.session.sync(sessionID);
        } catch {
          // The server already confirmed the switch.
        }
        return "applied";
      }

      throw new Error(
        `OpenCode did not switch to ${target.providerID}/${target.modelID} ` +
          `(active model: ${describeModelRef(committed ?? cached)}).`,
      );
    }

    // The built-in `/models` (model.list) is deliberately NOT overridden so
    // OpenCode keeps its native behavior; this plugin exposes a dedicated
    // `/models-price` command that opens the pricing dialog.
    context.keymap.layer(() => ({
      mode: "global",
      priority: 100,
      commands: [
        {
          id: "model.pricing.dialog",
          title: "Models: Select with pricing details",
          group: "Models",
          slash: { name: "models-price" },
          palette: true,
          suggested: true,
          run: () => {
            openPricingModelDialog();
          },
        },
      ],
    }));

    async function openPricingModelDialog() {
      // Load initial local models synchronously for instant 0ms dialog display
      const localModels = context.data.location.model.list() ?? [];
      const location = context.location ?? context.data.location.default();
      // Capture the session that owns the prompt at open time. Never fall back
      // to the first item of `session.list()` (that is the most recently
      // updated session, not the one being displayed).
      const sessionID = resolveActiveSessionID(context.ui.router.current());

      // `dialog.set` only sizes the width (presets map to fixed columns) and
      // centers the dialog; a taller window has to come from the content box.
      // Target 70% of the terminal rows so the list gets the extra space.
      const terminalRows = (() => {
        try {
          const height = (context.renderer as any)?.height;
          return typeof height === "number" && height > 0 ? height : undefined;
        } catch {
          return undefined;
        }
      })();
      const dialogRows = terminalRows
        ? Math.max(20, Math.floor(terminalRows * 0.7))
        : undefined;

      context.ui.dialog.set({ size: "xlarge", centered: true });

      context.ui.dialog.show(() => {
        context.ui.dialog.set({ size: "xlarge", centered: true });

        const [modelsList, setModelsList] = createSignal<any[]>(localModels);
        const [selectedIndex, setSelectedIndex] = createSignal(0);
        const [searchQuery, setSearchQuery] = createSignal("");
        const [prices, setPrices] = createSignal<PricingMatrix>({});
        const [sortMode, setSortMode] = createSignal<ModelSortMode>("name");
        const [isRefreshing, setIsRefreshing] = createSignal(false);
        const [isApplying, setIsApplying] = createSignal(false);
        const [selectionError, setSelectionError] = createSignal<string | null>(null);

        let inputRef: any = null;
        let lastClickTime = 0;
        // Follow the active model until the user moves the selection by hand.
        let followsActiveModel = true;

        onMount(() => {
          // Focus the input immediately on render
          inputRef?.focus();

          // Fetch prices in background without delaying dialog presentation
          pricingRpc
            .getPrices()
            .then((p) => {
              if (p) setPrices(p as PricingMatrix);
            })
            .catch(() => {});

          // Always ensure the freshest model list is loaded
          context.client.model
            .list({ location })
            .then((res) => {
              if (res?.data && res.data.length > 0) {
                setModelsList(res.data);
              }
            })
            .catch(() => {});
        });

        const theme = () => {
          try {
            return (context.theme as any).surface?.("dialog") || context.theme;
          } catch {
            return context.theme;
          }
        };

        const close = () => context.ui.dialog.clear();

        const isFavorite = (id?: string) => {
          if (!id) return false;
          const list = favoritesStore.ids || [];
          return list.includes(id.toLowerCase());
        };

        // Filter models based on search query
        const filteredModelsList = createMemo(() => {
          const q = searchQuery().trim().toLowerCase();
          const list = modelsList();
          if (!q) return list;
          return list.filter((m) => {
            const name = (m.name || "").toLowerCase();
            const id = (m.id || "").toLowerCase();
            const provider = (m.providerID || "").toLowerCase();
            return name.includes(q) || id.includes(q) || provider.includes(q);
          });
        });

        // Group models: 1st Favorites (if any), 2nd by Provider, ordered by the
        // active sort mode (name by default, or ascending input price).
        const visualData = createMemo(() => {
          const list = filteredModelsList();
          const mode = sortMode();
          const matrix = prices();
          const favs: any[] = [];
          const byProvider: Record<string, any[]> = {};

          for (const m of list) {
            if (isFavorite(m.id)) {
              favs.push(m);
            } else {
              const p = (m.providerID || "other").toLowerCase();
              if (!byProvider[p]) byProvider[p] = [];
              byProvider[p].push(m);
            }
          }

          const sortedFavs = sortModels(favs, mode, matrix);

          const entries: VisualItem[] = [];
          const selectable: any[] = [];
          let globalIdx = 0;

          // 1. Favorites group (only if there are favorited models)
          if (sortedFavs.length > 0) {
            entries.push({
              type: "header",
              id: "hdr_favorites",
              title: "★ FAVORITES",
              count: sortedFavs.length,
              isFav: true,
            });
            for (const m of sortedFavs) {
              entries.push({
                type: "model",
                id: `fav_${m.id}`,
                model: m,
                modelIndex: globalIdx++,
                isFav: true,
              });
              selectable.push(m);
            }
          }

          // 2. Provider groups sorted by priority and alphabetically
          const priority = [
            "copilot",
            "github-copilot",
            "opencode",
            "openrouter",
            "openai",
            "anthropic",
            "google",
          ];

          const sortedProviders = Object.keys(byProvider).sort((a, b) => {
            const idxA = priority.indexOf(a);
            const idxB = priority.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
          });

          for (const provider of sortedProviders) {
            const group = byProvider[provider];
            if (!group || group.length === 0) continue;

            const pModels = sortModels(group, mode, matrix);

            entries.push({
              type: "header",
              id: `hdr_${provider}`,
              title: formatProviderTitle(provider),
              count: pModels.length,
              isFav: false,
            });

            for (const m of pModels) {
              entries.push({
                type: "model",
                id: m.id,
                model: m,
                modelIndex: globalIdx++,
                isFav: false,
              });
              selectable.push(m);
            }
          }

          return { entries, selectable };
        });

        const totalSelectable = () => visualData().selectable.length;

        /** User-driven selection: stops following the active model. */
        const setSelection = (index: number) => {
          followsActiveModel = false;
          setSelectedIndex(index);
        };

        const activeModelIndex = () => {
          const current = context.ui.model.current();
          if (!current) return -1;
          return visualData().selectable.findIndex(
            (m: any) =>
              m.providerID === current.providerID &&
              (m.modelID === current.modelID || m.id === current.modelID),
          );
        };

        // Keep the prompt's active model highlighted while the catalog and the
        // favorites store finish hydrating. Stops as soon as the user moves.
        createEffect(() => {
          if (!followsActiveModel) return;
          const index = activeModelIndex();
          if (index >= 0 && index !== selectedIndex()) setSelectedIndex(index);
        });

        const currentModel = createMemo(() => {
          const list = visualData().selectable;
          if (list.length === 0) return undefined;
          const idx = selectedIndex();
          return list[idx] || list[0];
        });

        const currentPrice = createMemo((): ModelPriceDetail => {
          const m = currentModel();
          if (!m) {
            return {
              inputPerMillion: 0,
              outputPerMillion: 0,
              cacheReadPerMillion: 0,
              cacheWritePerMillion: 0,
            };
          }
          return lookupModelPrice(m, prices());
        });

        const selectedVisualIdx = createMemo(() => {
          const list = visualData().entries;
          const sIdx = selectedIndex();
          const found = list.findIndex(
            (e) => e.type === "model" && e.modelIndex === sIdx,
          );
          return found >= 0 ? found : 0;
        });

        /**
         * Rows used by the header, search bar, inter-block gaps and the two-line
         * footer. Optional blocks (no-session banner, error box) shrink the list
         * so a 70%-height dialog keeps every row inside the window.
         */
        const CHROME_ROWS = 13;
        const listRows = createMemo(() => {
          if (!dialogRows) return 16;
          const extra = (sessionID ? 0 : 2) + (selectionError() ? 3 : 0);
          return Math.max(3, dialogRows - CHROME_ROWS - extra);
        });

        const entryRows = (entry: VisualItem) => (entry.type === "header" ? 2 : 1);

        const visibleRange = createMemo(() => {
          const list = visualData().entries;
          if (list.length === 0) return { start: 0, end: 0 };

          const target = Math.min(selectedVisualIdx(), list.length - 1);
          const budget = listRows();

          let start = Math.max(0, target - Math.floor(budget / 2));
          let used = 0;
          let end = start;
          while (end < list.length && used + entryRows(list[end]) <= budget) {
            used += entryRows(list[end]);
            end++;
          }

          // The first window can end before the selected row (small budgets):
          // rebuild it anchored on the selection so the cursor stays visible.
          if (target >= end) {
            start = target;
            end = target + 1;
            used = entryRows(list[target]);
            while (start > 0 && used + entryRows(list[start - 1]) <= budget) {
              start--;
              used += entryRows(list[start]);
            }
          }

          return { start, end };
        });

        const visibleEntries = createMemo(() => {
          const { start, end } = visibleRange();
          return visualData().entries.slice(start, end);
        });

        const handleSelectionError = (
          message: string,
          title = "Error switching model",
        ) => {
          setSelectionError(message);
          context.ui.toast.show({
            title,
            message,
            variant: "error",
          });
        };

        /** Closes the dialog only when no switch is in flight. */
        const requestClose = () => {
          if (isApplying()) return;
          close();
        };

        const selectCurrentModel = async () => {
          if (isApplying()) return;

          // Selection is refused without an active session: the dialog is
          // browse-only there because there is nothing to apply the choice to.
          if (!sessionID) {
            handleSelectionError(
              "No active session: start a session before selecting a model.",
              "Selection unavailable",
            );
            return;
          }

          const m = currentModel();
          if (!m) return;

          setSelectionError(null);

          let target: ModelTarget;
          try {
            target = toModelTarget(m);
          } catch (error) {
            handleSelectionError(errorMessage(error));
            return;
          }

          setIsApplying(true);
          try {
            const result = await applySelectedModel(sessionID, target);
            context.ui.toast.show({
              title:
                result === "applied"
                  ? "Active Model Switched"
                  : "Model already active",
              message: `${m.name || target.modelID} (${target.providerID})`,
              variant: result === "applied" ? "success" : "info",
            });
            setIsApplying(false);
            close();
          } catch (error) {
            setIsApplying(false);
            handleSelectionError(errorMessage(error), "Error switching model");
          }
        };

        const toggleFavorite = async () => {
          const m = currentModel();
          if (!m) return;
          const id = (m.id || "").toLowerCase();

          await updateFavorites((draft) => {
            if (!draft.ids) draft.ids = [];
            const idx = draft.ids.indexOf(id);
            if (idx >= 0) {
              draft.ids.splice(idx, 1);
              context.ui.toast.show({
                title: "Favorites",
                message: `Removed from favorites: ${m.name || m.id}`,
                variant: "info",
              });
            } else {
              draft.ids.push(id);
              context.ui.toast.show({
                title: "Favorites",
                message: `★ Added to favorites: ${m.name || m.id}`,
                variant: "success",
              });
            }
          });
        };

        const toggleSortMode = () => {
          const model = currentModel();
          const next: ModelSortMode = sortMode() === "name" ? "input" : "name";

          followsActiveModel = false;
          setSortMode(next);

          // Reordering moves the highlighted model: follow it to its new
          // position instead of leaving the cursor on a different row.
          const nextIndex = model ? visualData().selectable.indexOf(model) : -1;
          setSelection(nextIndex >= 0 ? nextIndex : 0);
        };

        const handleForceRefresh = async () => {
          if (isRefreshing()) return;
          setIsRefreshing(true);
          try {
            const res = await pricingRpc.forceRefresh();
            const fresh = (await pricingRpc.getPrices()) as PricingMatrix;
            setPrices(fresh);
            context.ui.toast.show({
              title: "Prices Synchronized",
              message: `${res.count} models updated.`,
              variant: "success",
            });
          } catch (e: any) {
            context.ui.toast.show({
              title: "Sync Error",
              message: e?.message || "Network error.",
              variant: "error",
            });
          } finally {
            setIsRefreshing(false);
          }
        };

        const clearSearch = () => {
          if (inputRef) {
            inputRef.value = "";
            inputRef.focus();
          }
          setSearchQuery("");
          setSelection(0);
        };

        const handleItemClick = (idx: number) => {
          const now = Date.now();
          if (idx === selectedIndex() && now - lastClickTime < 400) {
            selectCurrentModel();
          } else {
            setSelection(idx);
          }
          lastClickTime = now;
        };

        context.keymap.layer(() => ({
          mode: "modal",
          commands: [
            {
              bind: "down,ctrl+n",
              title: "Next",
              group: "Navigation",
              run: () => {
                const max = totalSelectable() - 1;
                if (max > 0) setSelection(Math.min(selectedIndex() + 1, max));
              },
            },
            {
              bind: "up,ctrl+p",
              title: "Previous",
              group: "Navigation",
              run: () => setSelection(Math.max(selectedIndex() - 1, 0)),
            },
            {
              bind: "pagedown",
              title: "Page Down",
              group: "Navigation",
              run: () => {
                const max = totalSelectable() - 1;
                if (max > 0) setSelection(Math.min(selectedIndex() + 6, max));
              },
            },
            {
              bind: "pageup",
              title: "Page Up",
              group: "Navigation",
              run: () => setSelection(Math.max(selectedIndex() - 6, 0)),
            },
            {
              bind: "return",
              title: "Confirm Selection",
              group: "Action",
              run: selectCurrentModel,
            },
            {
              bind: "ctrl+f",
              title: "Toggle Favorite",
              group: "Action",
              run: toggleFavorite,
            },
            {
              bind: "ctrl+s",
              title: "Toggle Sort (Name / Input Price)",
              group: "Action",
              run: toggleSortMode,
            },
            {
              bind: "ctrl+r",
              title: "Force Refresh",
              group: "Action",
              run: handleForceRefresh,
            },
            {
              bind: "escape",
              title: "Close",
              group: "Action",
              run: () => {
                if (searchQuery().length > 0) {
                  clearSearch();
                } else {
                  requestClose();
                }
              },
            },
          ],
        }));

        return (
          <box
            flexDirection="column"
            height={dialogRows}
            paddingLeft={1}
            paddingRight={1}
            gap={1}
            onKeyDown={(key: any) => {
              // Fallback: If printable key is pressed before input gets focus, insert it directly
              if (
                !key.ctrl &&
                !key.alt &&
                !key.meta &&
                key.sequence &&
                key.sequence.length === 1 &&
                key.sequence >= " "
              ) {
                if (inputRef && inputRef.value === "") {
                  inputRef.focus();
                  inputRef.insertText(key.sequence);
                }
              }
            }}
          >
            {/* Header */}
            <box
              flexDirection="row"
              justifyContent="space-between"
              borderBottom={true}
              paddingBottom={1}
            >
              <text bold fg={theme().text?.base || "white"}>
                ⚡ Model Selection & Token Pricing
              </text>
              <box flexDirection="row" gap={1}>
                <text fg={theme().text?.muted || "gray"}>
                  [{totalSelectable() > 0 ? selectedIndex() + 1 : 0}/
                  {totalSelectable()}]
                </text>
                <box onMouseDown={requestClose} onMouseUp={requestClose} paddingLeft={1}>
                  <text fg={theme().text?.muted || "gray"}>[Esc]</text>
                </box>
              </box>
            </box>

            {/* Search Input Bar */}
            <box
              flexDirection="row"
              alignItems="center"
              borderBottom={true}
              paddingBottom={1}
              gap={1}
              onMouseDown={() => inputRef?.focus()}
              onMouseUp={() => inputRef?.focus()}
            >
              <text bold fg={theme().text?.selected || "cyan"}>
                Search:
              </text>
              <box flexGrow={1} flexDirection="row" alignItems="center">
                <input
                  ref={(el: any) => {
                    inputRef = el;
                    if (el) el.focus();
                  }}
                  placeholder="Type to filter models (name, id, provider)..."
                  onInput={(val: string) => {
                    setSearchQuery(val || "");
                    setSelection(0);
                  }}
                  focused={true}
                  paddingLeft={3}
                />
              </box>
              <Show when={searchQuery().length > 0}>
                <box
                  onMouseDown={clearSearch}
                  onMouseUp={clearSearch}
                  paddingLeft={1}
                >
                  <text fg={theme().text?.muted || "gray"}>[Clear]</text>
                </box>
              </Show>
            </box>

            {/* No-session banner: pricing is browse-only without a session */}
            <Show when={!sessionID}>
              <box paddingLeft={1}>
                <text fg={theme().text?.muted || "gray"} wrap="word">
                  No session active: pricing is browse-only — start a session
                  to select a model.
                </text>
              </box>
            </Show>

            {/* Split Screen Body: Left (Grouped List) | Right (Details Card) */}
            <box flexDirection="row" flexGrow={1} minHeight={0} gap={2}>
              {/* Column 1: Model List with Mouse Scroll & Click Selection */}
              <box
                width="58%"
                flexDirection="column"
                borderRight={true}
                paddingRight={2}
                onMouse={(e: any) => {
                  if (e.type === "scroll") {
                    const dir =
                      e.scroll?.direction || (e.deltaY > 0 ? "down" : "up");
                    if (dir === "up" || e.deltaY < 0) {
                      setSelection(Math.max(selectedIndex() - 1, 0));
                    } else {
                      const max = totalSelectable() - 1;
                      if (max > 0)
                        setSelection(Math.min(selectedIndex() + 1, max));
                    }
                  }
                }}
              >
                <Show
                  when={visibleEntries().length > 0}
                  fallback={
                    <box paddingY={2} paddingLeft={1}>
                      <text fg={theme().text?.muted || "gray"}>
                        No models matching "{searchQuery()}"
                      </text>
                    </box>
                  }
                >
                  <For each={visibleEntries()}>
                    {(entry) => {
                      if (entry.type === "header") {
                        return (
                          <box
                            paddingTop={1}
                            paddingBottom={0}
                            paddingLeft={1}
                            flexDirection="row"
                          >
                            <text
                              bold
                              fg={
                                entry.isFav
                                  ? "yellow"
                                  : theme().text?.selected || "cyan"
                              }
                              wrap="never"
                            >
                              {entry.isFav ? "★ " : ""}
                              {entry.title}
                            </text>
                          </box>
                        );
                      }

                      const isSelected = () =>
                        entry.modelIndex === selectedIndex();

                      return (
                        <box
                          paddingLeft={1}
                          paddingRight={1}
                          flexDirection="row"
                          justifyContent="space-between"
                          gap={2}
                          onMouseDown={() => handleItemClick(entry.modelIndex)}
                          onMouseUp={() => handleItemClick(entry.modelIndex)}
                        >
                          <box flexDirection="row">
                            <text
                              bold={isSelected()}
                              fg={
                                isSelected()
                                  ? theme().text?.selected || "cyan"
                                  : theme().text?.base || "white"
                              }
                              wrap="never"
                            >
                              {isSelected() ? "▶ " : "  "}
                            </text>
                            <Show when={entry.isFav}>
                              <text fg="yellow" bold wrap="never">
                                ★{" "}
                              </text>
                            </Show>
                            <text
                              bold={isSelected()}
                              fg={
                                isSelected()
                                  ? theme().text?.selected || "cyan"
                                  : theme().text?.base || "white"
                              }
                              wrap="never"
                            >
                              {entry.model.name || entry.model.id}
                            </text>
                          </box>
                          <text fg={theme().text?.muted || "gray"} wrap="never">
                            {entry.model.providerID || ""}
                          </text>
                        </box>
                      );
                    }}
                  </For>
                </Show>
              </box>

              {/* Column 2: Secondary Details Card */}
              <box width="42%" flexDirection="column" paddingLeft={1}>
                <Show
                  when={currentModel()}
                  fallback={
                    <box paddingY={2}>
                      <text fg={theme().text?.muted || "gray"}>
                        No model selected
                      </text>
                    </box>
                  }
                >
                  {(m) => {
                    const p = currentPrice;
                    const fav = () => isFavorite(m().id);
                    return (
                      <box flexDirection="column" gap={1}>
                        {/* Title, Provider and Clickable Favorite Toggle */}
                        <box flexDirection="column">
                          <box
                            flexDirection="row"
                            justifyContent="space-between"
                          >
                            <text
                              bold
                              fg={theme().text?.selected || "cyan"}
                              wrap="never"
                            >
                              {fav() ? "★ " : ""}
                              {m().name || m().id}
                            </text>
                            <box
                              onMouseDown={toggleFavorite}
                              onMouseUp={toggleFavorite}
                              paddingLeft={1}
                            >
                              <text
                                bold
                                fg={fav() ? "yellow" : "gray"}
                                wrap="never"
                              >
                                {fav() ? "★ [Favorited]" : "☆ [Favorite]"}
                              </text>
                            </box>
                          </box>
                          <text fg={theme().text?.muted || "gray"} wrap="never">
                            {m().providerID} • {m().id}
                          </text>
                        </box>

                        {/* Formatted Pricing Table */}
                        <box
                          paddingX={1}
                          paddingY={1}
                          border={true}
                          flexDirection="column"
                        >
                          <box
                            flexDirection="row"
                            justifyContent="space-between"
                          >
                            <text
                              fg={theme().text?.muted || "gray"}
                              wrap="never"
                            >
                              Input:
                            </text>
                            <text
                              bold
                              fg={theme().text?.base || "white"}
                              wrap="never"
                            >
                              {formatUSD(p().inputPerMillion)} / 1M
                            </text>
                          </box>

                          <box
                            flexDirection="row"
                            justifyContent="space-between"
                          >
                            <text
                              fg={theme().text?.muted || "gray"}
                              wrap="never"
                            >
                              Output:
                            </text>
                            <text
                              bold
                              fg={theme().text?.base || "white"}
                              wrap="never"
                            >
                              {formatUSD(p().outputPerMillion)} / 1M
                            </text>
                          </box>

                          <box
                            flexDirection="row"
                            justifyContent="space-between"
                          >
                            <text
                              fg={theme().text?.muted || "gray"}
                              wrap="never"
                            >
                              Cache Read:
                            </text>
                            <text
                              bold
                              fg={theme().text?.base || "white"}
                              wrap="never"
                            >
                              {formatUSD(p().cacheReadPerMillion)} / 1M
                            </text>
                          </box>

                          <box
                            flexDirection="row"
                            justifyContent="space-between"
                          >
                            <text
                              fg={theme().text?.muted || "gray"}
                              wrap="never"
                            >
                              Cache Write:
                            </text>
                            <text
                              bold
                              fg={theme().text?.base || "white"}
                              wrap="never"
                            >
                              {formatUSD(p().cacheWritePerMillion)} / 1M
                            </text>
                          </box>
                        </box>

                        {/* Technical Metadata */}
                        <box flexDirection="column">
                          <text fg={theme().text?.muted || "gray"} wrap="never">
                            Context:{" "}
                            {p().contextLimit?.toLocaleString() ?? "N/A"} tokens
                          </text>
                          <text fg={theme().text?.muted || "gray"} wrap="never">
                            Max Output:{" "}
                            {p().outputLimit?.toLocaleString() ?? "N/A"} tokens
                          </text>
                          <text fg={theme().text?.muted || "gray"} wrap="never">
                            Source: {p().source || "models.dev"}
                          </text>
                        </box>
                      </box>
                    );
                  }}
                </Show>
              </box>
            </box>

            {/* Inline error: the dialog stays open so the user can retry */}
            <Show when={selectionError()}>
              <box border={true} paddingLeft={1} paddingRight={1}>
                <text fg="red" wrap="word">
                  ✖ {selectionError()}
                </text>
              </box>
            </Show>

            {/* Footer with keymap shortcuts & clickable actions (two lines) */}
            <box
              borderTop={true}
              paddingTop={1}
              flexDirection="column"
            >
              {/* Line 1: interaction hints and clickable actions */}
              <box flexDirection="row" alignItems="center" gap={1}>
                <text
                  flexGrow={1}
                  flexShrink={1}
                  minWidth={0}
                  truncate={true}
                  fg={theme().text?.muted || "gray"}
                  wrap="never"
                >
                  Type to Search | Scroll | Click/Enter Select
                </text>
                <box flexDirection="row" flexShrink={0} gap={1}>
                  <Show when={isApplying()}>
                    <text bold flexShrink={0} fg="yellow" wrap="never">
                      Switching model...
                    </text>
                  </Show>
                  <Show when={isRefreshing()}>
                    <text bold flexShrink={0} fg="yellow" wrap="never">
                      Refreshing...
                    </text>
                  </Show>
                  <box
                    flexShrink={0}
                    onMouseDown={handleForceRefresh}
                    onMouseUp={handleForceRefresh}
                  >
                    <text fg={theme().text?.muted || "gray"} wrap="never">
                      [Refresh]
                    </text>
                  </box>
                  <box
                    flexShrink={0}
                    onMouseDown={toggleSortMode}
                    onMouseUp={toggleSortMode}
                  >
                    <text
                      bold
                      fg={theme().text?.selected || "cyan"}
                      wrap="never"
                    >
                      {sortMode() === "name"
                        ? "[Sort: Name]"
                        : "[Sort: Price ↑]"}
                    </text>
                  </box>
                </box>
              </box>

              {/* Line 2: keyboard shortcuts */}
              <text fg={theme().text?.muted || "gray"} wrap="never">
                Ctrl+F Favorite | Ctrl+R Refresh | Ctrl+S Sort
              </text>
            </box>
          </box>
        );
      });
    }
  },
});

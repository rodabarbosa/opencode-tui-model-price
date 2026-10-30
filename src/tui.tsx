/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js";
import { formatUSD } from "./pricing.js";
import {
  describeModelRef,
  errorMessage,
  isSameModel,
  matchesModelRef,
  parseStoredModel,
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

const sortByName = (a: any, b: any) => {
  const nameA = (a.name || a.id).toLowerCase();
  const nameB = (b.name || b.id).toLowerCase();
  return nameA.localeCompare(nameB);
};

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

    // Override built-in model.list command with pricing & favorites support
    context.keymap.layer(() => ({
      mode: "global",
      priority: 100,
      commands: [
        {
          id: "model.list",
          title: "Models: Select with pricing details",
          group: "Models",
          slash: { name: "models" },
          palette: true,
          suggested: true,
          run: () => {
            openPricingModelDialog();
          },
        },
        {
          id: "model.pricing.refresh",
          title: "Models: Force refresh token prices",
          group: "Models",
          slash: { name: "update-model-prices" },
          palette: true,
          run: async () => {
            try {
              context.ui.toast.show({
                title: "Pricing",
                message: "Updating pricing table...",
                variant: "info",
              });
              const res = await pricingRpc.forceRefresh();
              context.ui.toast.show({
                title: "Prices Updated",
                message: `${res.count} models successfully synchronized.`,
                variant: "success",
              });
            } catch (err: any) {
              context.ui.toast.show({
                title: "Update Error",
                message: err?.message || "Failed to synchronize prices.",
                variant: "error",
              });
            }
          },
        },
      ],
    }));

    async function openPricingModelDialog() {
      // Model chosen while no session exists. The server plugin applies it to the
      // first prompt of the next new session (prompt hook + `session.switchModel`),
      // because OpenCode's composer only accepts a model change for a session.
      //
      // Resolve the stored preference before opening so the banner and the
      // highlighted row are consistent on first paint.
      let pendingModel: ModelTarget | null = null;
      try {
        const res: any = await pricingRpc.getNextModel();
        pendingModel = parseStoredModel(res?.model) ?? null;
      } catch {
        // No server-side preference (or RPC unavailable): nothing to preload.
      }

      // Load initial local models synchronously for instant 0ms dialog display
      const localModels = context.data.location.model.list() ?? [];
      const location = context.location ?? context.data.location.default();
      // Capture the session that owns the prompt at open time. Never fall back
      // to the first item of `session.list()` (that is the most recently
      // updated session, not the one being displayed).
      const sessionID = resolveActiveSessionID(context.ui.router.current());

      context.ui.dialog.set({ size: "xlarge", centered: true });

      context.ui.dialog.show(() => {
        context.ui.dialog.set({ size: "xlarge", centered: true });

        const [modelsList, setModelsList] = createSignal<any[]>(localModels);
        const [selectedIndex, setSelectedIndex] = createSignal(0);
        const [searchQuery, setSearchQuery] = createSignal("");
        const [prices, setPrices] = createSignal<PricingMatrix>({});
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

        // Group models: 1st Favorites (if any), 2nd by Provider, sorted alphabetically by name
        const visualData = createMemo(() => {
          const list = filteredModelsList();
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

          favs.sort(sortByName);

          const entries: VisualItem[] = [];
          const selectable: any[] = [];
          let globalIdx = 0;

          // 1. Favorites group (only if there are favorited models)
          if (favs.length > 0) {
            entries.push({
              type: "header",
              id: "hdr_favorites",
              title: "★ FAVORITES",
              count: favs.length,
              isFav: true,
            });
            for (const m of favs) {
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
            const pModels = byProvider[provider];
            if (!pModels || pModels.length === 0) continue;

            pModels.sort(sortByName);

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
          // With no session, highlight the model that the next new session will
          // actually use: the stored preference wins over the composer model.
          const current = sessionID
            ? context.ui.model.current()
            : pendingModel ?? context.ui.model.current();
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
          const dict = prices();
          const fullId = (m.id || "").toLowerCase();
          const shortId = (
            m.modelID ||
            fullId.split("/")[1] ||
            fullId
          ).toLowerCase();

          return (
            dict[fullId] ||
            dict[shortId] ||
            dict[m.id] || {
              inputPerMillion: m.cost?.[0]?.input ?? 0,
              outputPerMillion: m.cost?.[0]?.output ?? 0,
              cacheReadPerMillion: m.cost?.[0]?.cache?.read ?? 0,
              cacheWritePerMillion: m.cost?.[0]?.cache?.write ?? 0,
              contextLimit: m.limit?.context,
              outputLimit: m.limit?.output,
            }
          );
        });

        const selectedVisualIdx = createMemo(() => {
          const list = visualData().entries;
          const sIdx = selectedIndex();
          const found = list.findIndex(
            (e) => e.type === "model" && e.modelIndex === sIdx,
          );
          return found >= 0 ? found : 0;
        });

        const VISIBLE_COUNT = 13;
        const visibleRange = createMemo(() => {
          const list = visualData().entries;
          const target = selectedVisualIdx();
          let start = Math.max(0, target - Math.floor(VISIBLE_COUNT / 2));
          if (start + VISIBLE_COUNT > list.length) {
            start = Math.max(0, list.length - VISIBLE_COUNT);
          }
          return {
            start,
            end: Math.min(list.length, start + VISIBLE_COUNT),
          };
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

        /**
         * Flow A — no session: persist the choice on the server. The prompt hook
         * applies it to the first prompt of the next new session, so selection
         * no longer depends on a session existing.
         *
         * Picking the model OpenCode already shows clears the stored preference,
         * which is the way to cancel a previously chosen next-session model.
         */
        const selectModelWithoutSession = async (
          target: ModelTarget,
          name: string,
        ) => {
          const pending = pendingModel;
          const active = context.ui.model.current();

          if (pending && isSameModel(pending, target)) {
            context.ui.toast.show({
              title: "Model already defined",
              message: `${name} (${target.providerID}) is already the model for the next session.`,
              variant: "info",
            });
            return;
          }

          if (pending && isSameModel(active, target)) {
            await pricingRpc.clearNextModel();
            context.ui.toast.show({
              title: "Next-session model cleared",
              message: `The next prompt will use the current model: ${name} (${target.providerID}).`,
              variant: "info",
            });
            return;
          }

          if (!pending && isSameModel(active, target)) {
            context.ui.toast.show({
              title: "Model already selected",
              message: `${name} (${target.providerID}) is already selected.`,
              variant: "info",
            });
            return;
          }

          const result: any = await pricingRpc.setNextModel(target);
          const applied: ModelTarget = result?.model ?? target;
          context.ui.toast.show({
            title: "Model Set for Next Session",
            message: `${name} (${applied.providerID}) will be used by the first prompt of the next session.`,
            variant: "success",
          });
        };

        const selectCurrentModel = async () => {
          if (isApplying()) return;

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
            if (sessionID) {
              const result = await applySelectedModel(sessionID, target);
              context.ui.toast.show({
                title:
                  result === "applied"
                    ? "Active Model Switched"
                    : "Model already active",
                message: `${m.name || target.modelID} (${target.providerID})`,
                variant: result === "applied" ? "success" : "info",
              });
            } else {
              await selectModelWithoutSession(target, m.name || target.modelID);
            }
            setIsApplying(false);
            close();
          } catch (error) {
            setIsApplying(false);
            handleSelectionError(
              errorMessage(error),
              sessionID ? "Error switching model" : "Error selecting model",
            );
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

            {/* No-session guidance: the choice applies to the next new session */}
            <Show when={!sessionID}>
              <box paddingLeft={1}>
                <Show
                  when={pendingModel}
                  fallback={
                    <text fg={theme().text?.muted || "gray"} wrap="word">
                      No session yet: the model you pick is applied to the first
                      prompt of the next new session.
                    </text>
                  }
                >
                  {(pending) => (
                    <text fg={theme().text?.muted || "gray"} wrap="word">
                      Next session: {pending().providerID}/
                      {pending().modelID} — applied to the first prompt of the
                      next new session.
                    </text>
                  )}
                </Show>
              </box>
            </Show>

            {/* Split Screen Body: Left (Grouped List) | Right (Details Card) */}
            <box flexDirection="row" gap={2}>
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

                        {/* Clickable Select Button */}
                        <box
                          marginTop={1}
                          paddingLeft={2}
                          paddingRight={2}
                          border={true}
                          onMouseDown={selectCurrentModel}
                          onMouseUp={selectCurrentModel}
                          alignSelf="flex-start"
                        >
                          <text bold fg={theme().text?.selected || "cyan"}>
                            {isApplying()
                              ? "Applying..."
                              : sessionID
                                ? "▶ Select Model [Enter]"
                                : "▶ Set for Next Session [Enter]"}
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

            {/* Footer with keymap shortcuts & clickable actions */}
            <box
              borderTop={true}
              paddingTop={1}
              flexDirection="row"
              justifyContent="space-between"
            >
              <text fg={theme().text?.muted || "gray"}>
                Type to Search | ↑/↓ Scroll | Click/Enter Select | Ctrl+F
                Favorite | Ctrl+R Refresh
              </text>
              <box flexDirection="row" gap={1}>
                <Show when={isApplying()}>
                  <text bold fg="yellow">
                    Switching model...
                  </text>
                </Show>
                <Show when={isRefreshing()}>
                  <text bold fg="yellow">
                    Refreshing...
                  </text>
                </Show>
                <box
                  onMouseDown={handleForceRefresh}
                  onMouseUp={handleForceRefresh}
                  paddingLeft={1}
                >
                  <text fg={theme().text?.muted || "gray"}>[Refresh]</text>
                </box>
              </box>
            </box>
          </box>
        );
      });
    }
  },
});

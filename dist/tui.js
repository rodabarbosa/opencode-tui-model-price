// @bun
// src/tui.tsx
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js";

// src/pricing.ts
var MODELS_DEV_URL = "https://models.dev/api.json";
async function fetchExternalPricing() {
  const result = {};
  try {
    const res = await fetch(MODELS_DEV_URL);
    if (!res.ok) {
      console.warn(`[model-pricing] Failed to fetch from ${MODELS_DEV_URL}: HTTP ${res.status}`);
      return result;
    }
    const data = await res.json();
    const now = new Date().toISOString();
    for (const [providerId, providerData] of Object.entries(data)) {
      if (!providerData || typeof providerData !== "object")
        continue;
      const modelsMap = providerData.models;
      if (!modelsMap || typeof modelsMap !== "object")
        continue;
      for (const [rawModelId, modelInfo] of Object.entries(modelsMap)) {
        if (!modelInfo || typeof modelInfo !== "object")
          continue;
        const cost = modelInfo.cost;
        if (!cost)
          continue;
        const detail = {
          name: modelInfo.name || rawModelId,
          providerID: providerId,
          inputPerMillion: cost.input ?? 0,
          outputPerMillion: cost.output ?? 0,
          cacheReadPerMillion: cost.cache_read ?? 0,
          cacheWritePerMillion: cost.cache_write ?? 0,
          contextLimit: modelInfo.limit?.context,
          outputLimit: modelInfo.limit?.output,
          source: "models.dev",
          updatedAt: now
        };
        result[`${providerId}/${rawModelId}`.toLowerCase()] = detail;
        result[rawModelId.toLowerCase()] = detail;
        if (modelInfo.id) {
          result[`${providerId}/${modelInfo.id}`.toLowerCase()] = detail;
          result[modelInfo.id.toLowerCase()] = detail;
        }
      }
    }
  } catch (error) {
    console.error("[model-pricing] Error fetching external prices:", error);
  }
  return result;
}
function buildPricingMatrixFromOpenCode(opencodeModels, externalPricing = {}) {
  const matrix = { ...externalPricing };
  const now = new Date().toISOString();
  const list = Array.isArray(opencodeModels) ? opencodeModels : Array.isArray(opencodeModels?.data) ? opencodeModels.data : [];
  for (const m of list) {
    const fullId = (m.id || "").toLowerCase();
    const shortId = (m.modelID || fullId.split("/")[1] || fullId).toLowerCase();
    let nativeCost;
    if (Array.isArray(m.cost) && m.cost.length > 0) {
      const primaryTier = m.cost[0];
      nativeCost = {
        name: m.name || m.id,
        providerID: m.providerID,
        inputPerMillion: primaryTier.input ?? 0,
        outputPerMillion: primaryTier.output ?? 0,
        cacheReadPerMillion: primaryTier.cache?.read ?? 0,
        cacheWritePerMillion: primaryTier.cache?.write ?? 0,
        contextLimit: m.limit?.context,
        outputLimit: m.limit?.output,
        source: "opencode-native",
        updatedAt: now
      };
    }
    const external = matrix[fullId] || matrix[shortId];
    const effective = {
      name: m.name || external?.name || m.id,
      providerID: m.providerID || external?.providerID,
      inputPerMillion: nativeCost?.inputPerMillion ?? external?.inputPerMillion ?? 0,
      outputPerMillion: nativeCost?.outputPerMillion ?? external?.outputPerMillion ?? 0,
      cacheReadPerMillion: nativeCost?.cacheReadPerMillion ?? external?.cacheReadPerMillion ?? 0,
      cacheWritePerMillion: nativeCost?.cacheWritePerMillion ?? external?.cacheWritePerMillion ?? 0,
      contextLimit: m.limit?.context ?? external?.contextLimit,
      outputLimit: m.limit?.output ?? external?.outputLimit,
      source: nativeCost ? "opencode" : external?.source ?? "estimated",
      updatedAt: now
    };
    matrix[fullId] = effective;
    matrix[shortId] = effective;
    if (m.id)
      matrix[m.id] = effective;
  }
  return matrix;
}
function formatUSD(amount) {
  if (amount === undefined || isNaN(amount))
    return "N/A";
  if (amount === 0)
    return "$0.00";
  if (amount < 0.01)
    return `$${amount.toFixed(4)}`;
  if (amount < 0.1)
    return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}
function lookupModelPrice(model, matrix = {}) {
  const fullId = (model?.id || "").toLowerCase();
  const shortId = (model?.modelID || fullId.split("/")[1] || fullId).toLowerCase();
  const found = matrix[fullId] || matrix[shortId] || (model?.id ? matrix[model.id] : undefined);
  if (found)
    return found;
  return {
    inputPerMillion: model?.cost?.[0]?.input ?? 0,
    outputPerMillion: model?.cost?.[0]?.output ?? 0,
    cacheReadPerMillion: model?.cost?.[0]?.cache?.read ?? 0,
    cacheWritePerMillion: model?.cost?.[0]?.cache?.write ?? 0,
    contextLimit: model?.limit?.context,
    outputLimit: model?.limit?.output
  };
}
var modelLabel = (model) => String(model?.name || model?.id || "").toLowerCase();
function compareModelsByName(a, b) {
  return modelLabel(a).localeCompare(modelLabel(b));
}
function compareModelsByInputPrice(a, b, matrix = {}) {
  const diff = lookupModelPrice(a, matrix).inputPerMillion - lookupModelPrice(b, matrix).inputPerMillion;
  return diff !== 0 ? diff : compareModelsByName(a, b);
}
function sortModels(models, mode, matrix = {}) {
  const compare = mode === "input" ? (a, b) => compareModelsByInputPrice(a, b, matrix) : compareModelsByName;
  return [...models].sort(compare);
}

// src/model-selection.ts
function resolveActiveSessionID(route) {
  if (!route || route.type !== "session")
    return;
  const sessionID = route.sessionID;
  if (typeof sessionID !== "string")
    return;
  const trimmed = sessionID.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
function toModelTarget(model) {
  const providerID = typeof model?.providerID === "string" ? model.providerID.trim() : "";
  const catalogModelID = typeof model?.id === "string" ? model.id.trim() : "";
  const providerModelID = typeof model?.modelID === "string" ? model.modelID.trim() : "";
  const modelID = catalogModelID || providerModelID;
  if (!providerID)
    throw new Error("The selected model has no provider ID.");
  if (!modelID)
    throw new Error("The selected model has no model ID.");
  return { providerID, modelID };
}
function isSameModel(selection, target) {
  if (!selection)
    return false;
  return selection.providerID === target.providerID && selection.modelID === target.modelID;
}
function matchesModelRef(ref, target) {
  if (!ref)
    return false;
  return ref.providerID === target.providerID && ref.id === target.modelID;
}
function describeModelRef(ref) {
  if (!ref || !ref.providerID || !ref.id)
    return "unknown";
  return `${ref.providerID}/${ref.id}`;
}
function errorMessage(error) {
  if (error instanceof Error && error.message)
    return error.message;
  if (typeof error === "string" && error.length > 0)
    return error;
  return "Unknown error";
}

// src/rpc.ts
function stdSchema(validator) {
  return {
    "~standard": {
      version: 1,
      vendor: "model-pricing",
      validate: (value) => {
        const issue = validator ? validator(value) : null;
        return issue ? { issues: [{ message: issue }] } : { value };
      }
    }
  };
}
var ModelPricingRpc = {
  id: "model-pricing",
  events: {
    updated: {
      schema: stdSchema()
    }
  },
  methods: {
    getPrices: {
      input: stdSchema(),
      output: stdSchema()
    },
    forceRefresh: {
      input: stdSchema(),
      output: stdSchema()
    }
  }
};

// src/tui.tsx
function formatProviderTitle(provider) {
  if (!provider)
    return "OTHER PROVIDERS";
  const p = provider.toLowerCase();
  if (p === "github-copilot" || p === "copilot")
    return "GITHUB COPILOT";
  if (p === "openrouter")
    return "OPENROUTER";
  if (p === "opencode")
    return "OPENCODE";
  if (p === "openai")
    return "OPENAI";
  if (p === "anthropic")
    return "ANTHROPIC";
  if (p === "google")
    return "GOOGLE GEMINI";
  return provider.toUpperCase();
}
var tui_default = Plugin.define({
  id: "model-pricing-tui",
  setup(context) {
    const pricingRpc = context.client.rpc(ModelPricingRpc);
    const [favoritesStore, updateFavorites] = context.storage.store("favorites", {
      initial: {
        ids: []
      }
    });
    async function applySelectedModel(sessionID, target) {
      if (isSameModel(context.ui.model.current(), target))
        return "unchanged";
      try {
        await context.client.session.switchModel({
          sessionID,
          model: {
            providerID: target.providerID,
            id: target.modelID
          }
        });
      } catch (error) {
        throw new Error(`OpenCode rejected the model switch: ${errorMessage(error)}`);
      }
      try {
        await context.data.session.sync(sessionID);
      } catch {}
      const cached = context.data.session.get(sessionID)?.model;
      if (matchesModelRef(cached, target))
        return "applied";
      let committed;
      try {
        committed = (await context.client.session.get({
          sessionID
        }))?.model;
      } catch (error) {
        throw new Error(`Unable to confirm the model switch for session ${sessionID}: ${errorMessage(error)}`);
      }
      if (matchesModelRef(committed, target)) {
        try {
          await context.data.session.sync(sessionID);
        } catch {}
        return "applied";
      }
      throw new Error(`OpenCode did not switch to ${target.providerID}/${target.modelID} ` + `(active model: ${describeModelRef(committed ?? cached)}).`);
    }
    context.keymap.layer(() => ({
      mode: "global",
      priority: 100,
      commands: [{
        id: "model.pricing.dialog",
        title: "Models: Select with pricing details",
        group: "Models",
        slash: {
          name: "models-price"
        },
        palette: true,
        suggested: true,
        run: () => {
          openPricingModelDialog();
        }
      }]
    }));
    async function openPricingModelDialog() {
      const localModels = context.data.location.model.list() ?? [];
      const location = context.location ?? context.data.location.default();
      const sessionID = resolveActiveSessionID(context.ui.router.current());
      const terminalRows = (() => {
        try {
          const height = context.renderer?.height;
          return typeof height === "number" && height > 0 ? height : undefined;
        } catch {
          return;
        }
      })();
      const dialogRows = terminalRows ? Math.max(20, Math.floor(terminalRows * 0.7)) : undefined;
      context.ui.dialog.set({
        size: "xlarge",
        centered: true
      });
      context.ui.dialog.show(() => {
        context.ui.dialog.set({
          size: "xlarge",
          centered: true
        });
        const [modelsList, setModelsList] = createSignal(localModels);
        const [selectedIndex, setSelectedIndex] = createSignal(0);
        const [searchQuery, setSearchQuery] = createSignal("");
        const [prices, setPrices] = createSignal({});
        const [sortMode, setSortMode] = createSignal("name");
        const [isRefreshing, setIsRefreshing] = createSignal(false);
        const [isApplying, setIsApplying] = createSignal(false);
        const [selectionError, setSelectionError] = createSignal(null);
        let inputRef = null;
        let lastClickTime = 0;
        let followsActiveModel = true;
        onMount(() => {
          inputRef?.focus();
          pricingRpc.getPrices().then((p) => {
            if (p)
              setPrices(p);
          }).catch(() => {});
          context.client.model.list({
            location
          }).then((res) => {
            if (res?.data && res.data.length > 0) {
              setModelsList(res.data);
            }
          }).catch(() => {});
        });
        const theme = () => {
          try {
            return context.theme.surface?.("dialog") || context.theme;
          } catch {
            return context.theme;
          }
        };
        const close = () => context.ui.dialog.clear();
        const isFavorite = (id) => {
          if (!id)
            return false;
          const list = favoritesStore.ids || [];
          return list.includes(id.toLowerCase());
        };
        const filteredModelsList = createMemo(() => {
          const q = searchQuery().trim().toLowerCase();
          const list = modelsList();
          if (!q)
            return list;
          return list.filter((m) => {
            const name = (m.name || "").toLowerCase();
            const id = (m.id || "").toLowerCase();
            const provider = (m.providerID || "").toLowerCase();
            return name.includes(q) || id.includes(q) || provider.includes(q);
          });
        });
        const visualData = createMemo(() => {
          const list = filteredModelsList();
          const mode = sortMode();
          const matrix = prices();
          const favs = [];
          const byProvider = {};
          for (const m of list) {
            if (isFavorite(m.id)) {
              favs.push(m);
            } else {
              const p = (m.providerID || "other").toLowerCase();
              if (!byProvider[p])
                byProvider[p] = [];
              byProvider[p].push(m);
            }
          }
          const sortedFavs = sortModels(favs, mode, matrix);
          const entries = [];
          const selectable = [];
          let globalIdx = 0;
          if (sortedFavs.length > 0) {
            entries.push({
              type: "header",
              id: "hdr_favorites",
              title: "\u2605 FAVORITES",
              count: sortedFavs.length,
              isFav: true
            });
            for (const m of sortedFavs) {
              entries.push({
                type: "model",
                id: `fav_${m.id}`,
                model: m,
                modelIndex: globalIdx++,
                isFav: true
              });
              selectable.push(m);
            }
          }
          const priority = ["copilot", "github-copilot", "opencode", "openrouter", "openai", "anthropic", "google"];
          const sortedProviders = Object.keys(byProvider).sort((a, b) => {
            const idxA = priority.indexOf(a);
            const idxB = priority.indexOf(b);
            if (idxA !== -1 && idxB !== -1)
              return idxA - idxB;
            if (idxA !== -1)
              return -1;
            if (idxB !== -1)
              return 1;
            return a.localeCompare(b);
          });
          for (const provider of sortedProviders) {
            const group = byProvider[provider];
            if (!group || group.length === 0)
              continue;
            const pModels = sortModels(group, mode, matrix);
            entries.push({
              type: "header",
              id: `hdr_${provider}`,
              title: formatProviderTitle(provider),
              count: pModels.length,
              isFav: false
            });
            for (const m of pModels) {
              entries.push({
                type: "model",
                id: m.id,
                model: m,
                modelIndex: globalIdx++,
                isFav: false
              });
              selectable.push(m);
            }
          }
          return {
            entries,
            selectable
          };
        });
        const totalSelectable = () => visualData().selectable.length;
        const setSelection = (index) => {
          followsActiveModel = false;
          setSelectedIndex(index);
        };
        const activeModelIndex = () => {
          const current = context.ui.model.current();
          if (!current)
            return -1;
          return visualData().selectable.findIndex((m) => m.providerID === current.providerID && (m.modelID === current.modelID || m.id === current.modelID));
        };
        createEffect(() => {
          if (!followsActiveModel)
            return;
          const index = activeModelIndex();
          if (index >= 0 && index !== selectedIndex())
            setSelectedIndex(index);
        });
        const currentModel = createMemo(() => {
          const list = visualData().selectable;
          if (list.length === 0)
            return;
          const idx = selectedIndex();
          return list[idx] || list[0];
        });
        const currentPrice = createMemo(() => {
          const m = currentModel();
          if (!m) {
            return {
              inputPerMillion: 0,
              outputPerMillion: 0,
              cacheReadPerMillion: 0,
              cacheWritePerMillion: 0
            };
          }
          return lookupModelPrice(m, prices());
        });
        const selectedVisualIdx = createMemo(() => {
          const list = visualData().entries;
          const sIdx = selectedIndex();
          const found = list.findIndex((e) => e.type === "model" && e.modelIndex === sIdx);
          return found >= 0 ? found : 0;
        });
        const CHROME_ROWS = 13;
        const listRows = createMemo(() => {
          if (!dialogRows)
            return 16;
          const extra = (sessionID ? 0 : 2) + (selectionError() ? 3 : 0);
          return Math.max(3, dialogRows - CHROME_ROWS - extra);
        });
        const entryRows = (entry) => entry.type === "header" ? 2 : 1;
        const visibleRange = createMemo(() => {
          const list = visualData().entries;
          if (list.length === 0)
            return {
              start: 0,
              end: 0
            };
          const target = Math.min(selectedVisualIdx(), list.length - 1);
          const budget = listRows();
          let start = Math.max(0, target - Math.floor(budget / 2));
          let used = 0;
          let end = start;
          while (end < list.length && used + entryRows(list[end]) <= budget) {
            used += entryRows(list[end]);
            end++;
          }
          if (target >= end) {
            start = target;
            end = target + 1;
            used = entryRows(list[target]);
            while (start > 0 && used + entryRows(list[start - 1]) <= budget) {
              start--;
              used += entryRows(list[start]);
            }
          }
          return {
            start,
            end
          };
        });
        const visibleEntries = createMemo(() => {
          const {
            start,
            end
          } = visibleRange();
          return visualData().entries.slice(start, end);
        });
        const handleSelectionError = (message, title = "Error switching model") => {
          setSelectionError(message);
          context.ui.toast.show({
            title,
            message,
            variant: "error"
          });
        };
        const requestClose = () => {
          if (isApplying())
            return;
          close();
        };
        const selectCurrentModel = async () => {
          if (isApplying())
            return;
          if (!sessionID) {
            handleSelectionError("No active session: start a session before selecting a model.", "Selection unavailable");
            return;
          }
          const m = currentModel();
          if (!m)
            return;
          setSelectionError(null);
          let target;
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
              title: result === "applied" ? "Active Model Switched" : "Model already active",
              message: `${m.name || target.modelID} (${target.providerID})`,
              variant: result === "applied" ? "success" : "info"
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
          if (!m)
            return;
          const id = (m.id || "").toLowerCase();
          await updateFavorites((draft) => {
            if (!draft.ids)
              draft.ids = [];
            const idx = draft.ids.indexOf(id);
            if (idx >= 0) {
              draft.ids.splice(idx, 1);
              context.ui.toast.show({
                title: "Favorites",
                message: `Removed from favorites: ${m.name || m.id}`,
                variant: "info"
              });
            } else {
              draft.ids.push(id);
              context.ui.toast.show({
                title: "Favorites",
                message: `\u2605 Added to favorites: ${m.name || m.id}`,
                variant: "success"
              });
            }
          });
        };
        const toggleSortMode = () => {
          const model = currentModel();
          const next = sortMode() === "name" ? "input" : "name";
          followsActiveModel = false;
          setSortMode(next);
          const nextIndex = model ? visualData().selectable.indexOf(model) : -1;
          setSelection(nextIndex >= 0 ? nextIndex : 0);
        };
        const handleForceRefresh = async () => {
          if (isRefreshing())
            return;
          setIsRefreshing(true);
          try {
            const res = await pricingRpc.forceRefresh();
            const fresh = await pricingRpc.getPrices();
            setPrices(fresh);
            context.ui.toast.show({
              title: "Prices Synchronized",
              message: `${res.count} models updated.`,
              variant: "success"
            });
          } catch (e) {
            context.ui.toast.show({
              title: "Sync Error",
              message: e?.message || "Network error.",
              variant: "error"
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
        const handleItemClick = (idx) => {
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
          commands: [{
            bind: "down,ctrl+n",
            title: "Next",
            group: "Navigation",
            run: () => {
              const max = totalSelectable() - 1;
              if (max > 0)
                setSelection(Math.min(selectedIndex() + 1, max));
            }
          }, {
            bind: "up,ctrl+p",
            title: "Previous",
            group: "Navigation",
            run: () => setSelection(Math.max(selectedIndex() - 1, 0))
          }, {
            bind: "pagedown",
            title: "Page Down",
            group: "Navigation",
            run: () => {
              const max = totalSelectable() - 1;
              if (max > 0)
                setSelection(Math.min(selectedIndex() + 6, max));
            }
          }, {
            bind: "pageup",
            title: "Page Up",
            group: "Navigation",
            run: () => setSelection(Math.max(selectedIndex() - 6, 0))
          }, {
            bind: "return",
            title: "Confirm Selection",
            group: "Action",
            run: selectCurrentModel
          }, {
            bind: "ctrl+f",
            title: "Toggle Favorite",
            group: "Action",
            run: toggleFavorite
          }, {
            bind: "ctrl+s",
            title: "Toggle Sort (Name / Input Price)",
            group: "Action",
            run: toggleSortMode
          }, {
            bind: "ctrl+r",
            title: "Force Refresh",
            group: "Action",
            run: handleForceRefresh
          }, {
            bind: "escape",
            title: "Close",
            group: "Action",
            run: () => {
              if (searchQuery().length > 0) {
                clearSearch();
              } else {
                requestClose();
              }
            }
          }]
        }));
        return (() => {
          var _el$ = _$createElement("box"), _el$2 = _$createElement("box"), _el$3 = _$createElement("text"), _el$5 = _$createElement("box"), _el$6 = _$createElement("text"), _el$7 = _$createTextNode(`[`), _el$8 = _$createTextNode(`/`), _el$9 = _$createTextNode(`]`), _el$0 = _$createElement("box"), _el$1 = _$createElement("text"), _el$11 = _$createElement("box"), _el$12 = _$createElement("text"), _el$14 = _$createElement("box"), _el$15 = _$createElement("input"), _el$22 = _$createElement("box"), _el$23 = _$createElement("box"), _el$24 = _$createElement("box"), _el$28 = _$createElement("box"), _el$29 = _$createElement("box"), _el$30 = _$createElement("text"), _el$32 = _$createElement("box"), _el$37 = _$createElement("box"), _el$38 = _$createElement("text"), _el$40 = _$createElement("box"), _el$41 = _$createElement("text"), _el$42 = _$createElement("text");
          _$insertNode(_el$, _el$2);
          _$insertNode(_el$, _el$11);
          _$insertNode(_el$, _el$22);
          _$insertNode(_el$, _el$28);
          _$setProp(_el$, "flexDirection", "column");
          _$setProp(_el$, "height", dialogRows);
          _$setProp(_el$, "paddingLeft", 1);
          _$setProp(_el$, "paddingRight", 1);
          _$setProp(_el$, "gap", 1);
          _$setProp(_el$, "onKeyDown", (key) => {
            if (!key.ctrl && !key.alt && !key.meta && key.sequence && key.sequence.length === 1 && key.sequence >= " ") {
              if (inputRef && inputRef.value === "") {
                inputRef.focus();
                inputRef.insertText(key.sequence);
              }
            }
          });
          _$insertNode(_el$2, _el$3);
          _$insertNode(_el$2, _el$5);
          _$setProp(_el$2, "flexDirection", "row");
          _$setProp(_el$2, "justifyContent", "space-between");
          _$setProp(_el$2, "borderBottom", true);
          _$setProp(_el$2, "paddingBottom", 1);
          _$insertNode(_el$3, _$createTextNode(`\u26A1 Model Selection & Token Pricing`));
          _$setProp(_el$3, "bold", true);
          _$insertNode(_el$5, _el$6);
          _$insertNode(_el$5, _el$0);
          _$setProp(_el$5, "flexDirection", "row");
          _$setProp(_el$5, "gap", 1);
          _$insertNode(_el$6, _el$7);
          _$insertNode(_el$6, _el$8);
          _$insertNode(_el$6, _el$9);
          _$insert(_el$6, (() => {
            var _c$ = _$memo(() => totalSelectable() > 0);
            return () => _c$() ? selectedIndex() + 1 : 0;
          })(), _el$8);
          _$insert(_el$6, totalSelectable, _el$9);
          _$insertNode(_el$0, _el$1);
          _$setProp(_el$0, "onMouseDown", requestClose);
          _$setProp(_el$0, "onMouseUp", requestClose);
          _$setProp(_el$0, "paddingLeft", 1);
          _$insertNode(_el$1, _$createTextNode(`[Esc]`));
          _$insertNode(_el$11, _el$12);
          _$insertNode(_el$11, _el$14);
          _$setProp(_el$11, "flexDirection", "row");
          _$setProp(_el$11, "alignItems", "center");
          _$setProp(_el$11, "borderBottom", true);
          _$setProp(_el$11, "paddingBottom", 1);
          _$setProp(_el$11, "gap", 1);
          _$setProp(_el$11, "onMouseDown", () => inputRef?.focus());
          _$setProp(_el$11, "onMouseUp", () => inputRef?.focus());
          _$insertNode(_el$12, _$createTextNode(`Search:`));
          _$setProp(_el$12, "bold", true);
          _$insertNode(_el$14, _el$15);
          _$setProp(_el$14, "flexGrow", 1);
          _$setProp(_el$14, "flexDirection", "row");
          _$setProp(_el$14, "alignItems", "center");
          _$use((el) => {
            inputRef = el;
            if (el)
              el.focus();
          }, _el$15);
          _$setProp(_el$15, "placeholder", "Type to filter models (name, id, provider)...");
          _$setProp(_el$15, "onInput", (val) => {
            setSearchQuery(val || "");
            setSelection(0);
          });
          _$setProp(_el$15, "focused", true);
          _$setProp(_el$15, "paddingLeft", 3);
          _$insert(_el$11, _$createComponent(Show, {
            get when() {
              return searchQuery().length > 0;
            },
            get children() {
              var _el$16 = _$createElement("box"), _el$17 = _$createElement("text");
              _$insertNode(_el$16, _el$17);
              _$setProp(_el$16, "onMouseDown", clearSearch);
              _$setProp(_el$16, "onMouseUp", clearSearch);
              _$setProp(_el$16, "paddingLeft", 1);
              _$insertNode(_el$17, _$createTextNode(`[Clear]`));
              _$effect((_$p) => _$setProp(_el$17, "fg", theme().text?.muted || "gray", _$p));
              return _el$16;
            }
          }), null);
          _$insert(_el$, _$createComponent(Show, {
            when: !sessionID,
            get children() {
              var _el$19 = _$createElement("box"), _el$20 = _$createElement("text");
              _$insertNode(_el$19, _el$20);
              _$setProp(_el$19, "paddingLeft", 1);
              _$insertNode(_el$20, _$createTextNode(`No session active: pricing is browse-only \u2014 start a session to select a model.`));
              _$setProp(_el$20, "wrap", "word");
              _$effect((_$p) => _$setProp(_el$20, "fg", theme().text?.muted || "gray", _$p));
              return _el$19;
            }
          }), _el$22);
          _$insertNode(_el$22, _el$23);
          _$insertNode(_el$22, _el$24);
          _$setProp(_el$22, "flexDirection", "row");
          _$setProp(_el$22, "flexGrow", 1);
          _$setProp(_el$22, "minHeight", 0);
          _$setProp(_el$22, "gap", 2);
          _$setProp(_el$23, "width", "58%");
          _$setProp(_el$23, "flexDirection", "column");
          _$setProp(_el$23, "borderRight", true);
          _$setProp(_el$23, "paddingRight", 2);
          _$setProp(_el$23, "onMouse", (e) => {
            if (e.type === "scroll") {
              const dir = e.scroll?.direction || (e.deltaY > 0 ? "down" : "up");
              if (dir === "up" || e.deltaY < 0) {
                setSelection(Math.max(selectedIndex() - 1, 0));
              } else {
                const max = totalSelectable() - 1;
                if (max > 0)
                  setSelection(Math.min(selectedIndex() + 1, max));
              }
            }
          });
          _$insert(_el$23, _$createComponent(Show, {
            get when() {
              return visibleEntries().length > 0;
            },
            get fallback() {
              return (() => {
                var _el$44 = _$createElement("box"), _el$45 = _$createElement("text"), _el$46 = _$createTextNode(`No models matching "`), _el$47 = _$createTextNode(`"`);
                _$insertNode(_el$44, _el$45);
                _$setProp(_el$44, "paddingY", 2);
                _$setProp(_el$44, "paddingLeft", 1);
                _$insertNode(_el$45, _el$46);
                _$insertNode(_el$45, _el$47);
                _$insert(_el$45, searchQuery, _el$47);
                _$effect((_$p) => _$setProp(_el$45, "fg", theme().text?.muted || "gray", _$p));
                return _el$44;
              })();
            },
            get children() {
              return _$createComponent(For, {
                get each() {
                  return visibleEntries();
                },
                children: (entry) => {
                  if (entry.type === "header") {
                    return (() => {
                      var _el$48 = _$createElement("box"), _el$49 = _$createElement("text");
                      _$insertNode(_el$48, _el$49);
                      _$setProp(_el$48, "paddingTop", 1);
                      _$setProp(_el$48, "paddingBottom", 0);
                      _$setProp(_el$48, "paddingLeft", 1);
                      _$setProp(_el$48, "flexDirection", "row");
                      _$setProp(_el$49, "bold", true);
                      _$setProp(_el$49, "wrap", "never");
                      _$insert(_el$49, () => entry.isFav ? "\u2605 " : "", null);
                      _$insert(_el$49, () => entry.title, null);
                      _$effect((_$p) => _$setProp(_el$49, "fg", entry.isFav ? "yellow" : theme().text?.selected || "cyan", _$p));
                      return _el$48;
                    })();
                  }
                  const isSelected = () => entry.modelIndex === selectedIndex();
                  return (() => {
                    var _el$50 = _$createElement("box"), _el$51 = _$createElement("box"), _el$52 = _$createElement("text"), _el$56 = _$createElement("text"), _el$57 = _$createElement("text");
                    _$insertNode(_el$50, _el$51);
                    _$insertNode(_el$50, _el$57);
                    _$setProp(_el$50, "paddingLeft", 1);
                    _$setProp(_el$50, "paddingRight", 1);
                    _$setProp(_el$50, "flexDirection", "row");
                    _$setProp(_el$50, "justifyContent", "space-between");
                    _$setProp(_el$50, "gap", 2);
                    _$setProp(_el$50, "onMouseDown", () => handleItemClick(entry.modelIndex));
                    _$setProp(_el$50, "onMouseUp", () => handleItemClick(entry.modelIndex));
                    _$insertNode(_el$51, _el$52);
                    _$insertNode(_el$51, _el$56);
                    _$setProp(_el$51, "flexDirection", "row");
                    _$setProp(_el$52, "wrap", "never");
                    _$insert(_el$52, () => isSelected() ? "\u25B6 " : "  ");
                    _$insert(_el$51, _$createComponent(Show, {
                      get when() {
                        return entry.isFav;
                      },
                      get children() {
                        var _el$53 = _$createElement("text"), _el$54 = _$createTextNode(`\u2605 `);
                        _$insertNode(_el$53, _el$54);
                        _$setProp(_el$53, "fg", "yellow");
                        _$setProp(_el$53, "bold", true);
                        _$setProp(_el$53, "wrap", "never");
                        return _el$53;
                      }
                    }), _el$56);
                    _$setProp(_el$56, "wrap", "never");
                    _$insert(_el$56, () => entry.model.name || entry.model.id);
                    _$setProp(_el$57, "wrap", "never");
                    _$insert(_el$57, () => entry.model.providerID || "");
                    _$effect((_p$) => {
                      var _v$9 = isSelected(), _v$0 = isSelected() ? theme().text?.selected || "cyan" : theme().text?.base || "white", _v$1 = isSelected(), _v$10 = isSelected() ? theme().text?.selected || "cyan" : theme().text?.base || "white", _v$11 = theme().text?.muted || "gray";
                      _v$9 !== _p$.e && (_p$.e = _$setProp(_el$52, "bold", _v$9, _p$.e));
                      _v$0 !== _p$.t && (_p$.t = _$setProp(_el$52, "fg", _v$0, _p$.t));
                      _v$1 !== _p$.a && (_p$.a = _$setProp(_el$56, "bold", _v$1, _p$.a));
                      _v$10 !== _p$.o && (_p$.o = _$setProp(_el$56, "fg", _v$10, _p$.o));
                      _v$11 !== _p$.i && (_p$.i = _$setProp(_el$57, "fg", _v$11, _p$.i));
                      return _p$;
                    }, {
                      e: undefined,
                      t: undefined,
                      a: undefined,
                      o: undefined,
                      i: undefined
                    });
                    return _el$50;
                  })();
                }
              });
            }
          }));
          _$setProp(_el$24, "width", "42%");
          _$setProp(_el$24, "flexDirection", "column");
          _$setProp(_el$24, "paddingLeft", 1);
          _$insert(_el$24, _$createComponent(Show, {
            get when() {
              return currentModel();
            },
            get fallback() {
              return (() => {
                var _el$58 = _$createElement("box"), _el$59 = _$createElement("text");
                _$insertNode(_el$58, _el$59);
                _$setProp(_el$58, "paddingY", 2);
                _$insertNode(_el$59, _$createTextNode(`No model selected`));
                _$effect((_$p) => _$setProp(_el$59, "fg", theme().text?.muted || "gray", _$p));
                return _el$58;
              })();
            },
            children: (m) => {
              const p = currentPrice;
              const fav = () => isFavorite(m().id);
              return (() => {
                var _el$61 = _$createElement("box"), _el$62 = _$createElement("box"), _el$63 = _$createElement("box"), _el$64 = _$createElement("text"), _el$65 = _$createElement("box"), _el$66 = _$createElement("text"), _el$67 = _$createElement("text"), _el$68 = _$createTextNode(` \u2022 `), _el$69 = _$createElement("box"), _el$70 = _$createElement("box"), _el$71 = _$createElement("text"), _el$73 = _$createElement("text"), _el$74 = _$createTextNode(` / 1M`), _el$75 = _$createElement("box"), _el$76 = _$createElement("text"), _el$78 = _$createElement("text"), _el$79 = _$createTextNode(` / 1M`), _el$80 = _$createElement("box"), _el$81 = _$createElement("text"), _el$83 = _$createElement("text"), _el$84 = _$createTextNode(` / 1M`), _el$85 = _$createElement("box"), _el$86 = _$createElement("text"), _el$88 = _$createElement("text"), _el$89 = _$createTextNode(` / 1M`), _el$90 = _$createElement("box"), _el$91 = _$createElement("text"), _el$92 = _$createTextNode(`Context: `), _el$94 = _$createTextNode(` tokens`), _el$95 = _$createElement("text"), _el$96 = _$createTextNode(`Max Output: `), _el$98 = _$createTextNode(` tokens`), _el$99 = _$createElement("text"), _el$100 = _$createTextNode(`Source: `);
                _$insertNode(_el$61, _el$62);
                _$insertNode(_el$61, _el$69);
                _$insertNode(_el$61, _el$90);
                _$setProp(_el$61, "flexDirection", "column");
                _$setProp(_el$61, "gap", 1);
                _$insertNode(_el$62, _el$63);
                _$insertNode(_el$62, _el$67);
                _$setProp(_el$62, "flexDirection", "column");
                _$insertNode(_el$63, _el$64);
                _$insertNode(_el$63, _el$65);
                _$setProp(_el$63, "flexDirection", "row");
                _$setProp(_el$63, "justifyContent", "space-between");
                _$setProp(_el$64, "bold", true);
                _$setProp(_el$64, "wrap", "never");
                _$insert(_el$64, () => fav() ? "\u2605 " : "", null);
                _$insert(_el$64, () => m().name || m().id, null);
                _$insertNode(_el$65, _el$66);
                _$setProp(_el$65, "onMouseDown", toggleFavorite);
                _$setProp(_el$65, "onMouseUp", toggleFavorite);
                _$setProp(_el$65, "paddingLeft", 1);
                _$setProp(_el$66, "bold", true);
                _$setProp(_el$66, "wrap", "never");
                _$insert(_el$66, () => fav() ? "\u2605 [Favorited]" : "\u2606 [Favorite]");
                _$insertNode(_el$67, _el$68);
                _$setProp(_el$67, "wrap", "never");
                _$insert(_el$67, () => m().providerID, _el$68);
                _$insert(_el$67, () => m().id, null);
                _$insertNode(_el$69, _el$70);
                _$insertNode(_el$69, _el$75);
                _$insertNode(_el$69, _el$80);
                _$insertNode(_el$69, _el$85);
                _$setProp(_el$69, "paddingX", 1);
                _$setProp(_el$69, "paddingY", 1);
                _$setProp(_el$69, "border", true);
                _$setProp(_el$69, "flexDirection", "column");
                _$insertNode(_el$70, _el$71);
                _$insertNode(_el$70, _el$73);
                _$setProp(_el$70, "flexDirection", "row");
                _$setProp(_el$70, "justifyContent", "space-between");
                _$insertNode(_el$71, _$createTextNode(`Input:`));
                _$setProp(_el$71, "wrap", "never");
                _$insertNode(_el$73, _el$74);
                _$setProp(_el$73, "bold", true);
                _$setProp(_el$73, "wrap", "never");
                _$insert(_el$73, () => formatUSD(p().inputPerMillion), _el$74);
                _$insertNode(_el$75, _el$76);
                _$insertNode(_el$75, _el$78);
                _$setProp(_el$75, "flexDirection", "row");
                _$setProp(_el$75, "justifyContent", "space-between");
                _$insertNode(_el$76, _$createTextNode(`Output:`));
                _$setProp(_el$76, "wrap", "never");
                _$insertNode(_el$78, _el$79);
                _$setProp(_el$78, "bold", true);
                _$setProp(_el$78, "wrap", "never");
                _$insert(_el$78, () => formatUSD(p().outputPerMillion), _el$79);
                _$insertNode(_el$80, _el$81);
                _$insertNode(_el$80, _el$83);
                _$setProp(_el$80, "flexDirection", "row");
                _$setProp(_el$80, "justifyContent", "space-between");
                _$insertNode(_el$81, _$createTextNode(`Cache Read:`));
                _$setProp(_el$81, "wrap", "never");
                _$insertNode(_el$83, _el$84);
                _$setProp(_el$83, "bold", true);
                _$setProp(_el$83, "wrap", "never");
                _$insert(_el$83, () => formatUSD(p().cacheReadPerMillion), _el$84);
                _$insertNode(_el$85, _el$86);
                _$insertNode(_el$85, _el$88);
                _$setProp(_el$85, "flexDirection", "row");
                _$setProp(_el$85, "justifyContent", "space-between");
                _$insertNode(_el$86, _$createTextNode(`Cache Write:`));
                _$setProp(_el$86, "wrap", "never");
                _$insertNode(_el$88, _el$89);
                _$setProp(_el$88, "bold", true);
                _$setProp(_el$88, "wrap", "never");
                _$insert(_el$88, () => formatUSD(p().cacheWritePerMillion), _el$89);
                _$insertNode(_el$90, _el$91);
                _$insertNode(_el$90, _el$95);
                _$insertNode(_el$90, _el$99);
                _$setProp(_el$90, "flexDirection", "column");
                _$insertNode(_el$91, _el$92);
                _$insertNode(_el$91, _el$94);
                _$setProp(_el$91, "wrap", "never");
                _$insert(_el$91, () => p().contextLimit?.toLocaleString() ?? "N/A", _el$94);
                _$insertNode(_el$95, _el$96);
                _$insertNode(_el$95, _el$98);
                _$setProp(_el$95, "wrap", "never");
                _$insert(_el$95, () => p().outputLimit?.toLocaleString() ?? "N/A", _el$98);
                _$insertNode(_el$99, _el$100);
                _$setProp(_el$99, "wrap", "never");
                _$insert(_el$99, () => p().source || "models.dev", null);
                _$effect((_p$) => {
                  var _v$12 = theme().text?.selected || "cyan", _v$13 = fav() ? "yellow" : "gray", _v$14 = theme().text?.muted || "gray", _v$15 = theme().text?.muted || "gray", _v$16 = theme().text?.base || "white", _v$17 = theme().text?.muted || "gray", _v$18 = theme().text?.base || "white", _v$19 = theme().text?.muted || "gray", _v$20 = theme().text?.base || "white", _v$21 = theme().text?.muted || "gray", _v$22 = theme().text?.base || "white", _v$23 = theme().text?.muted || "gray", _v$24 = theme().text?.muted || "gray", _v$25 = theme().text?.muted || "gray";
                  _v$12 !== _p$.e && (_p$.e = _$setProp(_el$64, "fg", _v$12, _p$.e));
                  _v$13 !== _p$.t && (_p$.t = _$setProp(_el$66, "fg", _v$13, _p$.t));
                  _v$14 !== _p$.a && (_p$.a = _$setProp(_el$67, "fg", _v$14, _p$.a));
                  _v$15 !== _p$.o && (_p$.o = _$setProp(_el$71, "fg", _v$15, _p$.o));
                  _v$16 !== _p$.i && (_p$.i = _$setProp(_el$73, "fg", _v$16, _p$.i));
                  _v$17 !== _p$.n && (_p$.n = _$setProp(_el$76, "fg", _v$17, _p$.n));
                  _v$18 !== _p$.s && (_p$.s = _$setProp(_el$78, "fg", _v$18, _p$.s));
                  _v$19 !== _p$.h && (_p$.h = _$setProp(_el$81, "fg", _v$19, _p$.h));
                  _v$20 !== _p$.r && (_p$.r = _$setProp(_el$83, "fg", _v$20, _p$.r));
                  _v$21 !== _p$.d && (_p$.d = _$setProp(_el$86, "fg", _v$21, _p$.d));
                  _v$22 !== _p$.l && (_p$.l = _$setProp(_el$88, "fg", _v$22, _p$.l));
                  _v$23 !== _p$.u && (_p$.u = _$setProp(_el$91, "fg", _v$23, _p$.u));
                  _v$24 !== _p$.c && (_p$.c = _$setProp(_el$95, "fg", _v$24, _p$.c));
                  _v$25 !== _p$.w && (_p$.w = _$setProp(_el$99, "fg", _v$25, _p$.w));
                  return _p$;
                }, {
                  e: undefined,
                  t: undefined,
                  a: undefined,
                  o: undefined,
                  i: undefined,
                  n: undefined,
                  s: undefined,
                  h: undefined,
                  r: undefined,
                  d: undefined,
                  l: undefined,
                  u: undefined,
                  c: undefined,
                  w: undefined
                });
                return _el$61;
              })();
            }
          }));
          _$insert(_el$, _$createComponent(Show, {
            get when() {
              return selectionError();
            },
            get children() {
              var _el$25 = _$createElement("box"), _el$26 = _$createElement("text"), _el$27 = _$createTextNode(`\u2716 `);
              _$insertNode(_el$25, _el$26);
              _$setProp(_el$25, "border", true);
              _$setProp(_el$25, "paddingLeft", 1);
              _$setProp(_el$25, "paddingRight", 1);
              _$insertNode(_el$26, _el$27);
              _$setProp(_el$26, "fg", "red");
              _$setProp(_el$26, "wrap", "word");
              _$insert(_el$26, selectionError, null);
              return _el$25;
            }
          }), _el$28);
          _$insertNode(_el$28, _el$29);
          _$insertNode(_el$28, _el$42);
          _$setProp(_el$28, "borderTop", true);
          _$setProp(_el$28, "paddingTop", 1);
          _$setProp(_el$28, "flexDirection", "column");
          _$insertNode(_el$29, _el$30);
          _$insertNode(_el$29, _el$32);
          _$setProp(_el$29, "flexDirection", "row");
          _$setProp(_el$29, "alignItems", "center");
          _$setProp(_el$29, "gap", 1);
          _$insertNode(_el$30, _$createTextNode(`Type to Search | Scroll | Click/Enter Select`));
          _$setProp(_el$30, "flexGrow", 1);
          _$setProp(_el$30, "flexShrink", 1);
          _$setProp(_el$30, "minWidth", 0);
          _$setProp(_el$30, "truncate", true);
          _$setProp(_el$30, "wrap", "never");
          _$insertNode(_el$32, _el$37);
          _$insertNode(_el$32, _el$40);
          _$setProp(_el$32, "flexDirection", "row");
          _$setProp(_el$32, "flexShrink", 0);
          _$setProp(_el$32, "gap", 1);
          _$insert(_el$32, _$createComponent(Show, {
            get when() {
              return isApplying();
            },
            get children() {
              var _el$33 = _$createElement("text");
              _$insertNode(_el$33, _$createTextNode(`Switching model...`));
              _$setProp(_el$33, "bold", true);
              _$setProp(_el$33, "flexShrink", 0);
              _$setProp(_el$33, "fg", "yellow");
              _$setProp(_el$33, "wrap", "never");
              return _el$33;
            }
          }), _el$37);
          _$insert(_el$32, _$createComponent(Show, {
            get when() {
              return isRefreshing();
            },
            get children() {
              var _el$35 = _$createElement("text");
              _$insertNode(_el$35, _$createTextNode(`Refreshing...`));
              _$setProp(_el$35, "bold", true);
              _$setProp(_el$35, "flexShrink", 0);
              _$setProp(_el$35, "fg", "yellow");
              _$setProp(_el$35, "wrap", "never");
              return _el$35;
            }
          }), _el$37);
          _$insertNode(_el$37, _el$38);
          _$setProp(_el$37, "flexShrink", 0);
          _$setProp(_el$37, "onMouseDown", handleForceRefresh);
          _$setProp(_el$37, "onMouseUp", handleForceRefresh);
          _$insertNode(_el$38, _$createTextNode(`[Refresh]`));
          _$setProp(_el$38, "wrap", "never");
          _$insertNode(_el$40, _el$41);
          _$setProp(_el$40, "flexShrink", 0);
          _$setProp(_el$40, "onMouseDown", toggleSortMode);
          _$setProp(_el$40, "onMouseUp", toggleSortMode);
          _$setProp(_el$41, "bold", true);
          _$setProp(_el$41, "wrap", "never");
          _$insert(_el$41, () => sortMode() === "name" ? "[Sort: Name]" : "[Sort: Price \u2191]");
          _$insertNode(_el$42, _$createTextNode(`Ctrl+F Favorite | Ctrl+R Refresh | Ctrl+S Sort`));
          _$setProp(_el$42, "wrap", "never");
          _$effect((_p$) => {
            var _v$ = theme().text?.base || "white", _v$2 = theme().text?.muted || "gray", _v$3 = theme().text?.muted || "gray", _v$4 = theme().text?.selected || "cyan", _v$5 = theme().text?.muted || "gray", _v$6 = theme().text?.muted || "gray", _v$7 = theme().text?.selected || "cyan", _v$8 = theme().text?.muted || "gray";
            _v$ !== _p$.e && (_p$.e = _$setProp(_el$3, "fg", _v$, _p$.e));
            _v$2 !== _p$.t && (_p$.t = _$setProp(_el$6, "fg", _v$2, _p$.t));
            _v$3 !== _p$.a && (_p$.a = _$setProp(_el$1, "fg", _v$3, _p$.a));
            _v$4 !== _p$.o && (_p$.o = _$setProp(_el$12, "fg", _v$4, _p$.o));
            _v$5 !== _p$.i && (_p$.i = _$setProp(_el$30, "fg", _v$5, _p$.i));
            _v$6 !== _p$.n && (_p$.n = _$setProp(_el$38, "fg", _v$6, _p$.n));
            _v$7 !== _p$.s && (_p$.s = _$setProp(_el$41, "fg", _v$7, _p$.s));
            _v$8 !== _p$.h && (_p$.h = _$setProp(_el$42, "fg", _v$8, _p$.h));
            return _p$;
          }, {
            e: undefined,
            t: undefined,
            a: undefined,
            o: undefined,
            i: undefined,
            n: undefined,
            s: undefined,
            h: undefined
          });
          return _el$;
        })();
      });
    }
  }
});
export {
  tui_default as default
};

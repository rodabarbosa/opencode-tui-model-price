// @bun
// src/index.ts
import { Plugin } from "@opencode/plugin";

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

// src/index.ts
var src_default = Plugin.define({
  id: "model-pricing",
  async setup(ctx) {
    let memoryMatrix = {};
    const getTodayString = () => new Date().toISOString().slice(0, 10);
    async function syncPrices(force = false) {
      const today = getTodayString();
      const lastSync = await ctx.storage.get("last_sync");
      if (!force && lastSync === today) {
        const stored = await ctx.storage.get("pricing_matrix");
        if (stored && Object.keys(stored).length > 0) {
          memoryMatrix = stored;
          return memoryMatrix;
        }
      }
      console.log(`[model-pricing] ${force ? "Forcing" : "First access today:"} syncing model prices...`);
      const externalPricing = await fetchExternalPricing();
      let opencodeModels = [];
      try {
        const res = await ctx.model.list();
        opencodeModels = Array.isArray(res) ? res : res?.data ?? [];
      } catch {}
      memoryMatrix = buildPricingMatrixFromOpenCode(opencodeModels, externalPricing);
      await ctx.storage.set("pricing_matrix", memoryMatrix);
      await ctx.storage.set("last_sync", today);
      await ctx.storage.set("last_sync_timestamp", new Date().toISOString());
      try {
        await ctx.model.reload();
      } catch {}
      return memoryMatrix;
    }
    await syncPrices(false);
    const rpcRegistration = await ctx.rpc.register(ModelPricingRpc, {
      getPrices: async () => {
        if (Object.keys(memoryMatrix).length === 0) {
          const stored = await ctx.storage.get("pricing_matrix");
          if (stored)
            memoryMatrix = stored;
        }
        return memoryMatrix;
      },
      forceRefresh: async () => {
        const matrix = await syncPrices(true);
        await rpcRegistration.events.emit("updated", matrix);
        return {
          success: true,
          count: Object.keys(matrix).length,
          timestamp: new Date().toISOString()
        };
      }
    });
    await ctx.model.transform((editor) => {
      editor.list().forEach((model) => {
        const key = model.id.toLowerCase();
        const shortKey = (model.modelID || model.id.split("/")[1] || model.id).toLowerCase();
        const price = memoryMatrix[key] || memoryMatrix[shortKey] || memoryMatrix[model.id];
        if (price && (!model.cost || model.cost.length === 0)) {
          model.cost = [
            {
              input: price.inputPerMillion,
              output: price.outputPerMillion,
              cache: {
                read: price.cacheReadPerMillion,
                write: price.cacheWritePerMillion
              }
            }
          ];
        }
      });
    });
    console.log("[model-pricing] Model pricing plugin initialized.");
  }
});
export {
  src_default as default
};

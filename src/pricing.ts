import type { ModelPriceDetail, PricingMatrix } from "./rpc.js";

const MODELS_DEV_URL = "https://models.dev/api.json";

interface ModelsDevModel {
  id?: string;
  name?: string;
  description?: string;
  limit?: { context?: number; output?: number };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
  };
}

interface ModelsDevProvider {
  models?: Record<string, ModelsDevModel>;
  [key: string]: unknown;
}

export async function fetchExternalPricing(): Promise<PricingMatrix> {
  const result: PricingMatrix = {};
  try {
    const res = await fetch(MODELS_DEV_URL);
    if (!res.ok) {
      console.warn(`[model-pricing] Failed to fetch from ${MODELS_DEV_URL}: HTTP ${res.status}`);
      return result;
    }
    const data = (await res.json()) as Record<string, ModelsDevProvider>;
    const now = new Date().toISOString();

    for (const [providerId, providerData] of Object.entries(data)) {
      if (!providerData || typeof providerData !== "object") continue;
      const modelsMap = providerData.models;
      if (!modelsMap || typeof modelsMap !== "object") continue;

      for (const [rawModelId, modelInfo] of Object.entries(modelsMap)) {
        if (!modelInfo || typeof modelInfo !== "object") continue;
        const cost = modelInfo.cost;
        if (!cost) continue;

        const detail: ModelPriceDetail = {
          name: modelInfo.name || rawModelId,
          providerID: providerId,
          inputPerMillion: cost.input ?? 0,
          outputPerMillion: cost.output ?? 0,
          cacheReadPerMillion: cost.cache_read ?? 0,
          cacheWritePerMillion: cost.cache_write ?? 0,
          contextLimit: modelInfo.limit?.context,
          outputLimit: modelInfo.limit?.output,
          source: "models.dev",
          updatedAt: now,
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

export function buildPricingMatrixFromOpenCode(
  opencodeModels: any,
  externalPricing: PricingMatrix = {}
): PricingMatrix {
  const matrix: PricingMatrix = { ...externalPricing };
  const now = new Date().toISOString();

  const list = Array.isArray(opencodeModels)
    ? opencodeModels
    : Array.isArray(opencodeModels?.data)
    ? opencodeModels.data
    : [];

  for (const m of list) {
    const fullId = (m.id || "").toLowerCase();
    const shortId = (m.modelID || fullId.split("/")[1] || fullId).toLowerCase();

    let nativeCost: ModelPriceDetail | undefined;
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
        updatedAt: now,
      };
    }

    const external = matrix[fullId] || matrix[shortId];

    const effective: ModelPriceDetail = {
      name: m.name || external?.name || m.id,
      providerID: m.providerID || external?.providerID,
      inputPerMillion: nativeCost?.inputPerMillion ?? external?.inputPerMillion ?? 0,
      outputPerMillion: nativeCost?.outputPerMillion ?? external?.outputPerMillion ?? 0,
      cacheReadPerMillion: nativeCost?.cacheReadPerMillion ?? external?.cacheReadPerMillion ?? 0,
      cacheWritePerMillion: nativeCost?.cacheWritePerMillion ?? external?.cacheWritePerMillion ?? 0,
      contextLimit: m.limit?.context ?? external?.contextLimit,
      outputLimit: m.limit?.output ?? external?.outputLimit,
      source: nativeCost ? "opencode" : (external?.source ?? "estimated"),
      updatedAt: now,
    };

    matrix[fullId] = effective;
    matrix[shortId] = effective;
    if (m.id) matrix[m.id] = effective;
  }

  return matrix;
}

export function formatUSD(amount: number | undefined): string {
  if (amount === undefined || isNaN(amount)) return "N/D";
  if (amount === 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 0.1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

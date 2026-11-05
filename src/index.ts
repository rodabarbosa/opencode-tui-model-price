import { Plugin } from "@opencode/plugin";
import { ModelPricingRpc, type PricingMatrix } from "./rpc.js";
import {
  fetchExternalPricing,
  buildPricingMatrixFromOpenCode,
} from "./pricing.js";

export default Plugin.define({
  id: "model-pricing",
  async setup(ctx) {
    let memoryMatrix: PricingMatrix = {};

    const getTodayString = () => new Date().toISOString().slice(0, 10);

    async function syncPrices(force = false): Promise<PricingMatrix> {
      const today = getTodayString();
      const lastSync = (await ctx.storage.get("last_sync")) as string | undefined;

      if (!force && lastSync === today) {
        const stored = (await ctx.storage.get("pricing_matrix")) as PricingMatrix | undefined;
        if (stored && Object.keys(stored).length > 0) {
          memoryMatrix = stored;
          return memoryMatrix;
        }
      }

      console.log(`[model-pricing] ${force ? "Forcing" : "First access today:"} syncing model prices...`);

      const externalPricing = await fetchExternalPricing();

      let opencodeModels: any[] = [];
      try {
        const res = (await ctx.model.list()) as any;
        opencodeModels = Array.isArray(res) ? res : (res?.data ?? []);
      } catch {
        // Fallback silencioso
      }

      memoryMatrix = buildPricingMatrixFromOpenCode(opencodeModels, externalPricing);

      await ctx.storage.set("pricing_matrix", memoryMatrix);
      await ctx.storage.set("last_sync", today);
      await ctx.storage.set("last_sync_timestamp", new Date().toISOString());

      try {
        await ctx.model.reload();
      } catch {
        // Ignore when no models changed
      }

      return memoryMatrix;
    }

    // 1. Daily sync on first access
    await syncPrices(false);

    // 2. Registra o RPC
    const rpcRegistration = await ctx.rpc.register(ModelPricingRpc, {
      getPrices: async () => {
        if (Object.keys(memoryMatrix).length === 0) {
          const stored = (await ctx.storage.get("pricing_matrix")) as PricingMatrix | undefined;
          if (stored) memoryMatrix = stored;
        }
        return memoryMatrix;
      },
      forceRefresh: async () => {
        const matrix = await syncPrices(true);
        await rpcRegistration.events.emit("updated", matrix);
        return {
          success: true,
          count: Object.keys(matrix).length,
          timestamp: new Date().toISOString(),
        };
      },
    });

    // 3. Inject native costs without modifying original model display names
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
                write: price.cacheWritePerMillion,
              },
            },
          ];
        }
      });
    });

    console.log("[model-pricing] Model pricing plugin initialized.");
  },
});

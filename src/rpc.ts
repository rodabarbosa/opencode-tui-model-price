export interface ModelPriceDetail {
  name?: string;
  providerID?: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
  contextLimit?: number;
  outputLimit?: number;
  source?: string;
  updatedAt?: string;
}

export type PricingMatrix = Record<string, ModelPriceDetail>;

function stdSchema(validator?: (val: any) => string | null) {
  return {
    "~standard": {
      version: 1,
      vendor: "model-pricing",
      validate: (value: any) => {
        const issue = validator ? validator(value) : null;
        return issue ? { issues: [{ message: issue }] } : { value };
      },
    },
  };
}

/** Validates the `{ providerID, modelID }` input of `setNextModel`. */
function requireModelRef(value: any): string | null {
  if (!value || typeof value !== "object") return "Expected a model reference.";
  if (typeof value.providerID !== "string" || value.providerID.trim().length === 0) {
    return "providerID is required.";
  }
  if (typeof value.modelID !== "string" || value.modelID.trim().length === 0) {
    return "modelID is required.";
  }
  return null;
}

export const ModelPricingRpc = {
  id: "model-pricing",
  events: {
    updated: {
      schema: stdSchema(),
    },
  },
  methods: {
    getPrices: {
      input: stdSchema(),
      output: stdSchema(),
    },
    forceRefresh: {
      input: stdSchema(),
      output: stdSchema(),
    },
    /** Model applied to the first prompt of the next new session. */
    getNextModel: {
      input: stdSchema(),
      output: stdSchema(),
    },
    setNextModel: {
      input: stdSchema(requireModelRef),
      output: stdSchema(),
      errors: {
        unavailable: stdSchema(),
      },
    },
    clearNextModel: {
      input: stdSchema(),
      output: stdSchema(),
    },
  },
};

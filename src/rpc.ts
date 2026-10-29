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
  },
};

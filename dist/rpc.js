// @bun
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
export {
  ModelPricingRpc
};

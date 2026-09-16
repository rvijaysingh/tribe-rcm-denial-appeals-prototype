import { afterEach, describe, expect, it } from "vitest";
import { MODELS, SAMPLING_MODELS, costOf, modelSet, temperatureFor } from "../../src/lib/models";

const originalTemperature = process.env.LLM_TEMPERATURE;

afterEach(() => {
  if (originalTemperature === undefined) delete process.env.LLM_TEMPERATURE;
  else process.env.LLM_TEMPERATURE = originalTemperature;
});

describe("temperatureFor", () => {
  it("returns undefined for the models that removed sampling", () => {
    // Sending temperature to these returns 400 "`temperature` is deprecated
    // for this model", verified against the live API.
    expect(temperatureFor("claude-sonnet-5")).toBeUndefined();
    expect(temperatureFor("claude-opus-5")).toBeUndefined();
  });

  it("defaults to 0 on a model that still accepts sampling", () => {
    delete process.env.LLM_TEMPERATURE;
    expect(temperatureFor("claude-sonnet-4-6")).toBe(0);
  });

  it("reads LLM_TEMPERATURE when the model accepts sampling", () => {
    process.env.LLM_TEMPERATURE = "0.7";
    expect(temperatureFor("claude-sonnet-4-6")).toBe(0.7);
  });

  it("still returns undefined for a Claude 5 model even when the env var is set", () => {
    process.env.LLM_TEMPERATURE = "0.7";
    expect(temperatureFor("claude-sonnet-5")).toBeUndefined();
  });

  it("treats an empty value as unset", () => {
    process.env.LLM_TEMPERATURE = "   ";
    expect(temperatureFor("claude-haiku-4-5")).toBe(0);
  });

  it.each(["abc", "-0.5", "1.5"])("throws on LLM_TEMPERATURE=%s", (value) => {
    process.env.LLM_TEMPERATURE = value;
    expect(() => temperatureFor("claude-sonnet-4-6")).toThrow(/LLM_TEMPERATURE must be a number from 0 to 1/);
  });

  it("does not throw for an invalid value on a model that ignores it", () => {
    process.env.LLM_TEMPERATURE = "abc";
    expect(temperatureFor("claude-sonnet-5")).toBeUndefined();
  });

  it("keeps every pipeline model outside the sampling set", () => {
    for (const model of Object.values(MODELS)) {
      expect(SAMPLING_MODELS.has(model), model).toBe(false);
    }
  });
});

describe("costOf", () => {
  it("prices input and output separately", () => {
    expect(costOf("claude-sonnet-5", 1_000_000, 0)).toBeCloseTo(2);
    expect(costOf("claude-sonnet-5", 0, 1_000_000)).toBeCloseTo(10);
  });

  it("throws on an unpriced model rather than reporting zero", () => {
    expect(() => costOf("claude-not-a-model", 100, 100)).toThrow(/No price entry/);
  });
});

describe("modelSet", () => {
  it("names all three stage models so runs can be compared", () => {
    const set = modelSet();
    expect(set).toContain(`classify=${MODELS.classify}`);
    expect(set).toContain(`draft=${MODELS.draft}`);
    expect(set).toContain(`verify=${MODELS.verify}`);
  });
});

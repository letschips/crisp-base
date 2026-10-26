import { describe, expect, it } from "vitest";
import { normalizePluginData, withLicense, withOptionColors, withoutLicense } from "../src/plugin-data";

describe("plugin data merges instead of overwriting", () => {
  const colors = { status: { 进行中: "orange" as const } };

  it("activating keeps option colors", () => {
    const next = withLicense({ optionColors: colors }, "code.sig", 1);
    expect(next).toEqual({ optionColors: colors, licenseCode: "code.sig", activatedAt: 1 });
  });

  it("clearing the license keeps option colors", () => {
    expect(withoutLicense({ licenseCode: "c", activatedAt: 1, optionColors: colors })).toEqual({ optionColors: colors });
  });

  it("saving colors keeps the license", () => {
    expect(withOptionColors({ licenseCode: "c", activatedAt: 1 }, colors)).toEqual({
      licenseCode: "c",
      activatedAt: 1,
      optionColors: colors,
    });
  });

  it("normalizes missing or malformed data and keeps unknown keys", () => {
    expect(normalizePluginData(null)).toEqual({});
    expect(normalizePluginData(undefined)).toEqual({});
    expect(normalizePluginData({ licenseCode: 5, optionColors: { s: { a: "nope" } }, future: 1 })).toEqual({ future: 1 });
  });
});

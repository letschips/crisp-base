import { describe, expect, it } from "vitest";
import { colorCssVar, optionColor, sanitizeColorMap, setOptionColor } from "../src/option-colors";

describe("option colors", () => {
  it("stores colors per property name, shared across bases", () => {
    let map = setOptionColor({}, "status", "进行中", "orange");
    map = setOptionColor(map, "status", "完成", "green");
    expect(optionColor(map, "status", "进行中")).toBe("orange");
    expect(optionColor(map, "stage", "进行中")).toBeNull();
  });

  it("clearing a color removes the entry and drops empty properties", () => {
    const map = setOptionColor(setOptionColor({}, "status", "a", "red"), "status", "a", null);
    expect(map).toEqual({});
  });

  it("does not mutate the previous map", () => {
    const before = setOptionColor({}, "status", "a", "red");
    setOptionColor(before, "status", "b", "blue");
    expect(before).toEqual({ status: { a: "red" } });
  });

  it("drops invalid entries from a hand-edited or corrupted data.json", () => {
    expect(sanitizeColorMap({ status: { a: "red", b: "#ff0000", c: 3 }, bad: "x", empty: {} })).toEqual({
      status: { a: "red" },
    });
    expect(sanitizeColorMap(null)).toEqual({});
    expect(sanitizeColorMap([])).toEqual({});
  });

  it("maps colors to theme variables so dark mode adapts", () => {
    expect(colorCssVar("red")).toBe("var(--color-red)");
    expect(colorCssVar("gray")).toMatch(/^var\(/);
  });
});

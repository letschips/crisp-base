import { describe, expect, it } from "vitest";
import {
  fromDateInput,
  isValueCompatible,
  kindFromWidget,
  normalizeListItems,
  parseNumberInput,
  resolvePropertyKind,
  toDateInput,
} from "../src/property-types";

function appWithTypes(types: Record<string, string>) {
  return {
    metadataTypeManager: {
      getTypeInfo: (name: string) => (types[name] ? { expected: { type: types[name] } } : { expected: null }),
    },
  };
}

describe("property kinds", () => {
  it("prefers the vault's assigned property type over the value's shape", () => {
    const app = appWithTypes({ due: "date", tags: "tags", aliases: "aliases", score: "number" });
    expect(resolvePropertyKind(app, "due", "2026-10-26")).toBe("date");
    expect(resolvePropertyKind(app, "tags", ["a"])).toBe("tags");
    expect(resolvePropertyKind(app, "aliases", ["a"])).toBe("list");
    expect(resolvePropertyKind(app, "score", 3)).toBe("number");
  });

  it("falls back to the value's shape when the private type API is missing or throws", () => {
    expect(resolvePropertyKind({}, "done", true)).toBe("checkbox");
    expect(resolvePropertyKind({}, "n", 2)).toBe("number");
    expect(resolvePropertyKind({}, "l", ["x"])).toBe("list");
    expect(resolvePropertyKind({}, "s", "x")).toBe("text");
    const throwing = { metadataTypeManager: { getTypeInfo: () => { throw new Error("changed API"); } } };
    expect(resolvePropertyKind(throwing, "done", false)).toBe("checkbox");
  });

  it("maps every Obsidian widget, and unknown widgets to null", () => {
    expect(kindFromWidget("text")).toBe("text");
    expect(kindFromWidget("file")).toBe("text");
    expect(kindFromWidget("multitext")).toBe("list");
    expect(kindFromWidget("datetime")).toBe("datetime");
    expect(kindFromWidget("checkbox")).toBe("checkbox");
    expect(kindFromWidget("some-plugin-widget")).toBeNull();
    expect(kindFromWidget(undefined)).toBeNull();
  });
});

describe("value compatibility never coerces", () => {
  it("flags values that do not fit the declared type", () => {
    expect(isValueCompatible("date", "下周")).toBe(false);
    expect(isValueCompatible("date", "2026-10-26")).toBe(true);
    expect(isValueCompatible("datetime", "2026-10-26T09:30")).toBe(true);
    expect(isValueCompatible("datetime", "2026-10-26")).toBe(false);
    expect(isValueCompatible("number", "12")).toBe(false);
    expect(isValueCompatible("checkbox", "true")).toBe(false);
    expect(isValueCompatible("list", [{ nested: 1 }])).toBe(false);
    expect(isValueCompatible("text", ["a"])).toBe(false);
  });

  it("treats empty values as compatible with any type", () => {
    for (const kind of ["text", "number", "checkbox", "date", "datetime", "list", "tags"] as const) {
      expect(isValueCompatible(kind, null)).toBe(true);
      expect(isValueCompatible(kind, undefined)).toBe(true);
    }
  });
});

describe("input conversion", () => {
  it("writes dates in the format Obsidian itself writes, and clears on empty", () => {
    expect(fromDateInput("date", "2026-10-26")).toBe("2026-10-26");
    expect(fromDateInput("datetime", "2026-10-26T09:30")).toBe("2026-10-26T09:30");
    expect(fromDateInput("datetime", "2026-10-26T09:30:15")).toBe("2026-10-26T09:30");
    expect(fromDateInput("date", "")).toBeNull();
    expect(toDateInput("datetime", "2026-10-26T09:30:15")).toBe("2026-10-26T09:30");
    expect(toDateInput("date", null)).toBe("");
  });

  it("normalizes list items: trims, drops empties and duplicates, strips # only for tags", () => {
    expect(normalizeListItems("list", [" a ", "", "a", "#b"])).toEqual(["a", "#b"]);
    expect(normalizeListItems("tags", ["#work", "work", " #home "])).toEqual(["work", "home"]);
    expect(normalizeListItems("list", ["", " "])).toBeNull();
  });

  it("rejects invalid numbers instead of writing them", () => {
    expect(parseNumberInput("12.5")).toBe(12.5);
    expect(parseNumberInput("  ")).toBeNull();
    expect(parseNumberInput("abc")).toBeUndefined();
  });
});

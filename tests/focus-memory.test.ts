import { describe, expect, it } from "vitest";
import { FocusMemory } from "../src/focus-memory";

describe("inspector focus memory across re-renders", () => {
  it("keeps the field and its uncommitted text when a re-render removes the input", () => {
    const memory = new FocusMemory();
    const token = memory.focusIn("priority", "高");
    memory.input("priority", "高优先", 3, 3);
    memory.focusOut(token, { inputConnected: false, focusInInspector: false });
    expect(memory.restore()).toEqual({ key: "priority", value: "高优先", dirty: true, start: 3, end: 3 });
  });

  it("forgets the field once the user leaves the inspector, so later re-renders do not steal focus", () => {
    const memory = new FocusMemory();
    const token = memory.focusIn("tags", "");
    memory.focusOut(token, { inputConnected: true, focusInInspector: false });
    expect(memory.restore()).toBeNull();
  });

  it("follows the user to another field instead of jumping back", () => {
    const memory = new FocusMemory();
    const tagsToken = memory.focusIn("tags", "");
    memory.focusIn("estimate", "3");
    memory.focusOut(tagsToken, { inputConnected: true, focusInInspector: true });
    expect(memory.restore()?.key).toBe("estimate");
  });

  it("re-focusing the restored input keeps its pending text", () => {
    const memory = new FocusMemory();
    memory.focusIn("priority", "高");
    memory.input("priority", "高优先", 3, 3);
    memory.focusIn("priority", "高");
    expect(memory.restore()?.value).toBe("高优先");
  });

  it("a committed value is no longer pending, and a cleared list input stays focused", () => {
    const memory = new FocusMemory();
    memory.focusIn("tags", "");
    memory.input("tags", "alpha", 5, 5);
    memory.committed("tags", "");
    expect(memory.restore()).toEqual({ key: "tags", value: "", dirty: false, start: null, end: null });
  });
});

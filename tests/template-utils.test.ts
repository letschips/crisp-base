import { describe, expect, it } from "vitest";
import { mergeTemplateFrontmatter, parseTemplatePath, stripFrontmatter } from "../src/template-utils";

describe("templates", () => {
  it("only fills keys the new note does not have, so the column value wins", () => {
    const target: Record<string, unknown> = { status: "进行中" };
    mergeTemplateFrontmatter(target, { status: "待办", tags: ["a"], priority: 2 });
    expect(target).toEqual({ status: "进行中", tags: ["a"], priority: 2 });
  });

  it("fills keys Bases pre-created with empty values", () => {
    const target: Record<string, unknown> = { priority: null, due: null, tags: [], note: "", status: "待办" };
    mergeTemplateFrontmatter(target, { priority: "中", tags: ["inbox"], note: "x", status: "进行中" });
    expect(target).toEqual({ priority: "中", due: null, tags: ["inbox"], note: "x", status: "待办" });
  });

  it("keeps false and 0, which are real values", () => {
    const target: Record<string, unknown> = { done: false, estimate: 0 };
    mergeTemplateFrontmatter(target, { done: true, estimate: 3 });
    expect(target).toEqual({ done: false, estimate: 0 });
  });

  it("copies arrays and objects so later edits do not leak back into the template cache", () => {
    const template = { tags: ["a"] };
    const target: Record<string, unknown> = {};
    mergeTemplateFrontmatter(target, template);
    (target.tags as string[]).push("b");
    expect(template.tags).toEqual(["a"]);
  });

  it("ignores a missing template", () => {
    const target: Record<string, unknown> = { a: 1 };
    mergeTemplateFrontmatter(target, undefined);
    expect(target).toEqual({ a: 1 });
  });

  it("strips frontmatter from template content", () => {
    expect(stripFrontmatter("---\na: 1\n---\n# Body\n")).toBe("# Body\n");
    expect(stripFrontmatter("---\r\na: 1\r\n---\r\nBody")).toBe("Body");
    expect(stripFrontmatter("# No frontmatter")).toBe("# No frontmatter");
    expect(stripFrontmatter("---\nunterminated")).toBe("---\nunterminated");
  });

  it("accepts a path or a wikilink as the configured template", () => {
    expect(parseTemplatePath("Templates/任务.md")).toBe("Templates/任务.md");
    expect(parseTemplatePath("[[Templates/任务]]")).toBe("Templates/任务");
    expect(parseTemplatePath("[[任务|别名]]")).toBe("任务");
    expect(parseTemplatePath("  ")).toBeNull();
    expect(parseTemplatePath(3)).toBeNull();
  });
});

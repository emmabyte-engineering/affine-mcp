import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown } from "../../src/markdown/parse.js";

describe("parseMarkdown", () => {
  it("parses headings at all levels", () => {
    const result = parseMarkdown("# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6");
    assert.equal(result.length, 6);
    for (let i = 0; i < 6; i++) {
      assert.equal(result[i].type, "heading");
      assert.equal(result[i].level, i + 1);
      assert.equal(result[i].text, `H${i + 1}`);
    }
  });

  it("parses paragraphs", () => {
    const result = parseMarkdown("Hello world\n\nSecond paragraph");
    assert.equal(result.length, 2);
    assert.equal(result[0].type, "paragraph");
    assert.equal(result[0].text, "Hello world");
    assert.equal(result[1].type, "paragraph");
    assert.equal(result[1].text, "Second paragraph");
  });

  it("parses bulleted lists", () => {
    const result = parseMarkdown("- Item one\n- Item two\n- Item three");
    assert.equal(result.length, 3);
    for (const block of result) {
      assert.equal(block.type, "bulleted_list");
    }
    assert.equal(result[0].text, "Item one");
    assert.equal(result[2].text, "Item three");
  });

  it("parses numbered lists", () => {
    const result = parseMarkdown("1. First\n2. Second\n3. Third");
    assert.equal(result.length, 3);
    for (const block of result) {
      assert.equal(block.type, "numbered_list");
    }
    assert.equal(result[0].text, "First");
  });

  it("parses todo lists", () => {
    const result = parseMarkdown("- [ ] Unchecked\n- [x] Checked");
    assert.equal(result.length, 2);
    assert.equal(result[0].type, "todo_list");
    assert.equal(result[0].text, "Unchecked");
    assert.equal(result[0].checked, false);
    assert.equal(result[1].type, "todo_list");
    assert.equal(result[1].text, "Checked");
    assert.equal(result[1].checked, true);
  });

  it("parses fenced code blocks with language", () => {
    const result = parseMarkdown("```javascript\nconsole.log('hi');\n```");
    assert.equal(result.length, 1);
    assert.equal(result[0].type, "code");
    assert.equal(result[0].language, "javascript");
    assert.equal(result[0].text, "console.log('hi');");
  });

  it("parses fenced code blocks without language", () => {
    const result = parseMarkdown("```\nsome code\n```");
    assert.equal(result.length, 1);
    assert.equal(result[0].type, "code");
    assert.equal(result[0].text, "some code");
  });

  it("parses blockquotes", () => {
    const result = parseMarkdown("> A quote");
    assert.equal(result.length, 1);
    assert.equal(result[0].type, "quote");
    assert.equal(result[0].text, "A quote");
  });

  it("parses horizontal rules as dividers", () => {
    const result = parseMarkdown("---");
    assert.equal(result.length, 1);
    assert.equal(result[0].type, "divider");
  });

  it("parses mixed content", () => {
    const md = `# Title

Some text

- Bullet

1. Number

> Quote

---

\`\`\`python
print("hello")
\`\`\``;
    const result = parseMarkdown(md);
    const types = result.map((b) => b.type);
    assert.deepEqual(types, [
      "heading",
      "paragraph",
      "bulleted_list",
      "numbered_list",
      "quote",
      "divider",
      "code",
    ]);
  });

  it("returns empty array for empty input", () => {
    const result = parseMarkdown("");
    assert.equal(result.length, 0);
  });
});

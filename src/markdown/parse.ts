import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

const md = new MarkdownIt();

export interface MarkdownBlock {
  type:
    | "paragraph"
    | "heading"
    | "quote"
    | "bulleted_list"
    | "numbered_list"
    | "todo_list"
    | "code"
    | "divider";
  text: string;
  level?: number; // heading level 1-6
  language?: string; // code block language
  checked?: boolean; // todo item
}

export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const tokens = md.parse(markdown, {});
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === "heading_open") {
      const level = parseInt(token.tag.slice(1), 10);
      const inline = tokens[i + 1];
      blocks.push({
        type: "heading",
        text: inline?.content || "",
        level,
      });
      i += 3; // heading_open, inline, heading_close
      continue;
    }

    if (token.type === "paragraph_open") {
      const inline = tokens[i + 1];
      const text = inline?.content || "";

      // Check for todo items: "- [ ] text" or "- [x] text"
      // markdown-it parses these as paragraphs
      const todoMatch = text.match(/^\[([xX ])\]\s*(.*)/);
      if (todoMatch) {
        blocks.push({
          type: "todo_list",
          text: todoMatch[2],
          checked: todoMatch[1].toLowerCase() === "x",
        });
      } else {
        blocks.push({ type: "paragraph", text });
      }
      i += 3; // paragraph_open, inline, paragraph_close
      continue;
    }

    if (token.type === "blockquote_open") {
      const content = collectBlockquoteContent(tokens, i);
      blocks.push({ type: "quote", text: content.text });
      i = content.endIndex;
      continue;
    }

    if (token.type === "bullet_list_open") {
      const items = collectListItems(tokens, i, "bullet_list_close");
      for (const item of items.items) {
        // Check for todo syntax
        const todoMatch = item.match(/^\[([xX ])\]\s*(.*)/s);
        if (todoMatch) {
          blocks.push({
            type: "todo_list",
            text: todoMatch[2],
            checked: todoMatch[1].toLowerCase() === "x",
          });
        } else {
          blocks.push({ type: "bulleted_list", text: item });
        }
      }
      i = items.endIndex;
      continue;
    }

    if (token.type === "ordered_list_open") {
      const items = collectListItems(tokens, i, "ordered_list_close");
      for (const item of items.items) {
        blocks.push({ type: "numbered_list", text: item });
      }
      i = items.endIndex;
      continue;
    }

    if (token.type === "fence") {
      blocks.push({
        type: "code",
        text: token.content.replace(/\n$/, ""),
        language: token.info || undefined,
      });
      i++;
      continue;
    }

    if (token.type === "code_block") {
      blocks.push({
        type: "code",
        text: token.content.replace(/\n$/, ""),
      });
      i++;
      continue;
    }

    if (token.type === "hr") {
      blocks.push({ type: "divider", text: "" });
      i++;
      continue;
    }

    i++;
  }

  return blocks;
}

function collectBlockquoteContent(
  tokens: Token[],
  startIndex: number
): { text: string; endIndex: number } {
  let depth = 1;
  let i = startIndex + 1;
  const texts: string[] = [];

  while (i < tokens.length && depth > 0) {
    if (tokens[i].type === "blockquote_open") depth++;
    if (tokens[i].type === "blockquote_close") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
    if (tokens[i].type === "inline") {
      texts.push(tokens[i].content);
    }
    i++;
  }

  return { text: texts.join("\n"), endIndex: i };
}

function collectListItems(
  tokens: Token[],
  startIndex: number,
  closeType: string
): { items: string[]; endIndex: number } {
  let i = startIndex + 1;
  const items: string[] = [];

  while (i < tokens.length && tokens[i].type !== closeType) {
    if (tokens[i].type === "list_item_open") {
      i++;
      const texts: string[] = [];
      while (i < tokens.length && tokens[i].type !== "list_item_close") {
        if (tokens[i].type === "inline") {
          texts.push(tokens[i].content);
        }
        i++;
      }
      items.push(texts.join("\n"));
      i++; // skip list_item_close
    } else {
      i++;
    }
  }

  return { items, endIndex: i + 1 }; // skip the close token
}

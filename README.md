# AFFiNE MCP Server

An open-source [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that connects AI assistants to your **self-hosted [AFFiNE](https://affine.pro)** instance. Read, write, search, and manage your AFFiNE docs, tables, diagrams, and comments — all from your AI tool of choice.

## Features

| Tool | Description |
|------|-------------|
| `list_workspaces` | List all accessible workspaces |
| `get_workspace` | Get workspace details |
| `list_docs` | List documents with pagination |
| `get_doc` | Get document metadata |
| `read_doc` | Read full document content as markdown |
| `read_multiple_docs` | Bulk-read multiple documents |
| `search_docs` | Full-text search across document titles and content |
| `create_doc` | Create a new document with optional markdown content |
| `append_to_doc` | Append markdown to an existing document |
| `replace_doc_content` | Replace a document's entire content |
| `delete_doc` | Delete a document |
| `get_mermaid_diagrams` | Extract mermaid diagrams from a document |
| `insert_mermaid_diagram` | Add a new mermaid diagram |
| `update_mermaid_diagram` | Update an existing mermaid diagram |
| `get_doc_link_graph` | Map cross-document links (find orphans, broken links) |
| `get_tables` | Extract structured table data |
| `insert_table` | Add a new table |
| `update_table` | Update an existing table |
| `get_comments` | Get all comments, replies, and inline anchors |

## Prerequisites

- A **self-hosted AFFiNE** instance (this server connects via AFFiNE's WebSocket and GraphQL APIs)
- Credentials for your instance (email/password, API token, or session cookie)

> **Note:** This server is designed for self-hosted AFFiNE. It has not been tested with AFFiNE Cloud (`app.affine.pro`).

---

## Quick Start

### Option 1: npx (no install)

The fastest way to get started. No installation required — just configure your AI tool to run:

```
npx @emmabyte-eng/affine-mcp
```

### Option 2: Docker

```bash
docker build -t emmabyteeng/affine-mcp .
```

Then configure your AI tool to run:

```
docker run -i --rm -e AFFINE_BASE_URL -e AFFINE_EMAIL -e AFFINE_PASSWORD emmabyteeng/affine-mcp
```

### Option 3: Global install

```bash
npm install -g @emmabyte-eng/affine-mcp
```

Then configure your AI tool to run:

```
affine-mcp
```

### Option 4: From source

```bash
git clone https://github.com/emmabyte-engineering/affine-mcp.git
cd affine-mcp
npm install
npm run build
```

Then configure your AI tool to run:

```
node /path/to/affine-mcp/dist/index.js
```

---

## Configuration

The server is configured via environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `AFFINE_BASE_URL` | Yes | Your AFFiNE instance URL (e.g. `https://affine.example.com`) |
| `AFFINE_EMAIL` | Auth option 1 | Account email |
| `AFFINE_PASSWORD` | Auth option 1 | Account password |
| `AFFINE_API_TOKEN` | Auth option 2 | API bearer token |
| `AFFINE_COOKIE` | Auth option 3 | Session cookie string |

Choose **one** authentication method. Email/password is the simplest for most setups.

Copy `.env.example` to `.env` and fill in your values (used when running from source or for local development):

```bash
cp .env.example .env
```

---

## AI Tool Integration

MCP servers communicate over **stdio** — the AI tool launches the server as a subprocess and exchanges JSON messages over stdin/stdout. Each tool below has its own config file where you register MCP servers.

### Claude Desktop

Edit your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

<details>
<summary><strong>Using npx</strong></summary>

```json
{
  "mcpServers": {
    "affine": {
      "command": "npx",
      "args": ["@emmabyte-eng/affine-mcp"],
      "env": {
        "AFFINE_BASE_URL": "https://affine.example.com",
        "AFFINE_EMAIL": "you@example.com",
        "AFFINE_PASSWORD": "your-password"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Using Docker</strong></summary>

```json
{
  "mcpServers": {
    "affine": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "AFFINE_BASE_URL",
        "-e", "AFFINE_EMAIL",
        "-e", "AFFINE_PASSWORD",
        "emmabyteeng/affine-mcp"
      ],
      "env": {
        "AFFINE_BASE_URL": "https://affine.example.com",
        "AFFINE_EMAIL": "you@example.com",
        "AFFINE_PASSWORD": "your-password"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Using global install</strong></summary>

```json
{
  "mcpServers": {
    "affine": {
      "command": "@emmabyte-eng/affine-mcp",
      "env": {
        "AFFINE_BASE_URL": "https://affine.example.com",
        "AFFINE_EMAIL": "you@example.com",
        "AFFINE_PASSWORD": "your-password"
      }
    }
  }
}
```

</details>

### Claude Code (CLI)

Run this from your terminal:

```bash
claude mcp add affine -- npx @emmabyte-eng/affine-mcp \
  --env AFFINE_BASE_URL=https://affine.example.com \
  --env AFFINE_EMAIL=you@example.com \
  --env AFFINE_PASSWORD=your-password
```

Or add it to your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "affine": {
      "command": "npx",
      "args": ["@emmabyte-eng/affine-mcp"],
      "env": {
        "AFFINE_BASE_URL": "https://affine.example.com",
        "AFFINE_EMAIL": "you@example.com",
        "AFFINE_PASSWORD": "your-password"
      }
    }
  }
}
```

### Cursor

Open **Cursor Settings → MCP** and add a server, or edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "affine": {
      "command": "npx",
      "args": ["@emmabyte-eng/affine-mcp"],
      "env": {
        "AFFINE_BASE_URL": "https://affine.example.com",
        "AFFINE_EMAIL": "you@example.com",
        "AFFINE_PASSWORD": "your-password"
      }
    }
  }
}
```

### Windsurf

Open **Windsurf Settings → MCP** or edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "affine": {
      "command": "npx",
      "args": ["@emmabyte-eng/affine-mcp"],
      "env": {
        "AFFINE_BASE_URL": "https://affine.example.com",
        "AFFINE_EMAIL": "you@example.com",
        "AFFINE_PASSWORD": "your-password"
      }
    }
  }
}
```

### VS Code (Copilot)

Add to your VS Code `settings.json` or `.vscode/mcp.json`:

```json
{
  "mcp": {
    "servers": {
      "affine": {
        "command": "npx",
        "args": ["@emmabyte-eng/affine-mcp"],
        "env": {
          "AFFINE_BASE_URL": "https://affine.example.com",
          "AFFINE_EMAIL": "you@example.com",
          "AFFINE_PASSWORD": "your-password"
        }
      }
    }
  }
}
```

### Zed

Add to your Zed settings (`~/.config/zed/settings.json`):

```json
{
  "context_servers": {
    "affine": {
      "command": {
        "path": "npx",
        "args": ["@emmabyte-eng/affine-mcp"],
        "env": {
          "AFFINE_BASE_URL": "https://affine.example.com",
          "AFFINE_EMAIL": "you@example.com",
          "AFFINE_PASSWORD": "your-password"
        }
      }
    }
  }
}
```

### Cline (VS Code)

Open the Cline MCP settings in VS Code, or edit `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "affine": {
      "command": "npx",
      "args": ["@emmabyte-eng/affine-mcp"],
      "env": {
        "AFFINE_BASE_URL": "https://affine.example.com",
        "AFFINE_EMAIL": "you@example.com",
        "AFFINE_PASSWORD": "your-password"
      }
    }
  }
}
```

### Roo Code (VS Code)

Edit the Roo Code MCP settings:

```json
{
  "mcpServers": {
    "affine": {
      "command": "npx",
      "args": ["@emmabyte-eng/affine-mcp"],
      "env": {
        "AFFINE_BASE_URL": "https://affine.example.com",
        "AFFINE_EMAIL": "you@example.com",
        "AFFINE_PASSWORD": "your-password"
      }
    }
  }
}
```

### Amazon Q Developer CLI

Edit `~/.aws/amazonq/mcp.json`:

```json
{
  "mcpServers": {
    "affine": {
      "command": "npx",
      "args": ["@emmabyte-eng/affine-mcp"],
      "env": {
        "AFFINE_BASE_URL": "https://affine.example.com",
        "AFFINE_EMAIL": "you@example.com",
        "AFFINE_PASSWORD": "your-password"
      }
    }
  }
}
```

### Other MCP Clients

Any MCP-compatible client that supports stdio transport can use this server. The general pattern is:

- **Command:** `npx` (or `node`, `docker`, `@emmabyte-eng/affine-mcp`)
- **Args:** `["@emmabyte-eng/affine-mcp"]` (for npx)
- **Transport:** stdio
- **Environment variables:** `AFFINE_BASE_URL`, `AFFINE_EMAIL`, `AFFINE_PASSWORD`

---

## How It Works

This server connects to your AFFiNE instance using two protocols:

1. **GraphQL API** — For listing workspaces, documents, fetching metadata, and reading comments
2. **WebSocket + Yjs** — For reading and writing document content (AFFiNE stores documents as [Yjs](https://yjs.dev) CRDTs)

Document content is synced via Yjs, then converted to/from Markdown. This gives you full read/write access to document content, including:

- Paragraphs, headings, lists, code blocks, quotes, dividers
- Tables (native AFFiNE tables, not markdown tables)
- Mermaid diagrams
- Embedded linked documents
- Images and bookmarks
- Comments and inline comment anchors

---

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Run integration tests (requires a running AFFiNE instance)
cp .env.example .env  # then fill in your credentials
npm test
```

### Project Structure

```
src/
├── index.ts            # MCP server setup and tool registration
├── config.ts           # Environment variable loading
├── auth.ts             # Authentication (email/password, token, cookie)
├── graphql.ts          # GraphQL client and queries
├── websocket.ts        # WebSocket/Yjs document sync
├── doc-operations.ts   # All document operations (read, write, search, comments, etc.)
└── markdown/
    ├── parse.ts        # Markdown → AFFiNE blocks
    └── render.ts       # AFFiNE blocks → Markdown
```

---

## Contributing

Contributions are welcome! Here are some areas where help is appreciated:

- **AFFiNE Cloud support** — Testing and adapting for `app.affine.pro`
- **Additional block types** — Better handling of databases, embeds, and other AFFiNE block types
- **Write support for comments** — Creating and resolving comments via the MCP server
- **Rich text fidelity** — Preserving bold, italic, links, and other inline formatting during markdown round-trips

To contribute:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run build` to verify the build
5. Run `npm test` against a test AFFiNE instance if possible
6. Open a pull request

---

## License

MIT

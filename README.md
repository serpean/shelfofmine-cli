# bookself

Command-line client for [Bookself](https://books.serpean.dev), a personal library for your EPUB and PDF books in Google Drive.

Use it to search your library, change reading status, read highlights and export your data from the terminal or from scripts. It also includes `bookself mcp`, a stdio bridge for AI assistants that only support local MCP servers.

It is a single file with no dependencies.

## Install

Requires Node.js 22 or later.

```bash
npm install -g bookself
```

Or run it without installing:

```bash
npx bookself --help
```

Each Bookself instance also serves the same file at `/cli/bookself.mjs`:

```bash
curl -fsSLo bookself.mjs https://books.serpean.dev/cli/bookself.mjs
node bookself.mjs --help
```

## Set up

1. In Bookself, open **Settings → Connections & AI** and create a personal token.
2. Log in:

   ```bash
   bookself login --url https://books.serpean.dev
   ```

The CLI saves the URL and token in `~/.config/bookself/config.json` (or `$XDG_CONFIG_HOME/bookself/config.json`), readable only by you. The environment variables `BOOKSELF_URL` and `BOOKSELF_TOKEN` override the saved values.

## Examples

```bash
bookself books dune                      # search
bookself reading                         # books you are reading now
bookself status 42 read                  # mark a book as read
bookself highlights --notes              # all your highlights with notes
bookself text 42 --section 3             # plain text, up to where you have read
bookself export --out library.json       # portable export of the whole library
bookself books --json | jq '.items[].title'  # raw JSON for scripts
```

Run `bookself --help` for the full list of commands.

## Use with AI assistants (MCP)

Bookself has a remote MCP server at `/mcp`. If your assistant only supports local (stdio) servers, use the bridge:

```json
{
  "mcpServers": {
    "bookself": {
      "command": "npx",
      "args": ["-y", "bookself", "mcp"],
      "env": {
        "BOOKSELF_URL": "https://books.serpean.dev",
        "BOOKSELF_TOKEN": "your-personal-token"
      }
    }
  }
}
```

## Development

```bash
pnpm install
pnpm test
pnpm build
node dist/cli.js --help
```

To release, update the version in `package.json` and push a tag `vX.Y.Z`. The release workflow publishes to npm and attaches `bookself.mjs` to the GitHub release.

## License

[MIT](LICENSE)

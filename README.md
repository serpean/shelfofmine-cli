# shelfofmine

Command-line client for [Shelf of Mine](https://www.shelfofmine.com), a personal library for your EPUB and PDF books in Google Drive.

Use it to search your library, change reading status, read highlights and export your data from the terminal or from scripts. It also includes `shelfofmine mcp`, a stdio bridge for AI assistants that only support local MCP servers.

It is a single file with no dependencies.

## Install

Requires Node.js 22 or later.

```bash
npm install -g shelfofmine
```

Or run it without installing:

```bash
npx shelfofmine --help
```

Each Shelf of Mine instance also serves the same file at `/cli/shelfofmine.mjs`:

```bash
curl -fsSLo shelfofmine.mjs https://www.shelfofmine.com/cli/shelfofmine.mjs
node shelfofmine.mjs --help
```

## Set up

1. In Shelf of Mine, open **Settings → Connections & AI** and create a personal token.
2. Log in:

   ```bash
   shelfofmine login --url https://www.shelfofmine.com
   ```

The CLI saves the URL and token in `~/.config/shelfofmine/config.json` (or `$XDG_CONFIG_HOME/shelfofmine/config.json`), readable only by you. The environment variables `SHELFOFMINE_URL` and `SHELFOFMINE_TOKEN` override the saved values.

## Examples

```bash
shelfofmine books dune                      # search
shelfofmine reading                         # books you are reading now
shelfofmine status 42 read                  # mark a book as read
shelfofmine highlights --notes              # all your highlights with notes
shelfofmine text 42 --section 3             # plain text, up to where you have read
shelfofmine export --out library.json       # portable export of the whole library
shelfofmine books --json | jq '.items[].title'  # raw JSON for scripts
```

Run `shelfofmine --help` for the full list of commands.

## Use with AI assistants (MCP)

Shelf of Mine has a remote MCP server at `/mcp`. If your assistant only supports local (stdio) servers, use the bridge:

```json
{
  "mcpServers": {
    "shelfofmine": {
      "command": "npx",
      "args": ["-y", "shelfofmine", "mcp"],
      "env": {
        "SHELFOFMINE_URL": "https://www.shelfofmine.com",
        "SHELFOFMINE_TOKEN": "your-personal-token"
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

To release, update the version in `package.json` and push a tag `vX.Y.Z`. The release workflow publishes to npm and attaches `shelfofmine.mjs` to the GitHub release.

## License

[MIT](LICENSE)

## Coming from Bookself

Shelf of Mine was called Bookself until November 2026. The `bookself` command still works, as do the variables
`BOOKSELF_URL` and `BOOKSELF_TOKEN`. If there is no configuration in `~/.config/shelfofmine/`, the CLI reads the old
one in `~/.config/bookself/`. The next `shelfofmine login` saves it in the new folder.

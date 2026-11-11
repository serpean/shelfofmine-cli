#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

/**
 * CLI de Shelf of Mine: la biblioteca desde la terminal y desde scripts, sobre la API pública con un token
 * personal (Ajustes → Conexiones e IA). `shelfofmine mcp` hace de puente stdio → MCP remoto para clientes que
 * solo admiten servidores MCP locales. Es un único fichero sin dependencias (Node 22): cada instancia lo
 * sirve en /cli/shelfofmine.mjs.
 */

// --- Configuración y cliente de la API ---------------------------------------------------------
/** Configuración del CLI: URL de la instancia y token personal. Las variables de entorno tienen prioridad. */
export interface Config {
  url: string;
  token: string;
}

function configBase(env: NodeJS.ProcessEnv): string {
  return (
    env.XDG_CONFIG_HOME ||
    (process.platform === 'win32' && env.APPDATA ? env.APPDATA : path.join(os.homedir(), '.config'))
  );
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(configBase(env), 'shelfofmine', 'config.json');
}

/** Fichero de configuración del nombre anterior (Bookself). Se lee si no hay uno nuevo. */
export function legacyConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(configBase(env), 'bookself', 'config.json');
}

async function readConfigFile(file: string): Promise<Partial<Config> | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Partial<Config>;
  } catch {
    return null;
  }
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<Partial<Config>> {
  const saved = (await readConfigFile(configPath(env))) ?? (await readConfigFile(legacyConfigPath(env))) ?? {};
  // Las variables BOOKSELF_* son del nombre anterior y siguen funcionando.
  return {
    url: env.SHELFOFMINE_URL || env.BOOKSELF_URL || saved.url,
    token: env.SHELFOFMINE_TOKEN || env.BOOKSELF_TOKEN || saved.token,
  };
}

export async function saveConfig(config: Config, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const file = configPath(env);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  // El token da acceso a la biblioteca: el fichero solo lo puede leer el usuario.
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600).catch(() => {});
  return file;
}

export async function deleteConfig(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await rm(configPath(env), { force: true });
}

/** Normaliza la URL de la instancia: sin barra final y con https:// si no se indica esquema. */
export function normalizeUrl(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withScheme);
  return url.origin + url.pathname.replace(/\/+$/, '');
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined>;

/** Cliente mínimo de la API pública (/api/v1) con token Bearer. Usa fetch de Node 22, sin dependencias. */
export class ShelfOfMineClient {
  constructor(
    readonly config: Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  url(pathname: string, query: Query = {}): string {
    const url = new URL(`${this.config.url}${pathname}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== false) url.searchParams.set(k, String(v));
    return url.toString();
  }

  async raw(method: string, pathname: string, opts: { query?: Query; json?: unknown; body?: FormData } = {}) {
    const headers: Record<string, string> = { authorization: `Bearer ${this.config.token}`, 'user-agent': 'shelfofmine-cli' };
    let body: string | FormData | undefined = opts.body;
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }
    const res = await this.fetchImpl(this.url(pathname, opts.query), { method, headers, body });
    if (!res.ok) {
      let code = 'http_error';
      let message = `${res.status} ${res.statusText}`;
      try {
        const data = (await res.json()) as { error?: { code?: string; message?: string } };
        code = data.error?.code ?? code;
        message = data.error?.message ?? message;
      } catch {
        /* respuesta sin JSON */
      }
      if (res.status === 429) message += ` (retry after ${res.headers.get('retry-after') ?? '?'}s)`;
      throw new ApiError(res.status, code, message);
    }
    return res;
  }

  async api<T>(method: string, pathname: string, opts: { query?: Query; json?: unknown; body?: FormData } = {}): Promise<T> {
    const res = await this.raw(method, `/api/v1${pathname}`, opts);
    return (await res.json()) as T;
  }

  get<T>(pathname: string, query?: Query) {
    return this.api<T>('GET', pathname, { query });
  }
}

// --- Comandos ----------------------------------------------------------------------------------

const HELP = `shelfofmine — your Shelf of Mine library from the terminal

Usage: shelfofmine <command> [options]

Setup
  login [--url URL] [--token TOKEN]   Save your instance URL and personal token
                                      (create one in Settings → Connections & AI)
  logout                              Forget the saved token
  whoami                              Show the account the token belongs to

Library
  books [TEXT] [--author A] [--series S] [--tag T] [--status to_read|reading|read|none]
        [--shelf ID] [--sort recent|title|author|series|reading] [--limit N] [--offset N]
  book ID                             Book details
  reading                             Books you are reading now
  status ID to_read|reading|read|none Set the reading status
  tag add|remove TAG ID...            Add or remove a tag
  shelves                             List shelves
  shelf create NAME                   Create a shelf
  shelf add|remove SHELF_ID ID...     Add books to a shelf or remove them
  highlights [ID] [--notes]           Highlights and notes (one book or all)

Content
  outline ID [--spoilers]             Sections of an EPUB and how much is readable
  text ID [--section N] [--all] [--spoilers]
                                      Plain text, up to where you have read
  download ID [--out DIR]             Download the book file
  upload FILE...                      Upload EPUB/PDF files to your Drive library
  export [--out FILE]                 Portable export of the whole library (JSON)

Assistants
  mcp                                 stdio bridge to the remote MCP server

Options
  --json                              Print raw JSON
  -h, --help                          Show this help

Environment: SHELFOFMINE_URL and SHELFOFMINE_TOKEN override the saved configuration
(the old names BOOKSELF_URL and BOOKSELF_TOKEN also work).`;

const OPTIONS = {
  url: { type: 'string' },
  token: { type: 'string' },
  author: { type: 'string' },
  series: { type: 'string' },
  tag: { type: 'string' },
  status: { type: 'string' },
  shelf: { type: 'string' },
  sort: { type: 'string' },
  limit: { type: 'string' },
  offset: { type: 'string' },
  section: { type: 'string' },
  out: { type: 'string' },
  all: { type: 'boolean' },
  spoilers: { type: 'boolean' },
  notes: { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

interface Book {
  id: string;
  title: string;
  authors: string[];
  series: string | null;
  seriesIndex: number | null;
  tags: string[];
  description: string | null;
  publisher: string | null;
  publishedDate: string | null;
  language: string | null;
  isbn: string | null;
  files: { id: string; fileName: string; format: string; sizeBytes: number | null; status: string }[];
  reading: { status: string | null; percentage: number | null };
}

export class UsageError extends Error {}

type Out = (line?: string) => void;

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '' : `${Math.round(v * 100)}%`);
const bookLine = (b: Book) =>
  [
    b.id,
    b.title,
    b.authors.join(', ') && `— ${b.authors.join(', ')}`,
    b.series && `[${b.series}${b.seriesIndex !== null ? ` #${b.seriesIndex}` : ''}]`,
    b.reading.status && `(${b.reading.status}${b.reading.percentage ? ` ${pct(b.reading.percentage)}` : ''})`,
  ]
    .filter(Boolean)
    .join('  ');

const need = (v: string | undefined, what: string): string => {
  if (!v) throw new UsageError(`Missing ${what}`);
  return v;
};
const int = (v: string | undefined) => (v === undefined ? undefined : Number.parseInt(v, 10));

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
  } finally {
    rl.close();
  }
}

export async function run(argv: string[], out: Out = (l = '') => process.stdout.write(`${l}\n`)): Promise<void> {
  const { values: o, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [command, ...args] = positionals;
  if (o.help || !command || command === 'help') return out(HELP);
  const print = (data: unknown, human: () => void) => (o.json ? out(JSON.stringify(data, null, 2)) : human());

  if (command === 'login') {
    const saved = await loadConfig();
    const url = normalizeUrl(o.url ?? saved.url ?? (await prompt('Shelf of Mine URL (e.g. https://www.shelfofmine.com): ')));
    const token = o.token ?? (await prompt('Personal token (Settings → Connections & AI): '));
    const client = new ShelfOfMineClient({ url, token });
    const me = await client.get<{ user: { email: string } }>('/me');
    const file = await saveConfig({ url, token });
    return out(`Signed in as ${me.user.email}. Configuration saved to ${file}`);
  }
  if (command === 'logout') {
    await deleteConfig();
    return out('Token removed. Revoke it in Settings → Connections & AI if you no longer need it.');
  }

  const config = await loadConfig();
  if (!config.url || !config.token) throw new UsageError('Not configured. Run `shelfofmine login` first.');
  const client = new ShelfOfMineClient(config as Config);

  switch (command) {
    case 'whoami': {
      const me = await client.get<{ user: { email: string; displayName: string | null } }>('/me');
      return print(me, () => out(`${me.user.displayName ?? ''} <${me.user.email}> on ${config.url}`.trim()));
    }
    case 'books': {
      const res = await client.get<{ items: Book[]; total: number }>('/books', {
        q: args.join(' ') || undefined,
        author: o.author,
        series: o.series,
        tag: o.tag,
        status: o.status,
        shelf: o.shelf,
        sort: o.sort,
        limit: int(o.limit) ?? 50,
        offset: int(o.offset),
      });
      return print(res, () => {
        res.items.forEach((b) => out(bookLine(b)));
        out(`${res.items.length} of ${res.total} books`);
      });
    }
    case 'reading': {
      const res = await client.get<{ items: Book[]; total: number }>('/books', { status: 'reading', sort: 'reading', limit: 50 });
      return print(res, () => (res.items.length ? res.items.forEach((b) => out(bookLine(b))) : out('Nothing in progress.')));
    }
    case 'book': {
      const b = await client.get<Book>(`/books/${need(args[0], 'book id')}`);
      return print(b, () => {
        out(b.title);
        if (b.authors.length) out(`by ${b.authors.join(', ')}`);
        if (b.series) out(`Series: ${b.series}${b.seriesIndex !== null ? ` #${b.seriesIndex}` : ''}`);
        if (b.tags.length) out(`Tags: ${b.tags.join(', ')}`);
        if (b.reading.status) out(`Status: ${b.reading.status} ${pct(b.reading.percentage)}`.trim());
        for (const [k, v] of [['Publisher', b.publisher], ['Published', b.publishedDate], ['Language', b.language], ['ISBN', b.isbn]]) {
          if (v) out(`${k}: ${v}`);
        }
        b.files.forEach((f) => out(`File: ${f.fileName} (${f.format}${f.status === 'ok' ? '' : `, ${f.status}`})`));
        if (b.description) out(`\n${b.description}`);
      });
    }
    case 'status': {
      const id = need(args[0], 'book id');
      const status = need(args[1], 'status');
      if (!['to_read', 'reading', 'read', 'none'].includes(status)) throw new UsageError('Status must be to_read, reading, read or none');
      const res = await client.api('PUT', `/books/${id}/status`, { json: { status: status === 'none' ? null : status } });
      return print(res, () => out('Status updated.'));
    }
    case 'tag': {
      const [action, tag, ...ids] = args;
      if (action !== 'add' && action !== 'remove') throw new UsageError('Usage: shelfofmine tag add|remove TAG ID...');
      if (!ids.length) throw new UsageError('Missing book ids');
      const res = await client.api<{ affected: number }>('POST', '/books/bulk', {
        json: { ids, action: `${action}_tags`, tags: [need(tag, 'tag')] },
      });
      return print(res, () => out(`${res.affected} books updated.`));
    }
    case 'shelves': {
      const res = await client.get<{ items: { id: string; name: string; count: number }[] }>('/shelves');
      return print(res, () => res.items.forEach((s) => out(`${s.id}  ${s.name}  (${s.count})`)));
    }
    case 'shelf': {
      const [action, ...rest] = args;
      if (action === 'create') {
        const res = await client.api<{ id: string; name: string }>('POST', '/shelves', { json: { name: need(rest.join(' '), 'name') } });
        return print(res, () => out(`Created ${res.name} (${res.id})`));
      }
      if (action === 'add' || action === 'remove') {
        const [shelfId, ...ids] = rest;
        if (!ids.length) throw new UsageError('Missing book ids');
        const res = await client.api<{ affected: number }>('POST', '/books/bulk', {
          json: { ids, action: action === 'add' ? 'add_to_shelf' : 'remove_from_shelf', shelfId: need(shelfId, 'shelf id') },
        });
        return print(res, () => out(`${res.affected} books updated.`));
      }
      throw new UsageError('Usage: shelfofmine shelf create NAME | shelf add|remove SHELF_ID ID...');
    }
    case 'highlights': {
      type Note = { bookTitle?: string; kind: string; text: string | null; note: string | null; chapter: string | null };
      const res = args[0]
        ? await client.get<{ items: Note[] }>(`/books/${args[0]}/annotations`)
        : await client.get<{ items: Note[] }>('/annotations', { kind: 'highlight', withNotes: o.notes, limit: int(o.limit) ?? 50 });
      const items = res.items.filter((n) => n.kind === 'highlight' && (!o.notes || n.note));
      return print({ items }, () =>
        items.forEach((n) => {
          out(`“${n.text ?? ''}”`);
          const where = [n.bookTitle, n.chapter].filter(Boolean).join(' · ');
          if (where) out(`  — ${where}`);
          if (n.note) out(`  ✎ ${n.note}`);
          out();
        }),
      );
    }
    case 'outline': {
      type Outline = { title: string; readableUntil: number; sections: { index: number; title: string; chars: number; readableChars: number }[] };
      const res = await client.get<Outline>(`/books/${need(args[0], 'book id')}/outline`, { spoilers: o.spoilers });
      return print(res, () => {
        out(`${res.title} — readable up to ${pct(res.readableUntil)}`);
        res.sections.forEach((s) =>
          out(`${String(s.index).padStart(3)}  ${s.title}${s.readableChars < s.chars ? `  (${s.readableChars ? 'partly ' : ''}locked)` : ''}`),
        );
      });
    }
    case 'text': {
      type Chunk = { text: string; nextOffset: number | null; stoppedAtProgress: boolean; section: { index: number; title: string }; sectionCount: number };
      const id = need(args[0], 'book id');
      let section = int(o.section);
      let offset = 0;
      const chunks: Chunk[] = [];
      for (;;) {
        const chunk = await client.get<Chunk>(`/books/${id}/text`, { section, offset, maxChars: 50000, spoilers: o.spoilers });
        chunks.push(chunk);
        if (!o.json) out(chunk.text);
        section = chunk.section.index;
        if (chunk.nextOffset !== null) {
          offset = chunk.nextOffset;
          continue;
        }
        if (o.all && !chunk.stoppedAtProgress && section + 1 < chunk.sectionCount) {
          section++;
          offset = 0;
          if (!o.json) out();
          continue;
        }
        if (!o.json && chunk.stoppedAtProgress) process.stderr.write('[stopped at your reading position; use --spoilers to read on]\n');
        break;
      }
      if (o.json) out(JSON.stringify(chunks, null, 2));
      return;
    }
    case 'download': {
      const id = need(args[0], 'book id');
      const book = await client.get<Book>(`/books/${id}`);
      const file = book.files.find((f) => f.status === 'ok');
      if (!file) throw new UsageError('The book has no file available in Google Drive');
      const res = await client.raw('GET', `/api/v1/books/${id}/files/${file.id}/content`, { query: { download: 1 } });
      const target = path.join(o.out ?? '.', path.basename(file.fileName));
      await writeFile(target, Buffer.from(await res.arrayBuffer()));
      return out(`Saved ${target}`);
    }
    case 'upload': {
      if (!args.length) throw new UsageError('Usage: shelfofmine upload FILE...');
      const form = new FormData();
      for (const f of args) form.append('file', new Blob([await readFile(f)]), path.basename(f));
      const res = await client.api<{ results: { name: string; status: string; bookId?: string; error?: string }[] }>(
        'POST',
        '/books/upload',
        { body: form },
      );
      return print(res, () =>
        res.results.forEach((r) => out([r.status, r.name, r.bookId, r.error].filter(Boolean).join('  '))),
      );
    }
    case 'export': {
      const data = await client.get<unknown>('/export');
      const target = o.out ?? `shelfofmine-export-${new Date().toISOString().slice(0, 10)}.json`;
      await writeFile(target, JSON.stringify(data, null, 2));
      return out(`Saved ${target}`);
    }
    case 'mcp':
      return mcpBridge(client);
    default:
      throw new UsageError(`Unknown command: ${command}. Run \`shelfofmine --help\`.`);
  }
}

/**
 * Puente stdio para clientes MCP que solo lanzan servidores locales: lee mensajes JSON-RPC por líneas de
 * stdin, los envía al servidor remoto (/mcp) con el token y escribe las respuestas en stdout.
 */
async function mcpBridge(client: ShelfOfMineClient) {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const write = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const pending: Promise<void>[] = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: { id?: unknown };
    try {
      msg = JSON.parse(line) as { id?: unknown };
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    pending.push(
      (async () => {
        try {
          const res = await client.raw('POST', '/mcp', { json: msg });
          if (res.status === 202) return;
          write(await res.json());
        } catch (err) {
          if (msg.id === undefined) return;
          write({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: (err as Error).message } });
        }
      })(),
    );
  }
  await Promise.all(pending);
}

function isMain(): boolean {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]!) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  run(process.argv.slice(2)).catch((err: unknown) => {
    if (err instanceof UsageError || err instanceof ApiError) process.stderr.write(`shelfofmine: ${err.message}\n`);
    else process.stderr.write(`shelfofmine: ${(err as Error)?.message ?? err}\n`);
    process.exitCode = err instanceof UsageError ? 2 : 1;
  });
}

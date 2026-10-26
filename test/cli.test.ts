import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { BookselfClient, configPath, loadConfig, normalizeUrl, run, saveConfig, UsageError } from '../src/cli.js';

describe('configuración', () => {
  let env: NodeJS.ProcessEnv;
  beforeEach(async () => {
    env = { XDG_CONFIG_HOME: await mkdtemp(path.join(os.tmpdir(), 'bookself-cli-')) };
  });

  it('guarda la URL y el token en un fichero privado', async () => {
    const file = await saveConfig({ url: 'https://books.example', token: 'bsp_x' }, env);
    expect(file).toBe(configPath(env));
    expect(await loadConfig(env)).toEqual({ url: 'https://books.example', token: 'bsp_x' });
    if (process.platform !== 'win32') {
      const { stat } = await import('node:fs/promises');
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
  });

  it('las variables de entorno tienen prioridad', async () => {
    await saveConfig({ url: 'https://books.example', token: 'bsp_x' }, env);
    expect(await loadConfig({ ...env, BOOKSELF_TOKEN: 'bsp_env' })).toEqual({ url: 'https://books.example', token: 'bsp_env' });
  });

  it('normaliza la URL de la instancia', () => {
    expect(normalizeUrl('books.example/')).toBe('https://books.example');
    expect(normalizeUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });
});

describe('cliente', () => {
  it('llama a /api/v1 con el token y convierte los errores', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/missing')) {
        return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Book not found' } }), { status: 404 });
      }
      return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
    }) as typeof fetch;
    const client = new BookselfClient({ url: 'https://books.example', token: 'bsp_x' }, fake);
    await client.get('/books', { q: 'dune', status: undefined, spoilers: false });
    expect(calls[0]!.url).toBe('https://books.example/api/v1/books?q=dune');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer bsp_x');
    await expect(client.get('/missing')).rejects.toMatchObject({ status: 404, code: 'not_found', message: 'Book not found' });
  });
});

describe('comandos', () => {
  it('muestra la ayuda', async () => {
    const lines: string[] = [];
    await run(['--help'], (l = '') => lines.push(l));
    expect(lines.join('\n')).toContain('bookself — your Bookself library');
  });

  it('pide iniciar sesión si no hay configuración', async () => {
    const before = { ...process.env };
    process.env.XDG_CONFIG_HOME = await mkdtemp(path.join(os.tmpdir(), 'bookself-cli-'));
    delete process.env.BOOKSELF_URL;
    delete process.env.BOOKSELF_TOKEN;
    try {
      await expect(run(['books'], () => {})).rejects.toBeInstanceOf(UsageError);
    } finally {
      process.env = before;
    }
  });
});

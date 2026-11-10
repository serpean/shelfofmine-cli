import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ShelfOfMineClient, configPath, legacyConfigPath, loadConfig, normalizeUrl, run, saveConfig, UsageError } from '../src/cli.js';

describe('configuración', () => {
  let env: NodeJS.ProcessEnv;
  beforeEach(async () => {
    env = { XDG_CONFIG_HOME: await mkdtemp(path.join(os.tmpdir(), 'shelfofmine-cli-')) };
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
    expect(await loadConfig({ ...env, SHELFOFMINE_TOKEN: 'bsp_env' })).toEqual({ url: 'https://books.example', token: 'bsp_env' });
  });

  it('acepta las variables con el nombre anterior (BOOKSELF_*)', async () => {
    await saveConfig({ url: 'https://books.example', token: 'bsp_x' }, env);
    expect(await loadConfig({ ...env, BOOKSELF_TOKEN: 'bsp_old' })).toEqual({ url: 'https://books.example', token: 'bsp_old' });
    expect(await loadConfig({ ...env, BOOKSELF_TOKEN: 'bsp_old', SHELFOFMINE_TOKEN: 'bsp_new' })).toMatchObject({ token: 'bsp_new' });
  });

  it('lee la configuración guardada con el nombre anterior si no hay una nueva', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const old = legacyConfigPath(env);
    await mkdir(path.dirname(old), { recursive: true });
    await writeFile(old, JSON.stringify({ url: 'https://old.example', token: 'bsp_old' }));
    expect(await loadConfig(env)).toEqual({ url: 'https://old.example', token: 'bsp_old' });
    // Al guardar de nuevo se usa la carpeta nueva, que gana a la antigua.
    await saveConfig({ url: 'https://shelfofmine.com', token: 'bsp_new' }, env);
    expect(configPath(env)).toContain(`${path.sep}shelfofmine${path.sep}`);
    expect(await loadConfig(env)).toEqual({ url: 'https://shelfofmine.com', token: 'bsp_new' });
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
    const client = new ShelfOfMineClient({ url: 'https://books.example', token: 'bsp_x' }, fake);
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
    expect(lines.join('\n')).toContain('shelfofmine — your Shelf of Mine library');
  });

  it('pide iniciar sesión si no hay configuración', async () => {
    const before = { ...process.env };
    process.env.XDG_CONFIG_HOME = await mkdtemp(path.join(os.tmpdir(), 'shelfofmine-cli-'));
    delete process.env.SHELFOFMINE_URL;
    delete process.env.SHELFOFMINE_TOKEN;
    delete process.env.BOOKSELF_URL;
    delete process.env.BOOKSELF_TOKEN;
    try {
      await expect(run(['books'], () => {})).rejects.toBeInstanceOf(UsageError);
    } finally {
      process.env = before;
    }
  });
});

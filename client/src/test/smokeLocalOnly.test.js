import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '../../e2e/journeys/hierarchy-flow.smoke.mjs');
const { assertLocalOnly } = await import('../../e2e/support/local-only.mjs');

describe('journey smoke local-only guard', () => {
  it('accepts loopback hosts', () => {
    expect(() => assertLocalOnly({ A: 'http://127.0.0.1:8030/api', B: 'http://localhost:5200' })).not.toThrow();
  });

  it('rejects the staging host and names the variable', () => {
    expect(() => assertLocalOnly({ HIUSA_E2E_API_URL: 'http://13.228.227.182/api' })).toThrow(/HIUSA_E2E_API_URL/);
  });

  it('rejects a lookalike hostname and an unparseable URL', () => {
    expect(() => assertLocalOnly({ X: 'http://localhost.example.com/api' })).toThrow(/X/);
    expect(() => assertLocalOnly({ X: 'not a url' })).toThrow(/X/);
  });

  it('exits 1 before any request when either URL is not local', () => {
    for (const name of ['HIUSA_E2E_API_URL', 'HIUSA_E2E_BASE_URL']) {
      const result = spawnSync(process.execPath, [script], {
        env: { ...process.env, [name]: 'http://13.228.227.182/x' },
        encoding: 'utf8',
        timeout: 15000,
      });
      expect(result.status, `${name}: ${result.stderr}`).toBe(1);
      expect(result.stderr).toContain(name);
    }
  });
});

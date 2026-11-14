import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const E2E_DIR = join(process.cwd(), 'e2e');

function specFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? specFiles(path) : [path];
  });
}

describe('end-to-end specs', () => {
  it('never send a task deadline as a fixed calendar date, which the API refuses once the date has passed', () => {
    const offenders = specFiles(E2E_DIR)
      .filter((path) => /\.(spec\.js|mjs)$/.test(path))
      .filter((path) => readFileSync(path, 'utf8').split('\n').some((line) => line.includes('/tasks`') && /\bdeadline\s*:\s*['"`]\d{4}-\d{2}-\d{2}/.test(line)));

    expect(offenders).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { resolveRuntimeApiUrl } from './runtimeApiUrl';

describe('resolveRuntimeApiUrl', () => {
  it('uses the configured API URL without changing its hostname', () => {
    expect(resolveRuntimeApiUrl('http://192.168.1.102:8000/api'))
      .toBe('http://192.168.1.102:8000/api');
  });

  it('defaults to the localhost API when the variable is missing', () => {
    expect(resolveRuntimeApiUrl(undefined, false)).toBe('http://localhost:8000/api');
    expect(resolveRuntimeApiUrl('   ', false)).toBe('http://localhost:8000/api');
  });

  it('defaults to the same-origin API in production', () => {
    expect(resolveRuntimeApiUrl(undefined, true)).toBe('/api');
    expect(resolveRuntimeApiUrl('   ', true)).toBe('/api');
  });

  it('preserves relative and external API URLs exactly', () => {
    expect(resolveRuntimeApiUrl('/api')).toBe('/api');
    expect(resolveRuntimeApiUrl('https://api.example.com/api'))
      .toBe('https://api.example.com/api');
  });
});

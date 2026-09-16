import { describe, expect, it } from 'vitest';
import { resolveRuntimeApiUrl } from './runtimeApiUrl';

describe('resolveRuntimeApiUrl', () => {
  it('follows the current LAN hostname when a saved DHCP address is stale', () => {
    expect(resolveRuntimeApiUrl('http://192.168.1.102:8000/api', {
      protocol: 'http:',
      hostname: '192.168.1.104',
    })).toBe('http://192.168.1.104:8000/api');
  });

  it('uses the LAN hostname when the development template contains localhost', () => {
    expect(resolveRuntimeApiUrl('http://localhost:8000/api', {
      protocol: 'http:',
      hostname: '192.168.1.104',
    })).toBe('http://192.168.1.104:8000/api');
  });

  it('uses localhost when the host computer opens the frontend locally', () => {
    expect(resolveRuntimeApiUrl('http://192.168.1.102:8000/api', {
      protocol: 'http:',
      hostname: 'localhost',
    })).toBe('http://localhost:8000/api');
  });

  it('preserves production relative and external API URLs', () => {
    const location = { protocol: 'https:', hostname: 'hiusa.example.com' };
    expect(resolveRuntimeApiUrl('/api', location)).toBe('/api');
    expect(resolveRuntimeApiUrl('https://api.example.com/api', location))
      .toBe('https://api.example.com/api');
  });
});

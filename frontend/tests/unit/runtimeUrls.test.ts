import { describe, expect, it } from 'vitest';
import { resolveBackendUrl } from '@infrastructure/config/env';

describe('runtime backend URL', () => {
  it('keeps localhost when the frontend also runs on localhost', () => {
    expect(
      resolveBackendUrl(
        'http://localhost:3000',
        new URL('http://localhost:5173')
      )
    ).toBe('http://localhost:3000');
  });

  it('uses the frontend LAN hostname instead of another device localhost', () => {
    expect(
      resolveBackendUrl(
        'http://localhost:3000',
        new URL('http://192.168.1.8:5173')
      )
    ).toBe('http://192.168.1.8:3000');
  });
});

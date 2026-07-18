import { isAllowedCorsOrigin } from './cors-origin';

describe('CORS origin policy', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalCorsOrigin = process.env.CORS_ORIGIN;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.CORS_ORIGIN = originalCorsOrigin;
  });

  it('accepts loopback and private-LAN frontend origins in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.CORS_ORIGIN = 'http://localhost:5173';

    expect(isAllowedCorsOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedCorsOrigin('http://192.168.1.8:5173')).toBe(true);
    expect(isAllowedCorsOrigin('http://10.0.0.4:5173')).toBe(true);
  });

  it('only accepts explicitly configured origins in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN =
      'https://vietbridge.example,http://192.168.1.8:5173';

    expect(isAllowedCorsOrigin('https://vietbridge.example')).toBe(true);
    expect(isAllowedCorsOrigin('http://192.168.1.8:5173')).toBe(true);
    expect(isAllowedCorsOrigin('http://192.168.1.9:5173')).toBe(false);
  });
});

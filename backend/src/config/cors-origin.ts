export type CorsOriginCallback = (error: Error | null, allow?: boolean) => void;

export function validateCorsOrigin(
  origin: string | undefined,
  callback: CorsOriginCallback,
): void {
  if (origin === undefined || isAllowedCorsOrigin(origin)) {
    callback(null, true);
    return;
  }
  callback(new Error('Origin is not allowed by VietBridge CORS policy.'));
}

export function isAllowedCorsOrigin(origin: string): boolean {
  const configuredOrigins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (configuredOrigins.includes(origin)) {
    return true;
  }
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      isDevelopmentHost(url.hostname) &&
      (url.port === '5173' || url.port === '4173')
    );
  } catch {
    return false;
  }
}

function isDevelopmentHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    isPrivate172Address(hostname)
  );
}

function isPrivate172Address(hostname: string): boolean {
  const match = /^172\.(\d{1,3})\./.exec(hostname);
  if (match === null) {
    return false;
  }
  const secondOctet = Number(match[1]);
  return secondOctet >= 16 && secondOctet <= 31;
}

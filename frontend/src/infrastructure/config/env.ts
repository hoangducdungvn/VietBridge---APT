const pageUrl = new URL(window.location.href);

export const env = {
  backendApiUrl: resolveBackendUrl(import.meta.env.VITE_BACKEND_API_URL, pageUrl),
  backendWsUrl: resolveBackendUrl(import.meta.env.VITE_BACKEND_WS_URL, pageUrl),
  publicAppUrl: removeTrailingSlash(
    import.meta.env.VITE_PUBLIC_APP_URL ?? window.location.origin
  ),
  supportedLanguages: (import.meta.env.VITE_SUPPORTED_LANGUAGES ?? 'vi,en').split(',')
};

export function resolveBackendUrl(configuredUrl: string | undefined, runtimeUrl: URL): string {
  const fallback = `${runtimeUrl.protocol}//${runtimeUrl.hostname}:3000`;
  const resolved = new URL(configuredUrl ?? fallback);
  if (isLoopback(resolved.hostname) && !isLoopback(runtimeUrl.hostname)) {
    resolved.hostname = runtimeUrl.hostname;
  }
  return removeTrailingSlash(resolved.toString());
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function removeTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

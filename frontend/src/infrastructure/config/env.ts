const pageUrl = new URL(window.location.href);

export const env = {
  backendApiUrl: resolveBackendUrl(import.meta.env.VITE_BACKEND_API_URL, pageUrl),
  backendWsUrl: resolveBackendUrl(import.meta.env.VITE_BACKEND_WS_URL, pageUrl),
  /**
   * Voice/results transport:
   * - 'ws'      → VoicePipeline talks raw WebSocket to the mock gateway
   *               (VITE_MOCK_GATEWAY_URL); works today, no NestJS realtime needed.
   * - 'socketio'→ legacy path via the NestJS Socket.IO gateway (still a stub).
   */
  transport: (import.meta.env.VITE_TRANSPORT === 'ws' ? 'ws' : 'socketio') as 'ws' | 'socketio',
  mockGatewayUrl: resolveGatewayUrl(import.meta.env.VITE_MOCK_GATEWAY_URL, pageUrl),
  publicAppUrl: removeTrailingSlash(
    import.meta.env.VITE_PUBLIC_APP_URL ?? window.location.origin
  ),
  supportedLanguages: (import.meta.env.VITE_SUPPORTED_LANGUAGES ?? 'vi,en').split(',')
};

/** Mock ingestion gateway (voice/src/mock-server) — raw WS, default port 8081. */
function resolveGatewayUrl(configuredUrl: string | undefined, runtimeUrl: URL): string {
  const fallback = `ws://${runtimeUrl.hostname}:8081`;
  const resolved = new URL(configuredUrl ?? fallback);
  if (isLoopback(resolved.hostname) && !isLoopback(runtimeUrl.hostname)) {
    resolved.hostname = runtimeUrl.hostname;
  }
  return removeTrailingSlash(resolved.toString());
}

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

// Environment config boundary for frontend runtime settings.
export const env = {
  backendWsUrl: import.meta.env.VITE_BACKEND_WS_URL ?? 'http://localhost:8000',
  supportedLanguages: (import.meta.env.VITE_SUPPORTED_LANGUAGES ?? 'vi,en').split(',')
};

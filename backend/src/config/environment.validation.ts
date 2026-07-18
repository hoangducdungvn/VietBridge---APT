const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
const PROVIDER_MODES = ['mock', 'remote', 'local'] as const;

export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];
export type ProviderMode = (typeof PROVIDER_MODES)[number];

export interface EnvironmentVariables {
  CORS_ORIGIN: string;
  HOST: string;
  LOG_TRANSCRIPTS: boolean;
  NODE_ENV: NodeEnvironment;
  PORT: number;
  STT_BASE_URL: string;
  STT_FINAL_TIMEOUT_MS: number;
  STT_PROVIDER: ProviderMode;
  STT_START_TIMEOUT_MS: number;
  TRANSLATION_PROVIDER: ProviderMode;
  TRANSLATION_TIMEOUT_MS: number;
}

export function validateEnvironment(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...environment,
    CORS_ORIGIN: parseOrigins(environment.CORS_ORIGIN),
    HOST: parseNonEmptyString('HOST', environment.HOST, '127.0.0.1'),
    LOG_TRANSCRIPTS: parseBoolean(
      'LOG_TRANSCRIPTS',
      environment.LOG_TRANSCRIPTS,
      false,
    ),
    NODE_ENV: parseEnum(
      'NODE_ENV',
      environment.NODE_ENV,
      NODE_ENVIRONMENTS,
      'development',
    ),
    PORT: parseInteger('PORT', environment.PORT, 3000, 1, 65_535),
    STT_BASE_URL: parseHttpUrl(
      'STT_BASE_URL',
      environment.STT_BASE_URL,
      'http://localhost:8001',
    ),
    STT_FINAL_TIMEOUT_MS: parseInteger(
      'STT_FINAL_TIMEOUT_MS',
      environment.STT_FINAL_TIMEOUT_MS,
      8000,
      1,
      120_000,
    ),
    STT_PROVIDER: parseEnum(
      'STT_PROVIDER',
      environment.STT_PROVIDER,
      PROVIDER_MODES,
      'mock',
    ),
    STT_START_TIMEOUT_MS: parseInteger(
      'STT_START_TIMEOUT_MS',
      environment.STT_START_TIMEOUT_MS,
      5000,
      1,
      120_000,
    ),
    TRANSLATION_PROVIDER: parseEnum(
      'TRANSLATION_PROVIDER',
      environment.TRANSLATION_PROVIDER,
      PROVIDER_MODES,
      'mock',
    ),
    TRANSLATION_TIMEOUT_MS: parseInteger(
      'TRANSLATION_TIMEOUT_MS',
      environment.TRANSLATION_TIMEOUT_MS,
      5000,
      1,
      120_000,
    ),
  } satisfies EnvironmentVariables & Record<string, unknown>;
}

function parseNonEmptyString(
  name: string,
  value: unknown,
  defaultValue: string,
): string {
  const resolvedValue = value ?? defaultValue;
  if (typeof resolvedValue !== 'string' || resolvedValue.trim() === '') {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return resolvedValue.trim();
}

function parseBoolean(
  name: string,
  value: unknown,
  defaultValue: boolean,
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  throw new Error(`${name} must be either true or false.`);
}

function parseEnum<const TValues extends readonly string[]>(
  name: string,
  value: unknown,
  allowedValues: TValues,
  defaultValue: TValues[number],
): TValues[number] {
  const resolvedValue = value ?? defaultValue;

  if (
    typeof resolvedValue !== 'string' ||
    !allowedValues.some((allowedValue) => allowedValue === resolvedValue)
  ) {
    throw new Error(`${name} must be one of: ${allowedValues.join(', ')}.`);
  }

  return resolvedValue;
}

function parseInteger(
  name: string,
  value: unknown,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const resolvedValue = value ?? defaultValue;
  const parsedValue =
    typeof resolvedValue === 'number'
      ? resolvedValue
      : typeof resolvedValue === 'string' && resolvedValue.trim() !== ''
        ? Number(resolvedValue)
        : Number.NaN;

  if (
    !Number.isInteger(parsedValue) ||
    parsedValue < minimum ||
    parsedValue > maximum
  ) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  return parsedValue;
}

function parseOrigins(value: unknown): string {
  const origin = value ?? 'http://localhost:5173';

  if (typeof origin !== 'string' || origin.trim() === '') {
    throw new Error('CORS_ORIGIN must contain at least one HTTP(S) origin.');
  }

  const origins = origin.split(',').map((value) => value.trim());
  for (const item of origins) {
    try {
      const parsedOrigin = new URL(item);
      if (
        parsedOrigin.protocol !== 'http:' &&
        parsedOrigin.protocol !== 'https:'
      ) {
        throw new Error('Unsupported protocol.');
      }
    } catch {
      throw new Error(
        'CORS_ORIGIN must be a comma-separated list of valid HTTP(S) origins.',
      );
    }
  }

  return origins.join(',');
}

function parseHttpUrl(
  name: string,
  value: unknown,
  defaultValue: string,
): string {
  const resolvedValue = value ?? defaultValue;
  if (typeof resolvedValue !== 'string' || resolvedValue.trim() === '') {
    throw new Error(`${name} must be a non-empty HTTP(S) URL.`);
  }
  try {
    const parsedUrl = new URL(resolvedValue);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('Unsupported protocol.');
    }
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL.`);
  }
  return resolvedValue.replace(/\/$/, '');
}

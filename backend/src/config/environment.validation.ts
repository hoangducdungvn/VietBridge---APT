const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
const PROVIDER_MODES = ['mock', 'remote', 'local'] as const;

export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];
export type ProviderMode = (typeof PROVIDER_MODES)[number];

export interface EnvironmentVariables {
  CORS_ORIGIN: string;
  LOG_TRANSCRIPTS: boolean;
  NODE_ENV: NodeEnvironment;
  PORT: number;
  STT_FINAL_TIMEOUT_MS: number;
  STT_PROVIDER: ProviderMode;
  STT_START_TIMEOUT_MS: number;
  TRANSLATION_PROVIDER: ProviderMode;
  TRANSLATION_SERVICE_URL: string;
  TRANSLATION_TIMEOUT_MS: number;
}

export function validateEnvironment(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...environment,
    CORS_ORIGIN: parseOrigin(environment.CORS_ORIGIN),
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
    TRANSLATION_SERVICE_URL: parseUrl(
      'TRANSLATION_SERVICE_URL',
      environment.TRANSLATION_SERVICE_URL,
      'http://localhost:8000',
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

function parseOrigin(value: unknown): string {
  const origin = value ?? 'http://localhost:5173';

  if (typeof origin !== 'string' || origin.trim() === '') {
    throw new Error('CORS_ORIGIN must be a non-empty HTTP(S) origin.');
  }

  try {
    const parsedOrigin = new URL(origin);
    if (
      parsedOrigin.protocol !== 'http:' &&
      parsedOrigin.protocol !== 'https:'
    ) {
      throw new Error('Unsupported protocol.');
    }
  } catch {
    throw new Error('CORS_ORIGIN must be a valid HTTP(S) origin.');
  }

  return origin;
}

function parseUrl(
  name: string,
  value: unknown,
  defaultValue: string,
): string {
  const resolvedValue = value ?? defaultValue;

  if (typeof resolvedValue !== 'string' || resolvedValue.trim() === '') {
    throw new Error(`${name} must be a non-empty URL.`);
  }

  try {
    new URL(resolvedValue);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }

  return resolvedValue;
}

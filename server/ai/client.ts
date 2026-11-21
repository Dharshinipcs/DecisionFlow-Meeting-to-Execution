import { AsyncLocalStorage } from 'async_hooks';
import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';

const DEFAULT_MODEL = 'gemini-4-hydrogen';
const DEFAULT_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const EMBEDDING_MODEL = 'gemini-embedding-2';

const DAILY_QUOTA_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours
const RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

export interface GeminiClientLike {
  models: {
    generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse>;
    embedContent?: GoogleGenAI['models']['embedContent'];
  };
}

export interface GeminiFallbackEvent {
  fromModel: string;
  toModel: string;
  reason: string;
  timestamp: string;
}

interface GeminiExecutionContext {
  fallbackEvents: GeminiFallbackEvent[];
  modelsUsed: string[];
}

const geminiContextStorage = new AsyncLocalStorage<GeminiExecutionContext>();

let cachedClient: GoogleGenAI | null = null;
const quotaExhaustedUntilByModel = new Map<string, { until: number; reason: string }>();

export class GeminiUnavailableError extends Error {
  readonly statusCode = 503;
  readonly code = 'AI_UNAVAILABLE';

  constructor(
    message = 'AI processing is temporarily unavailable. Your transcript and existing workspace data have not been corrupted. Please try again shortly.'
  ) {
    super(message);
    this.name = 'GeminiUnavailableError';
  }
}

export function getGeminiModel(): string {
  const configured = process.env.GEMINI_MODEL?.trim();
  return configured || DEFAULT_MODEL;
}

export function getGeminiFallbackModel(): string {
  const configured = process.env.GEMINI_FALLBACK_MODEL?.trim();
  return configured || DEFAULT_FALLBACK_MODEL;
}

export function getEmbeddingModel(): string {
  return EMBEDDING_MODEL;
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function resetGeminiFallbackState(): void {
  quotaExhaustedUntilByModel.clear();
}

export function isModelQuotaExhausted(model: string, now = Date.now()): boolean {
  const entry = quotaExhaustedUntilByModel.get(model);
  if (!entry) return false;
  if (now >= entry.until) {
    quotaExhaustedUntilByModel.delete(model);
    return false;
  }
  return true;
}

export function getGeminiFallbackStatus(now = Date.now()): {
  primaryModel: string;
  fallbackModel: string;
  primaryInQuotaCooldown: boolean;
  cooldownReason: string | null;
} {
  const primaryModel = getGeminiModel();
  const entry = quotaExhaustedUntilByModel.get(primaryModel);
  const active = Boolean(entry && now < entry.until);
  if (entry && !active) {
    quotaExhaustedUntilByModel.delete(primaryModel);
  }
  return {
    primaryModel,
    fallbackModel: getGeminiFallbackModel(),
    primaryInQuotaCooldown: active,
    cooldownReason: active ? entry!.reason : null,
  };
}

export async function runWithGeminiContext<T>(
  fn: () => Promise<T>
): Promise<{ result: T; fallbackEvents: GeminiFallbackEvent[]; modelsUsed: string[] }> {
  const ctx: GeminiExecutionContext = {
    fallbackEvents: [],
    modelsUsed: [],
  };
  const result = await geminiContextStorage.run(ctx, fn);
  return {
    result,
    fallbackEvents: ctx.fallbackEvents,
    modelsUsed: Array.from(new Set(ctx.modelsUsed)),
  };
}

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add your Gemini API key in Settings > Secrets to run AI extraction and reasoning.'
    );
  }

  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        timeout: 30000,
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  return cachedClient;
}

function extractErrorDetails(err: unknown): { status?: number; code?: string; message: string } {
  if (!err || typeof err !== 'object') {
    return { message: String(err ?? '') };
  }
  const e = err as Record<string, unknown>;
  const cause = e.cause && typeof e.cause === 'object' ? (e.cause as Record<string, unknown>) : undefined;
  const status =
    typeof e.status === 'number'
      ? e.status
      : typeof e.statusCode === 'number'
        ? e.statusCode
        : typeof cause?.status === 'number'
          ? cause.status
          : undefined;
  const code =
    typeof e.code === 'string'
      ? e.code
      : typeof cause?.code === 'string'
        ? cause.code
        : undefined;
  const message =
    typeof e.message === 'string'
      ? e.message
      : String(err);
  return { status, code, message };
}

export function isQuotaExhaustedError(err: unknown): boolean {
  const { status, code, message } = extractErrorDetails(err);
  if (status === 429) return true;
  const upper = `${code ?? ''} ${message}`.toUpperCase();
  return (
    upper.includes('429') ||
    upper.includes('RESOURCE_EXHAUSTED') ||
    upper.includes('QUOTA') ||
    upper.includes('RATE_LIMIT') ||
    upper.includes('RATE LIMIT') ||
    upper.includes('TOO MANY REQUESTS')
  );
}

export function isDailyQuotaError(err: unknown): boolean {
  const { message } = extractErrorDetails(err);
  const lower = message.toLowerCase();
  return (
    lower.includes('perday') ||
    lower.includes('per_day') ||
    lower.includes('requestsperday') ||
    lower.includes('daily') ||
    lower.includes('free_tier') ||
    lower.includes('exceeded your current quota')
  );
}

export function isAuthOrConfigError(err: unknown): boolean {
  const { status, message } = extractErrorDetails(err);
  if (status === 401 || status === 403) return true;
  const upper = message.toUpperCase();
  return (
    upper.includes('GEMINI_API_KEY') ||
    upper.includes('API_KEY_INVALID') ||
    upper.includes('PERMISSION_DENIED') ||
    upper.includes('API KEY NOT VALID')
  );
}

export function isRetryableGeminiError(err: unknown): boolean {
  if (isAuthOrConfigError(err)) return false;
  if (isQuotaExhaustedError(err)) return true;

  const { status, code, message } = extractErrorDetails(err);
  if (status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  const normalizedCode = (code ?? '').toUpperCase();
  if (
    ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'ABORT_ERR'].includes(
      normalizedCode
    )
  ) {
    return true;
  }

  const upper = message.toUpperCase();
  return (
    upper.includes('503') ||
    upper.includes('504') ||
    upper.includes('502') ||
    upper.includes('500') ||
    upper.includes('408') ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('HIGH DEMAND') ||
    upper.includes('OVERLOADED') ||
    upper.includes('DEADLINE_EXCEEDED') ||
    upper.includes('TIMEOUT') ||
    upper.includes('TIMED OUT') ||
    upper.includes('ABORT') ||
    upper.includes('FETCH FAILED') ||
    upper.includes('ECONNRESET') ||
    upper.includes('ETIMEDOUT') ||
    upper.includes('INTERNAL')
  );
}

export function sanitizeGeminiErrorMessage(err: unknown): string {
  if (err instanceof GeminiUnavailableError) {
    return err.message;
  }
  if (isAuthOrConfigError(err)) {
    return 'Gemini API key is missing or invalid. Please check GEMINI_API_KEY in Settings > Secrets.';
  }
  if (isRetryableGeminiError(err)) {
    return new GeminiUnavailableError().message;
  }
  const msg = (err as Error)?.message?.trim() ?? '';
  // Never leak raw JSON error payloads from upstream APIs into the UI or DB
  if (!msg || msg.startsWith('{') || msg.includes('"error":') || msg.includes('RESOURCE_EXHAUSTED')) {
    return new GeminiUnavailableError().message;
  }
  return msg;
}

function recordModelUsed(model: string) {
  const ctx = geminiContextStorage.getStore();
  if (ctx) {
    ctx.modelsUsed.push(model);
  }
}

function recordFallbackEvent(fromModel: string, toModel: string, reason: string) {
  const ctx = geminiContextStorage.getStore();
  if (ctx) {
    ctx.fallbackEvents.push({
      fromModel,
      toModel,
      reason,
      timestamp: new Date().toISOString(),
    });
  }
}

function buildFallbackParams(
  params: Omit<GenerateContentParameters, 'model'>,
  fallbackModel: string
): GenerateContentParameters {
  // Preserve exact prompt, contents, systemInstruction, responseMimeType, and responseSchema.
  // Only guard against XHIGH thinkingLevel if falling back to Gemini 3 Flash-Lite (unsupported there).
  const rawThinking = (params.config as { thinkingConfig?: { thinkingLevel?: string } } | undefined)?.thinkingConfig;
  if (rawThinking?.thinkingLevel === 'XHIGH' && fallbackModel.startsWith('gemini-3')) {
    return {
      ...params,
      model: fallbackModel,
      config: {
        ...params.config,
        thinkingConfig: {
          ...rawThinking,
          thinkingLevel: 'HIGH' as NonNullable<typeof params.config>['thinkingConfig'] extends { thinkingLevel?: infer T }
            ? T
            : never,
        },
      },
    };
  }
  return {
    ...params,
    model: fallbackModel,
  };
}

/**
 * Calls Gemini generateContent with automatic server-side fallback from the primary model
 * (default: gemini-4-hydrogen) to the configured fallback model (default: gemini-3.1-flash-lite)
 * on quota exhaustion (429 / RESOURCE_EXHAUSTED), 503/504 demand spikes, timeouts, and transient failures.
 */
export async function generateContentResilient(
  params: Omit<GenerateContentParameters, 'model'> & { model?: string },
  options?: {
    client?: GeminiClientLike;
    fallbackModel?: string;
    now?: () => number;
  }
): Promise<GenerateContentResponse> {
  const ai = options?.client ?? getGeminiClient();
  const nowFn = options?.now ?? Date.now;
  const primaryModel = params.model ?? getGeminiModel();
  const fallbackModel = options?.fallbackModel ?? getGeminiFallbackModel();
  const { model: _ignoredModel, ...requestParams } = params;

  const canFallback = Boolean(fallbackModel && fallbackModel !== primaryModel);

  // If primary model is already known to be quota-exhausted, skip directly to fallback
  if (canFallback && isModelQuotaExhausted(primaryModel, nowFn())) {
    recordFallbackEvent(primaryModel, fallbackModel, 'Primary model in quota cooldown');
    try {
      const response = await ai.models.generateContent(buildFallbackParams(requestParams, fallbackModel));
      recordModelUsed(fallbackModel);
      return response;
    } catch (fallbackErr) {
      if (isAuthOrConfigError(fallbackErr)) {
        throw new Error(sanitizeGeminiErrorMessage(fallbackErr));
      }
      if (isRetryableGeminiError(fallbackErr)) {
        throw new GeminiUnavailableError();
      }
      throw new Error(sanitizeGeminiErrorMessage(fallbackErr));
    }
  }

  try {
    const response = await ai.models.generateContent({
      ...requestParams,
      model: primaryModel,
    });
    recordModelUsed(primaryModel);
    return response;
  } catch (err) {
    if (isAuthOrConfigError(err)) {
      throw new Error(sanitizeGeminiErrorMessage(err));
    }

    if (!canFallback || !isRetryableGeminiError(err)) {
      if (isRetryableGeminiError(err)) {
        throw new GeminiUnavailableError();
      }
      throw new Error(sanitizeGeminiErrorMessage(err));
    }

    const quotaHit = isQuotaExhaustedError(err);
    const reason = quotaHit ? 'Quota exhausted (429)' : 'Transient upstream failure';
    if (quotaHit) {
      const cooldownMs = isDailyQuotaError(err) ? DAILY_QUOTA_COOLDOWN_MS : RATE_LIMIT_COOLDOWN_MS;
      quotaExhaustedUntilByModel.set(primaryModel, {
        until: nowFn() + cooldownMs,
        reason,
      });
    }

    recordFallbackEvent(primaryModel, fallbackModel, reason);

    try {
      const fallbackResponse = await ai.models.generateContent(
        buildFallbackParams(requestParams, fallbackModel)
      );
      recordModelUsed(fallbackModel);
      return fallbackResponse;
    } catch (fallbackErr) {
      if (isAuthOrConfigError(fallbackErr)) {
        throw new Error(sanitizeGeminiErrorMessage(fallbackErr));
      }
      if (isRetryableGeminiError(fallbackErr)) {
        throw new GeminiUnavailableError();
      }
      throw new Error(sanitizeGeminiErrorMessage(fallbackErr));
    }
  }
}


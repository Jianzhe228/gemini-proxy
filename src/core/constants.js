// Helper functions
const getIntFromEnv = (envKey, defaultValue) => {
    const value = process.env[envKey];
    if (value === undefined || value === '') return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
};

const getBoolFromEnv = (envKey, defaultValue) => {
    const value = process.env[envKey];
    if (value === undefined || value === '') return defaultValue;
    return value.toLowerCase() === 'true';
};

// API Configuration
export const MAX_RETRIES = getIntFromEnv('MAX_RETRIES', 20);
export const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
export const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION || 'v1beta';
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
export const GEMINI_GENERATE_CONTENT_ENDPOINT = 'generateContent';

// Logging Configuration
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
export const LOG_PERFORMANCE_METRICS = getBoolFromEnv('LOG_PERFORMANCE_METRICS', false);

// HTTP status codes
export const HTTP_STATUS = {
    OK: 200,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    SERVICE_UNAVAILABLE: 503
};

// HTTP methods
export const HTTP_METHOD = {
    GET: 'GET',
    POST: 'POST',
    HEAD: 'HEAD',
    OPTIONS: 'OPTIONS'
};

// Content types
export const CONTENT_TYPE = {
    JSON: 'application/json',
    TEXT: 'text/plain'
};

// Header names
export const HEADERS = {
    CONTENT_TYPE: 'Content-Type',
    AUTHORIZATION: 'authorization',
    X_GOOG_API_KEY: 'x-goog-api-key',
    CACHE_CONTROL: 'Cache-Control',
    X_CACHE_STATUS: 'X-Cache-Status',
    X_REQUEST_ID: 'X-Request-ID'
};

// Auth patterns
export const BEARER_PREFIX_REGEX = /^Bearer\s+/i;

// Response messages
export const ERROR_MESSAGES = {
    INVALID_TEXT_LIST: 'Invalid text_list',
    MISSING_AUTH: 'Missing authentication',
    INVALID_CLIENT_KEY: 'Invalid client authentication key',
    INTERNAL: 'An internal error occurred',
    AUTH_REQUIRED: 'Authentication required',
    UNAUTHORIZED: 'The provided key is not authorized to use this service',
    NOT_FOUND: 'Endpoint not found',
    METHOD_NOT_ALLOWED: 'Method not allowed',
    TOO_MANY_REQUESTS: 'Too many requests',
    SERVICE_UNAVAILABLE: 'Service temporarily unavailable'
};

// Translation configuration
export const TRANSLATION_SYSTEM_INSTRUCTION = process.env.TRANSLATION_SYSTEM_INSTRUCTION ||
    "You are a highly skilled translator. Your task is to translate the given text accurately and naturally into the specified target language. Do not add any extra text, formatting, or explanations. Only provide the translated text.";

// API key logging configuration
export const API_KEY_LOG_LENGTH = 7;

// Cache configuration
export const CACHE = {
    DURATION: getIntFromEnv('CACHE_DURATION_SECONDS', 600) * 1000,
    TRANSLATION_TTL: getIntFromEnv('TRANSLATION_CACHE_TTL', 86400),
    INITIAL_VALUE: null,
    INITIAL_TIMESTAMP: 0,
    KEY_CACHE_SIZE: getIntFromEnv('KEY_CACHE_SIZE', 1000)
};

// Redis key constants 
export const REDIS_KEYS = {
    GEMINI_API_KEY_INDEX: 'GEMINI_API_KEY_INDEX',
    TRANSLATE_KEY_INDEX: 'TRANSLATE_KEY_INDEX',
    GEMINI_API_KEY_SET: 'GEMINI_API_KEY_SET',
    TRANSLATE_KEY_SET: 'TRANSLATE_KEY_SET',
    AUTH_SECRET_SET: 'AUTH_SECRET_SET',
    TRANSLATION_CACHE_PREFIX: 'translation:'
};

// Environment variable constants
export const ENV_VARS = {
    KV_REST_API_URL: 'KV_REST_API_URL',
    KV_REST_API_TOKEN: 'KV_REST_API_TOKEN'
};

// Performance configuration 
export const PERFORMANCE = {
    REQUEST_TIMEOUT: getIntFromEnv('REQUEST_TIMEOUT_MS', 20000),
    PARALLEL_TRANSLATION_LIMIT: getIntFromEnv('PARALLEL_TRANSLATION_LIMIT', 10),
    BATCH_DELAY: getIntFromEnv('BATCH_DELAY_MS', 50),
    REQUEST_DEDUP_TTL: getIntFromEnv('REQUEST_DEDUP_TTL_MS', 100)
};

// Provider configuration
export const PROVIDERS = {
    GEMINI: {
        NAME: 'gemini',
        BASE_URL: GEMINI_BASE_URL,
        API_VERSION: GEMINI_API_VERSION,
        DEFAULT_MODEL: GEMINI_MODEL,
        RATE_LIMIT: 60, // requests per minute
        TIMEOUT: PERFORMANCE.REQUEST_TIMEOUT
    }
};

// Provider route patterns
export const PROVIDER_ROUTES = {
    BASE: '/providers',
    GEMINI: '/providers/gemini'
};
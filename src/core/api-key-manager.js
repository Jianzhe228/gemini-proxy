import { Redis } from '@upstash/redis';
import {
  CACHE,
  REDIS_KEYS,
  ENV_VARS,
  API_KEY_LOG_LENGTH
} from './constants.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('ApiKeyManager');

// Cache variables
let cachedApiKeys = CACHE.INITIAL_VALUE;
let cachedTranslateKeys = CACHE.INITIAL_VALUE;
let cachedAuthSecrets = CACHE.INITIAL_VALUE;
let apiKeyCacheTimestamp = CACHE.INITIAL_TIMESTAMP;
let translateKeyCacheTimestamp = CACHE.INITIAL_TIMESTAMP;
let authSecretsCacheTimestamp = CACHE.INITIAL_TIMESTAMP;

// Loading locks to prevent thundering herd
let apiKeysLoadingPromise = null;
let translateKeysLoadingPromise = null;
let authSecretsLoadingPromise = null;

let redis;
if (process.env[ENV_VARS.KV_REST_API_URL] && process.env[ENV_VARS.KV_REST_API_TOKEN]) {
  redis = new Redis({
    url: process.env[ENV_VARS.KV_REST_API_URL],
    token: process.env[ENV_VARS.KV_REST_API_TOKEN],
  });
  logger.info('Redis client initialized successfully');
} else {
  logger.warn('Redis client not initialized - missing environment variables');
}

async function loadApiKeys(keySet, cache, cacheTimestamp, loadingPromise, setLoadingPromise) {
  const now = Date.now();
  
  // Check if cache is still valid
  if (cache.value !== CACHE.INITIAL_VALUE && (now - cacheTimestamp.value) < CACHE.DURATION) {
    logger.debug(`Using cached keys for ${keySet}, cache age: ${now - cacheTimestamp.value}ms`);
    return cache.value;
  }

  // Check if another request is already loading
  if (loadingPromise.value) {
    logger.debug(`Waiting for another request to load ${keySet}`);
    try {
      const result = await loadingPromise.value;
      return result;
    } catch (error) {
      // If the loading failed, we'll try again
      logger.warn(`Previous loading attempt failed for ${keySet}, retrying`);
    }
  }

  // Create a new loading promise
  const loadPromise = (async () => {
    try {
      if (!redis) {
        const error = "Redis client is not initialized";
        logger.error(error);
        throw new Error(error);
      }

      logger.info(`Loading API keys from Redis set: ${keySet}`);
      const keys = await redis.smembers(keySet);
      if (!keys || keys.length === 0) {
        const error = `No API keys found in Redis set "${keySet}"`;
        logger.error(error);
        throw new Error(error);
      }

      logger.info(`Loaded ${keys.length} API keys from ${keySet}`);
      cache.value = keys;
      cacheTimestamp.value = Date.now();
      return keys;
    } finally {
      // Clear the loading promise after completion (success or failure)
      setLoadingPromise(null);
    }
  })();

  // Set the loading promise
  setLoadingPromise(loadPromise);
  
  try {
    const result = await loadPromise;
    return result;
  } catch (error) {
    // Re-throw the error after the promise is cleared
    throw error;
  }
}

async function loadTranslateKeys() {
  const cache = { value: cachedTranslateKeys };
  const timestamp = { value: translateKeyCacheTimestamp };
  const loadingPromise = { value: translateKeysLoadingPromise };
  
  const keys = await loadApiKeys(
    REDIS_KEYS.TRANSLATE_KEY_SET, 
    cache, 
    timestamp,
    loadingPromise,
    (promise) => { translateKeysLoadingPromise = promise; }
  );
  
  cachedTranslateKeys = cache.value;
  translateKeyCacheTimestamp = timestamp.value;
  return keys;
}

async function loadGeminiApiKeys() {
  const cache = { value: cachedApiKeys };
  const timestamp = { value: apiKeyCacheTimestamp };
  const loadingPromise = { value: apiKeysLoadingPromise };
  
  const keys = await loadApiKeys(
    REDIS_KEYS.GEMINI_API_KEY_SET, 
    cache, 
    timestamp,
    loadingPromise,
    (promise) => { apiKeysLoadingPromise = promise; }
  );
  
  cachedApiKeys = cache.value;
  apiKeyCacheTimestamp = timestamp.value;
  return keys;
}

async function loadAuthSecrets() {
  const now = Date.now();
  
  // Check if cache is still valid
  if (cachedAuthSecrets !== CACHE.INITIAL_VALUE && (now - authSecretsCacheTimestamp) < CACHE.DURATION) {
    logger.debug(`Using cached auth secrets, cache age: ${now - authSecretsCacheTimestamp}ms`);
    return cachedAuthSecrets;
  }

  // Check if another request is already loading
  if (authSecretsLoadingPromise) {
    logger.debug('Waiting for another request to load auth secrets');
    try {
      const result = await authSecretsLoadingPromise;
      return result;
    } catch (error) {
      logger.warn('Previous loading attempt failed for auth secrets, retrying');
    }
  }

  // Create a new loading promise
  authSecretsLoadingPromise = (async () => {
    try {
      if (!redis) {
        logger.warn('Redis not available for loading auth secrets');
        cachedAuthSecrets = [];
        authSecretsCacheTimestamp = Date.now();
        return [];
      }

      logger.info('Loading auth secrets from Redis');
      const keys = await redis.smembers(REDIS_KEYS.AUTH_SECRET_SET);
      
      if (!keys) {
        cachedAuthSecrets = [];
      } else {
        cachedAuthSecrets = keys;
      }

      logger.info(`Loaded ${cachedAuthSecrets?.length || 0} auth secrets`);
      authSecretsCacheTimestamp = Date.now();
      return cachedAuthSecrets;
    } finally {
      // Clear the loading promise after completion
      authSecretsLoadingPromise = null;
    }
  })();

  try {
    const result = await authSecretsLoadingPromise;
    return result;
  } catch (error) {
    // Re-throw the error after the promise is cleared
    throw error;
  }
}

export async function getNextTranslateKey() {
  const translateKeys = await loadTranslateKeys();

  if (!translateKeys || translateKeys.length === 0) {
    const error = 'No Translate API keys available';
    logger.error(error);
    throw new Error(error);
  }

  const counter = await redis.incr(REDIS_KEYS.TRANSLATE_KEY_INDEX);
  const index = (counter - 1) % translateKeys.length;
  logger.debug(`Selected Translate API key at index ${index}`);
  return translateKeys[index];
}

export async function getNextGeminiApiKey() {
  const apiKeys = await loadGeminiApiKeys();

  if (!apiKeys || apiKeys.length === 0) {
    const error = 'No Gemini API keys available';
    logger.error(error);
    throw new Error(error);
  }

  const counter = await redis.incr(REDIS_KEYS.GEMINI_API_KEY_INDEX);
  const index = (counter - 1) % apiKeys.length;
  logger.debug(`Selected Gemini API key at index ${index}`);
  return apiKeys[index];
}

export async function validateClientKey(authKey) {
  const startTime = Date.now();

  // First check cache
  const authSecrets = await loadAuthSecrets();
  if (authSecrets && authSecrets.includes(authKey)) {
    logger.debug(`Auth key ${authKey.slice(0, API_KEY_LOG_LENGTH)}... validated from cache (${Date.now() - startTime}ms)`);
    return true;
  }

  // If not in cache, check Redis
  if (redis) {
    const isMember = await redis.sismember(REDIS_KEYS.AUTH_SECRET_SET, authKey);
    if (isMember) {
      // Update cache with proper locking
      if (cachedAuthSecrets !== CACHE.INITIAL_VALUE) {
        // Only update if cache is already initialized
        if (!cachedAuthSecrets.includes(authKey)) {
          cachedAuthSecrets = [...cachedAuthSecrets, authKey];
          logger.info(`Auth key ${authKey.slice(0, API_KEY_LOG_LENGTH)}... added to cache (${Date.now() - startTime}ms)`);
        }
      }
      return true;
    }
  }

  // Default deny: return false if Redis unavailable or key doesn't exist
  logger.warn(`Auth key ${authKey.slice(0, API_KEY_LOG_LENGTH)}... validation failed (${Date.now() - startTime}ms)`);
  return false;
}

export async function removeApiKey(keyToRemove, keySet) {
  if (!redis) {
    logger.warn("Redis client not initialized. Cannot remove API key.");
    return;
  }

  // Invalidate cache to force reload on next request
  if (keySet === REDIS_KEYS.GEMINI_API_KEY_SET) {
    if (cachedApiKeys !== CACHE.INITIAL_VALUE) {
      const index = cachedApiKeys.indexOf(keyToRemove);
      if (index > -1) {
        cachedApiKeys = cachedApiKeys.filter(key => key !== keyToRemove);
        logger.info(`Removed API key ${keyToRemove.slice(0, API_KEY_LOG_LENGTH)}... from Gemini cache`);
      }
    }
  } else if (keySet === REDIS_KEYS.TRANSLATE_KEY_SET) {
    if (cachedTranslateKeys !== CACHE.INITIAL_VALUE) {
      const index = cachedTranslateKeys.indexOf(keyToRemove);
      if (index > -1) {
        cachedTranslateKeys = cachedTranslateKeys.filter(key => key !== keyToRemove);
        logger.info(`Removed API key ${keyToRemove.slice(0, API_KEY_LOG_LENGTH)}... from Translate cache`);
      }
    }
  }

  try {
    await redis.srem(keySet, keyToRemove);
    logger.info(`Removed API key ${keyToRemove.slice(0, API_KEY_LOG_LENGTH)}... from Redis set ${keySet}`);
  } catch (error) {
    logger.error(`Failed to remove API key ${keyToRemove.slice(0, API_KEY_LOG_LENGTH)}... from Redis set ${keySet}:`, error.message);
  }
}

export async function removeTranslateKey(keyToRemove) {
  return removeApiKey(keyToRemove, REDIS_KEYS.TRANSLATE_KEY_SET);
}

export async function removeGeminiApiKey(keyToRemove) {
  return removeApiKey(keyToRemove, REDIS_KEYS.GEMINI_API_KEY_SET);
}

// Export function to clear all caches (useful for testing or manual refresh)
export function clearAllCaches() {
  cachedApiKeys = CACHE.INITIAL_VALUE;
  cachedTranslateKeys = CACHE.INITIAL_VALUE;
  cachedAuthSecrets = CACHE.INITIAL_VALUE;
  apiKeyCacheTimestamp = CACHE.INITIAL_TIMESTAMP;
  translateKeyCacheTimestamp = CACHE.INITIAL_TIMESTAMP;
  authSecretsCacheTimestamp = CACHE.INITIAL_TIMESTAMP;
  apiKeysLoadingPromise = null;
  translateKeysLoadingPromise = null;
  authSecretsLoadingPromise = null;
  logger.info('All caches cleared');
}
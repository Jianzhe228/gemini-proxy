import { Redis } from '@upstash/redis';
import {
  CACHE,
  REDIS_KEYS,
  ENV_VARS,
  API_KEY_LOG_LENGTH
} from './constants.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('ApiKeyManager');

class ApiKeyCache {
  constructor(keySet, duration = CACHE.DURATION) {
    this.keySet = keySet;
    this.duration = duration;
    this.cache = null;
    this.timestamp = 0;
    this.loadingPromise = null;
  }

  isValid() {
    return this.cache !== null && (Date.now() - this.timestamp) < this.duration;
  }

  async load(redis) {
    if (this.isValid()) {
      logger.debug(`Using cached keys for ${this.keySet}, cache age: ${Date.now() - this.timestamp}ms`);
      return this.cache;
    }

    if (this.loadingPromise) {
      logger.debug(`Waiting for another request to load ${this.keySet}`);
      try {
        return await this.loadingPromise;
      } catch (error) {
        logger.warn(`Previous loading attempt failed for ${this.keySet}, retrying`);
      }
    }

    this.loadingPromise = this._loadFromRedis(redis);
    try {
      const result = await this.loadingPromise;
      return result;
    } finally {
      this.loadingPromise = null;
    }
  }

  async _loadFromRedis(redis) {
    if (!redis) {
      const error = "Redis client is not initialized";
      logger.error(error);
      throw new Error(error);
    }

    logger.info(`Loading API keys from Redis set: ${this.keySet}`);
    const keys = await redis.smembers(this.keySet);

    if (!keys || keys.length === 0) {
      const error = `No API keys found in Redis set "${this.keySet}"`;
      logger.error(error);
      throw new Error(error);
    }

    logger.info(`Loaded ${keys.length} API keys from ${this.keySet}`);
    this.cache = keys;
    this.timestamp = Date.now();
    return keys;
  }

  invalidate() {
    this.cache = null;
    this.timestamp = 0;
  }

  removeKey(key) {
    if (this.cache && Array.isArray(this.cache)) {
      this.cache = this.cache.filter(k => k !== key);
    }
  }
}

class ApiKeyManager {
  constructor() {
    this.redis = this._initRedis();
    this.caches = {
      gemini: new ApiKeyCache(REDIS_KEYS.GEMINI_API_KEY_SET),
      translate: new ApiKeyCache(REDIS_KEYS.TRANSLATE_KEY_SET),
      auth: new ApiKeyCache(REDIS_KEYS.AUTH_SECRET_SET, CACHE.DURATION * 2)
    };
    this.counters = new Map();
    this.counterSyncInterval = 100;
  }

  _initRedis() {
    if (process.env[ENV_VARS.KV_REST_API_URL] && process.env[ENV_VARS.KV_REST_API_TOKEN]) {
      const redis = new Redis({
        url: process.env[ENV_VARS.KV_REST_API_URL],
        token: process.env[ENV_VARS.KV_REST_API_TOKEN],
      });
      logger.info('Redis client initialized successfully');
      return redis;
    }
    logger.warn('Redis client not initialized - missing environment variables');
    return null;
  }

  async getNextKey(type, indexKey) {
    const cache = this.caches[type];
    if (!cache) {
      throw new Error(`Unknown key type: ${type}`);
    }

    const keys = await cache.load(this.redis);

    let counter = this.counters.get(indexKey) || 0;
    counter = (counter + 1) % keys.length;
    this.counters.set(indexKey, counter);

    if (counter % this.counterSyncInterval === 0) {
      Promise.resolve().then(async () => {
        try {
          await this.redis.set(indexKey, counter);
        } catch (error) {
          logger.warn(`Failed to sync counter ${indexKey}: ${error.message}`);
        }
      });
    }

    const selectedKey = keys[counter];
    logger.debug(`Selected ${type} API key at index ${counter}`);
    return selectedKey;
  }

  async getNextGeminiApiKey() {
    return this.getNextKey('gemini', REDIS_KEYS.GEMINI_API_KEY_INDEX);
  }

  async getNextTranslateKey() {
    return this.getNextKey('translate', REDIS_KEYS.TRANSLATE_KEY_INDEX);
  }

  async validateClientKey(authKey) {
    const startTime = Date.now();

    // First check cache
    const authCache = this.caches.auth;
    try {
      const authSecrets = await authCache.load(this.redis);
      if (authSecrets && authSecrets.includes(authKey)) {
        logger.debug(`Auth key ${authKey.slice(0, API_KEY_LOG_LENGTH)}... validated from cache (${Date.now() - startTime}ms)`);
        return true;
      }
    } catch (error) {
      // If cache fails, continue to check Redis directly
      logger.warn(`Auth cache load failed: ${error.message}`);
    }

    // If not in cache, check Redis directly
    if (this.redis) {
      try {
        const isMember = await this.redis.sismember(REDIS_KEYS.AUTH_SECRET_SET, authKey);
        if (isMember) {
          // Update cache
          if (authCache.cache && Array.isArray(authCache.cache)) {
            if (!authCache.cache.includes(authKey)) {
              authCache.cache.push(authKey);
              logger.info(`Auth key ${authKey.slice(0, API_KEY_LOG_LENGTH)}... added to cache`);
            }
          }
          return true;
        }
      } catch (error) {
        logger.error(`Redis auth check failed: ${error.message}`);
      }
    }

    logger.warn(`Auth key ${authKey.slice(0, API_KEY_LOG_LENGTH)}... validation failed (${Date.now() - startTime}ms)`);
    return false;
  }

  async removeApiKey(keyToRemove, type) {
    const cache = this.caches[type];
    if (!cache) {
      logger.warn(`Unknown key type: ${type}`);
      return;
    }

    // Remove from cache
    cache.removeKey(keyToRemove);
    logger.info(`Removed API key ${keyToRemove.slice(0, API_KEY_LOG_LENGTH)}... from ${type} cache`);

    // Remove from Redis
    if (this.redis) {
      try {
        const keySet = type === 'gemini' ? REDIS_KEYS.GEMINI_API_KEY_SET : REDIS_KEYS.TRANSLATE_KEY_SET;
        await this.redis.srem(keySet, keyToRemove);
        logger.info(`Removed API key from Redis set ${keySet}`);
      } catch (error) {
        logger.error(`Failed to remove API key from Redis: ${error.message}`);
      }
    }
  }

  async removeGeminiApiKey(keyToRemove) {
    return this.removeApiKey(keyToRemove, 'gemini');
  }

  async removeTranslateKey(keyToRemove) {
    return this.removeApiKey(keyToRemove, 'translate');
  }

  clearAllCaches() {
    Object.values(this.caches).forEach(cache => cache.invalidate());
    this.counters.clear();
    logger.info('All caches cleared');
  }
}

// Singleton instance
const apiKeyManager = new ApiKeyManager();

export const getNextGeminiApiKey = () => apiKeyManager.getNextGeminiApiKey();
export const getNextTranslateKey = () => apiKeyManager.getNextTranslateKey();
export const validateClientKey = (authKey) => apiKeyManager.validateClientKey(authKey);
export const removeGeminiApiKey = (key) => apiKeyManager.removeGeminiApiKey(key);
export const removeTranslateKey = (key) => apiKeyManager.removeTranslateKey(key);
export const clearAllCaches = () => apiKeyManager.clearAllCaches();
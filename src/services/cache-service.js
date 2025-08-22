import { Redis } from '@upstash/redis';
import { REDIS_KEYS, CACHE, ENV_VARS } from '../core/constants.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('CacheService');

class CacheService {
    constructor() {
        this.redis = null;
        this.keyCache = new Map();
        this.maxKeyCacheSize = CACHE.KEY_CACHE_SIZE;
        this.initRedis();
    }

    initRedis() {
        if (process.env[ENV_VARS.KV_REST_API_URL] && process.env[ENV_VARS.KV_REST_API_TOKEN]) {
            this.redis = new Redis({
                url: process.env[ENV_VARS.KV_REST_API_URL],
                token: process.env[ENV_VARS.KV_REST_API_TOKEN],
            });
            logger.info('Translation cache initialized');
        } else {
            logger.warn('Translation cache not available - missing Redis configuration');
        }
    }

    async generateCacheKey(text, sourceLang, targetLang) {
        const cacheIdentifier = `${text}|${sourceLang || 'auto'}|${targetLang}`;

        // Check local cache
        if (this.keyCache.has(cacheIdentifier)) {
            return this.keyCache.get(cacheIdentifier);
        }

        let key;

        // For short texts, use direct encoding
        if (cacheIdentifier.length < 100) {
            const encoder = new TextEncoder();
            const data = encoder.encode(cacheIdentifier);
            const base64 = btoa(String.fromCharCode(...data))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=/g, '');
            key = `${REDIS_KEYS.TRANSLATION_CACHE_PREFIX}${base64}`;
        } else {
            // For long texts, use SHA-1 (faster than SHA-256)
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(cacheIdentifier);
            const hashBuffer = await crypto.subtle.digest('SHA-1', dataBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            key = `${REDIS_KEYS.TRANSLATION_CACHE_PREFIX}${hashHex}`;
        }

        // Maintain cache size with LRU eviction
        if (this.keyCache.size >= this.maxKeyCacheSize) {
            const firstKey = this.keyCache.keys().next().value;
            this.keyCache.delete(firstKey);
        }

        this.keyCache.set(cacheIdentifier, key);
        return key;
    }

    async get(text, sourceLang, targetLang) {
        if (!this.redis) return null;

        try {
            const key = await this.generateCacheKey(text, sourceLang, targetLang);
            const cached = await this.redis.get(key);

            if (cached) {
                logger.debug(`Cache hit for translation: ${key.substring(0, 30)}...`);
                return typeof cached === 'string' ? JSON.parse(cached) : cached;
            }

            logger.debug(`Cache miss for translation: ${key.substring(0, 30)}...`);
            return null;
        } catch (error) {
            logger.error('Error getting cached translation:', error.message);
            return null;
        }
    }

    async set(text, sourceLang, targetLang, translation) {
        if (!this.redis) return;

        try {
            const key = await this.generateCacheKey(text, sourceLang, targetLang);
            await this.redis.set(
                key,
                JSON.stringify(translation),
                { ex: CACHE.TRANSLATION_TTL }
            );
            logger.debug(`Cached translation: ${key.substring(0, 30)}...`);
        } catch (error) {
            logger.error('Error caching translation:', error.message);
        }
    }

    async getMultiple(texts, sourceLang, targetLang) {
        if (!this.redis) return new Map();

        const results = new Map();

        try {
            // Generate all keys
            const keyPromises = texts.map(text =>
                this.generateCacheKey(text, sourceLang, targetLang)
                    .then(key => ({ text, key }))
            );

            const keys = await Promise.all(keyPromises);
            const keyArray = keys.map(k => k.key);

            // Use mget for batch retrieval
            const values = await this.redis.mget(...keyArray);

            keys.forEach(({ text }, index) => {
                const value = values[index];
                if (value) {
                    try {
                        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
                        results.set(text, parsed);
                        logger.debug(`Cache hit for batch item ${index}`);
                    } catch (error) {
                        logger.warn(`Failed to parse cached value for item ${index}`);
                    }
                }
            });

            logger.info(`Cache hits: ${results.size}/${texts.length}`);
        } catch (error) {
            logger.error('Error getting multiple cached translations:', error.message);
        }

        return results;
    }

    async setMultiple(translations, sourceLang, targetLang) {
        if (!this.redis) return;

        try {
            const pipeline = this.redis.pipeline();

            for (const { text, translation } of translations) {
                const key = await this.generateCacheKey(text, sourceLang, targetLang);
                pipeline.set(key, JSON.stringify(translation), { ex: CACHE.TRANSLATION_TTL });
            }

            await pipeline.exec();
            logger.debug(`Cached ${translations.length} translations`);
        } catch (error) {
            logger.error('Error caching multiple translations:', error.message);
        }
    }

    clearLocalCache() {
        this.keyCache.clear();
        logger.debug('Local key cache cleared');
    }
}

export const cacheService = new CacheService();
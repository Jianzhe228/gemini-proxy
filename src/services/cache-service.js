import { Redis } from '@upstash/redis';
import { REDIS_KEYS, CACHE, ENV_VARS } from '../core/constants.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('CacheService');

class CacheService {
    constructor() {
        this.redis = null;
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

    /**
     * Generate cache key using Web Crypto API (Edge Runtime compatible)
     */
    async generateCacheKey(text, sourceLang, targetLang) {
        const data = `${text}|${sourceLang || 'auto'}|${targetLang}`;

        // Use Web Crypto API instead of Node.js crypto
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);

        // Convert buffer to hex string
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        return `${REDIS_KEYS.TRANSLATION_CACHE_PREFIX}${hashHex}`;
    }

    async get(text, sourceLang, targetLang) {
        if (!this.redis) return null;

        try {
            const key = await this.generateCacheKey(text, sourceLang, targetLang);
            const cached = await this.redis.get(key);

            if (cached) {
                logger.debug(`Cache hit for translation: ${key.substring(0, 20)}...`);
                return JSON.parse(cached);
            }

            logger.debug(`Cache miss for translation: ${key.substring(0, 20)}...`);
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
            logger.debug(`Cached translation: ${key.substring(0, 20)}...`);
        } catch (error) {
            logger.error('Error caching translation:', error.message);
        }
    }

    async getMultiple(texts, sourceLang, targetLang) {
        if (!this.redis) return new Map();

        const results = new Map();
        const pipeline = this.redis.pipeline();

        // Generate keys asynchronously
        const keyPromises = texts.map(async text => {
            const key = await this.generateCacheKey(text, sourceLang, targetLang);
            return { text, key };
        });

        const keys = await Promise.all(keyPromises);

        keys.forEach(({ key }) => {
            pipeline.get(key);
        });

        try {
            const values = await pipeline.exec();
            keys.forEach(({ text, key }, index) => {
                const value = values[index];
                if (value) {
                    logger.debug(`Cache hit for batch translation: ${key.substring(0, 20)}...`);
                    results.set(text, JSON.parse(value));
                }
            });
        } catch (error) {
            logger.error('Error getting multiple cached translations:', error.message);
        }

        return results;
    }

    async setMultiple(translations, sourceLang, targetLang) {
        if (!this.redis) return;

        const pipeline = this.redis.pipeline();

        // Generate keys asynchronously
        const keyPromises = translations.map(async ({ text, translation }) => {
            const key = await this.generateCacheKey(text, sourceLang, targetLang);
            return { key, translation };
        });

        const keysAndTranslations = await Promise.all(keyPromises);

        keysAndTranslations.forEach(({ key, translation }) => {
            pipeline.set(key, JSON.stringify(translation), { ex: CACHE.TRANSLATION_TTL });
        });

        try {
            await pipeline.exec();
            logger.debug(`Cached ${translations.length} translations`);
        } catch (error) {
            logger.error('Error caching multiple translations:', error.message);
        }
    }
}

export const cacheService = new CacheService();
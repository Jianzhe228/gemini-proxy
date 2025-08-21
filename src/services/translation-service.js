import { getNextTranslateKey, removeTranslateKey, validateClientKey } from '../core/api-key-manager.js';
import { fetchWithRetry } from '../utils/fetch-retry.js';
import { cacheService } from './cache-service.js';
import { Semaphore } from '../utils/semaphore.js';
import { Logger } from '../utils/logger.js';
import {
    GEMINI_BASE_URL,
    GEMINI_API_VERSION,
    GEMINI_MODEL,
    GEMINI_GENERATE_CONTENT_ENDPOINT,
    HTTP_STATUS,
    HTTP_METHOD,
    CONTENT_TYPE,
    HEADERS,
    ERROR_MESSAGES,
    TRANSLATION_SYSTEM_INSTRUCTION,
    PERFORMANCE
} from '../core/constants.js';

const logger = new Logger('TranslationService');

// Edge Runtime compatible async scheduler
const scheduleAsync = (fn) => {
    if (typeof queueMicrotask !== 'undefined') {
        queueMicrotask(fn);
    } else {
        Promise.resolve().then(fn);
    }
};

class TranslationService {
    constructor() {
        this.semaphore = new Semaphore(PERFORMANCE.PARALLEL_TRANSLATION_LIMIT);
    }

    async translateSingleText(text, targetLang, sourceLang) {
        const startTime = Date.now();

        // Check cache first
        const cached = await cacheService.get(text, sourceLang, targetLang);
        if (cached) {
            logger.debug(`Translation retrieved from cache in ${Date.now() - startTime}ms`);
            return cached;
        }

        logger.debug(`Translating text (length: ${text.length}) to ${targetLang}`);

        const prompt = sourceLang && sourceLang !== 'auto'
            ? `Translate from ${sourceLang} to ${targetLang}: "${text}"`
            : `Translate to ${targetLang}: "${text}"`;

        const geminiBody = {
            contents: [{ parts: [{ text: prompt }] }],
            system_instruction: {
                parts: [{ text: TRANSLATION_SYSTEM_INSTRUCTION }]
            }
        };

        const response = await fetchWithRetry({
            getApiKey: getNextTranslateKey,
            removeApiKey: removeTranslateKey,
            buildRequest: (selectedKey) => {
                const geminiUrl = `${GEMINI_BASE_URL}/${GEMINI_API_VERSION}/models/${GEMINI_MODEL}:${GEMINI_GENERATE_CONTENT_ENDPOINT}`;
                return {
                    url: `${geminiUrl}?key=${selectedKey}`,
                    requestOptions: {
                        method: HTTP_METHOD.POST,
                        headers: { [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON },
                        body: JSON.stringify(geminiBody),
                        signal: AbortSignal.timeout(PERFORMANCE.REQUEST_TIMEOUT)
                    }
                };
            },
            validateResponse: async (response) => {
                if (!response.ok) return false;
                try {
                    const geminiData = await response.json();
                    const textFromApi = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
                    return !!textFromApi;
                } catch (e) {
                    return false;
                }
            }
        });

        if (response && response.ok) {
            try {
                const geminiData = await response.json();
                const textFromApi = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
                if (textFromApi) {
                    const result = {
                        detected_source_lang: sourceLang || 'auto',
                        text: textFromApi.trim()
                    };

                    // Cache the successful translation asynchronously
                    scheduleAsync(() => {
                        cacheService.set(text, sourceLang, targetLang, result)
                            .catch(err => logger.warn('Failed to cache translation:', err.message));
                    });

                    logger.debug(`Translation completed in ${Date.now() - startTime}ms`);
                    return result;
                }
            } catch (e) {
                logger.error('Failed to parse translation response:', e.message);
            }
        }

        logger.error(`Translation failed after ${Date.now() - startTime}ms. Status: ${response?.status || 'unknown'}`);
        return {
            detected_source_lang: sourceLang || 'unknown',
            text: text // Return original text on failure
        };
    }

    async translateWithSemaphore(text, targetLang, sourceLang) {
        await this.semaphore.acquire();
        try {
            return await this.translateSingleText(text, targetLang, sourceLang);
        } finally {
            this.semaphore.release();
        }
    }

    async translateBatch(textList, targetLang, sourceLang) {
        const startTime = Date.now();

        // Deduplicate texts
        const uniqueTexts = [...new Set(textList)];
        const textToIndices = new Map();

        textList.forEach((text, index) => {
            if (!textToIndices.has(text)) {
                textToIndices.set(text, []);
            }
            textToIndices.get(text).push(index);
        });

        // Check cache for all unique texts
        const cachedTranslations = await cacheService.getMultiple(uniqueTexts, sourceLang, targetLang);

        const textsToTranslate = uniqueTexts.filter(text => !cachedTranslations.has(text));

        logger.info(`Cache status: ${cachedTranslations.size}/${uniqueTexts.length} hits`);

        // Translate non-cached texts
        if (textsToTranslate.length > 0) {
            const translations = await Promise.all(
                textsToTranslate.map(text =>
                    this.translateWithSemaphore(text, targetLang, sourceLang)
                )
            );

            // Add new translations to cache map
            textsToTranslate.forEach((text, idx) => {
                cachedTranslations.set(text, translations[idx]);
            });

            // Cache new translations asynchronously
            scheduleAsync(() => {
                const toCache = textsToTranslate.map((text, idx) => ({
                    text,
                    translation: translations[idx]
                }));
                cacheService.setMultiple(toCache, sourceLang, targetLang)
                    .catch(err => logger.warn('Failed to cache batch translations:', err.message));
            });
        }

        // Build results array maintaining original order
        const results = new Array(textList.length);
        for (const [text, indices] of textToIndices) {
            const translation = cachedTranslations.get(text);
            indices.forEach(index => {
                results[index] = translation;
            });
        }

        logger.info(`Batch translation completed in ${Date.now() - startTime}ms for ${textList.length} texts (${uniqueTexts.length} unique)`);
        return results;
    }
}

const translationService = new TranslationService();

export async function handleTranslate(request) {
    const startTime = Date.now();
    const requestId = request.requestId || 'unknown';

    try {
        // Validate auth key from URL param
        const authKey = request.params?.authKey;
        if (!authKey) {
            return new Response(JSON.stringify({
                error: ERROR_MESSAGES.MISSING_AUTH,
                message: ERROR_MESSAGES.AUTH_REQUIRED,
                requestId: requestId
            }), {
                status: HTTP_STATUS.UNAUTHORIZED,
                headers: {
                    [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
                    [HEADERS.X_REQUEST_ID]: requestId
                }
            });
        }

        const isValid = await validateClientKey(authKey);
        if (!isValid) {
            return new Response(JSON.stringify({
                error: ERROR_MESSAGES.INVALID_CLIENT_KEY,
                message: ERROR_MESSAGES.UNAUTHORIZED,
                requestId: requestId
            }), {
                status: HTTP_STATUS.UNAUTHORIZED,
                headers: {
                    [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
                    [HEADERS.X_REQUEST_ID]: requestId
                }
            });
        }

        const body = await request.json();
        const { source_lang, target_lang, text_list } = body;

        logger.info(`[${requestId}] Translation request: ${text_list?.length || 0} texts from ${source_lang || 'auto'} to ${target_lang}`);

        // Validate input
        if (!text_list || !Array.isArray(text_list)) {
            logger.warn(`[${requestId}] Invalid text_list in translation request`);
            return new Response(JSON.stringify({
                error: ERROR_MESSAGES.INVALID_TEXT_LIST,
                message: 'text_list must be an array of strings',
                requestId: requestId
            }), {
                status: HTTP_STATUS.BAD_REQUEST,
                headers: {
                    [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
                    [HEADERS.X_REQUEST_ID]: requestId
                }
            });
        }

        if (!target_lang) {
            return new Response(JSON.stringify({
                error: 'Missing target_lang',
                message: 'target_lang is required',
                requestId: requestId
            }), {
                status: HTTP_STATUS.BAD_REQUEST,
                headers: {
                    [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
                    [HEADERS.X_REQUEST_ID]: requestId
                }
            });
        }

        // Limit batch size
        if (text_list.length > 100) {
            return new Response(JSON.stringify({
                error: 'Batch too large',
                message: 'Maximum batch size is 100 texts',
                requestId: requestId
            }), {
                status: HTTP_STATUS.BAD_REQUEST,
                headers: {
                    [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
                    [HEADERS.X_REQUEST_ID]: requestId
                }
            });
        }

        // Use batch translation with cache
        const translations = await translationService.translateBatch(text_list, target_lang, source_lang);

        logger.info(`[${requestId}] Translation completed in ${Date.now() - startTime}ms for ${text_list.length} texts`);

        return new Response(JSON.stringify({ translations }), {
            status: HTTP_STATUS.OK,
            headers: {
                [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
                [HEADERS.X_REQUEST_ID]: requestId
            }
        });

    } catch (error) {
        logger.error(`[${requestId}] Translation handler error after ${Date.now() - startTime}ms:`, error.message);
        return new Response(JSON.stringify({
            error: ERROR_MESSAGES.INTERNAL,
            message: 'Failed to process translation request',
            requestId: requestId
        }), {
            status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
            headers: {
                [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
                [HEADERS.X_REQUEST_ID]: requestId
            }
        });
    }
}
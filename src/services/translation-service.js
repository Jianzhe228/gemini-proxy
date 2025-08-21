import { getNextTranslateKey, removeTranslateKey, validateClientKey } from '../core/api-key-manager.js';
import { fetchWithRetry } from '../utils/fetch-retry.js';
import { cacheService } from './cache-service.js';
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

async function processInChunks(array, processor, chunkSize) {
    const results = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        const chunk = array.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(chunk.map(processor));
        results.push(...chunkResults);
    }
    return results;
}

async function translateSingleText(text, target_lang, source_lang) {
    const startTime = Date.now();
    
    // Check cache first
    const cached = await cacheService.get(text, source_lang, target_lang);
    if (cached) {
        logger.debug(`Translation retrieved from cache in ${Date.now() - startTime}ms`);
        return cached;
    }

    logger.debug(`Translating text (length: ${text.length}) to ${target_lang}`);

    const prompt = source_lang && source_lang !== 'auto' 
        ? `Translate from ${source_lang} to ${target_lang}: "${text}"`
        : `Translate to ${target_lang}: "${text}"`;

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
                    detected_source_lang: source_lang || 'auto',
                    text: textFromApi.trim()
                };
                
                // Cache the successful translation
                await cacheService.set(text, source_lang, target_lang, result);
                
                logger.debug(`Translation completed in ${Date.now() - startTime}ms`);
                return result;
            }
        } catch (e) {
            logger.error('Failed to parse translation response:', e.message);
        }
    }

    logger.error(`Translation failed after ${Date.now() - startTime}ms. Status: ${response?.status || 'unknown'}`);
    return {
        detected_source_lang: source_lang || 'unknown',
        text: `Error: Failed to translate. Status: ${response?.status || 'unknown'}`
    };
}

async function translateBatch(textList, targetLang, sourceLang) {
    const startTime = Date.now();
    
    // Check cache for all texts
    const cachedTranslations = await cacheService.getMultiple(textList, sourceLang, targetLang);
    
    const results = [];
    const textsToTranslate = [];
    const indexMap = new Map();

    // Separate cached and non-cached texts
    textList.forEach((text, index) => {
        const cached = cachedTranslations.get(text);
        if (cached) {
            results[index] = cached;
        } else {
            textsToTranslate.push(text);
            indexMap.set(text, index);
        }
    });

    logger.info(`Cache status: ${cachedTranslations.size}/${textList.length} hits`);

    // Translate non-cached texts
    if (textsToTranslate.length > 0) {
        let translations;
        
        if (textsToTranslate.length <= PERFORMANCE.PARALLEL_TRANSLATION_LIMIT) {
            translations = await Promise.all(
                textsToTranslate.map(text => translateSingleText(text, targetLang, sourceLang))
            );
        } else {
            translations = await processInChunks(
                textsToTranslate,
                text => translateSingleText(text, targetLang, sourceLang),
                PERFORMANCE.PARALLEL_TRANSLATION_LIMIT
            );
        }

        // Place translations in correct positions
        textsToTranslate.forEach((text, idx) => {
            const originalIndex = indexMap.get(text);
            results[originalIndex] = translations[idx];
        });

        // Cache new translations
        const toCache = textsToTranslate.map((text, idx) => ({
            text,
            translation: translations[idx]
        }));
        await cacheService.setMultiple(toCache, sourceLang, targetLang);
    }

    logger.info(`Batch translation completed in ${Date.now() - startTime}ms`);
    return results;
}

export async function handleTranslate(request) {
    const startTime = Date.now();

    try {
        // Validate auth key from URL param
        const authKey = request.params?.authKey;
        if (!authKey) {
            return new Response(JSON.stringify({ 
                error: ERROR_MESSAGES.MISSING_AUTH,
                message: ERROR_MESSAGES.AUTH_REQUIRED
            }), {
                status: HTTP_STATUS.UNAUTHORIZED,
                headers: { [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON }
            });
        }

        const isValid = await validateClientKey(authKey);
        if (!isValid) {
            return new Response(JSON.stringify({
                error: ERROR_MESSAGES.INVALID_CLIENT_KEY,
                message: ERROR_MESSAGES.UNAUTHORIZED
            }), {
                status: HTTP_STATUS.UNAUTHORIZED,
                headers: { [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON }
            });
        }

        const { source_lang, target_lang, text_list } = await request.json();

        logger.info(`Translation request: ${text_list?.length || 0} texts from ${source_lang || 'auto'} to ${target_lang}`);

        if (!text_list || !Array.isArray(text_list)) {
            logger.warn('Invalid text_list in translation request');
            return new Response(JSON.stringify({ 
                error: ERROR_MESSAGES.INVALID_TEXT_LIST,
                message: 'text_list must be an array of strings'
            }), {
                status: HTTP_STATUS.BAD_REQUEST,
                headers: { [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON }
            });
        }

        if (!target_lang) {
            return new Response(JSON.stringify({
                error: 'Missing target_lang',
                message: 'target_lang is required'
            }), {
                status: HTTP_STATUS.BAD_REQUEST,
                headers: { [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON }
            });
        }

        // Use batch translation with cache
        const translations = await translateBatch(text_list, target_lang, source_lang);

        logger.info(`Translation completed in ${Date.now() - startTime}ms for ${text_list.length} texts`);

        return new Response(JSON.stringify({ translations }), {
            status: HTTP_STATUS.OK,
            headers: { 
                [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON
            }
        });

    } catch (error) {
        logger.error(`Translation handler error after ${Date.now() - startTime}ms:`, error.message);
        return new Response(JSON.stringify({ 
            error: ERROR_MESSAGES.INTERNAL,
            message: 'Failed to process translation request'
        }), {
            status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
            headers: { [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON }
        });
    }
}
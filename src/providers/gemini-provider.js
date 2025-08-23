import { AIProvider } from './base-provider.js';
import { getNextGeminiApiKey, removeGeminiApiKey, getNextTranslateKey, removeTranslateKey } from '../core/api-key-manager.js';
import { fetchWithRetry, validateJsonResponse } from '../utils/fetch-retry.js';
import { Logger } from '../utils/logger.js';
import {
    GEMINI_BASE_URL,
    GEMINI_API_VERSION,
    GEMINI_MODEL,
    GEMINI_GENERATE_CONTENT_ENDPOINT,
    HTTP_METHOD,
    CONTENT_TYPE,
    HEADERS,
    PERFORMANCE
} from '../core/constants.js';

const logger = new Logger('GeminiProvider');

export class GeminiProvider extends AIProvider {
    constructor(config = {}) {
        super({
            name: 'gemini',
            baseUrl: GEMINI_BASE_URL,
            models: [GEMINI_MODEL, 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'],
            authType: 'query-param',
            rateLimit: 60,
            timeout: PERFORMANCE.REQUEST_TIMEOUT,
            ...config
        });
    }

    async chat(options) {
        const { messages, model = GEMINI_MODEL, temperature = 0.7, maxTokens } = options;

        // Convert messages to Gemini format
        const contents = messages.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        }));

        const geminiBody = {
            contents,
            generationConfig: {
                temperature,
                maxOutputTokens: maxTokens
            }
        };

        return await this.makeGeminiRequest({
            model,
            body: geminiBody,
            endpoint: 'generateContent'
        });
    }

    async complete(options) {
        const { prompt, model = GEMINI_MODEL, temperature = 0.7, maxTokens } = options;

        const contents = [{
            role: 'user',
            parts: [{ text: prompt }]
        }];

        const geminiBody = {
            contents,
            generationConfig: {
                temperature,
                maxOutputTokens: maxTokens
            }
        };

        return await this.makeGeminiRequest({
            model,
            body: geminiBody,
            endpoint: 'generateContent'
        });
    }

    async generateContent(options) {
        const { prompt, systemInstruction, model = GEMINI_MODEL, useTranslationKeys = false } = options;

        const contents = [{
            role: 'user',
            parts: [{ text: prompt }]
        }];

        const geminiBody = {
            contents
        };

        if (systemInstruction) {
            geminiBody.system_instruction = {
                parts: [{ text: systemInstruction }]
            };
        }

        return await this.makeGeminiRequest({
            model,
            body: geminiBody,
            endpoint: GEMINI_GENERATE_CONTENT_ENDPOINT,
            useTranslationKeys
        });
    }

    async proxy(request) {
        const requestId = request.requestId || 'unknown';
        const startTime = Date.now();

        try {
            const url = new URL(request.url);

            // Extract the actual API path from the request
            // The request URL might be like: https://test.dpdns.org/providers/gemini/v1/models
            // We need to extract the part after /providers/gemini/
            const pathMatch = url.pathname.match(/\/providers\/gemini\/(.*)/);
            const apiPath = pathMatch ? `/${pathMatch[1]}` : url.pathname;

            const targetUrl = `${this.baseUrl}${apiPath}${url.search}`;

            logger.info(`[${requestId}] Proxying request to: ${targetUrl}`);

            // Prepare headers
            const headers = new Headers();
            const requestContentType = request.headers.get(HEADERS.CONTENT_TYPE.toLowerCase());
            if (requestContentType) {
                headers.set(HEADERS.CONTENT_TYPE.toLowerCase(), requestContentType);
            }

            // Prepare request body
            let requestBody = null;
            if (request.method !== HTTP_METHOD.GET && request.method !== HTTP_METHOD.HEAD) {
                // Clone the request before reading the body
                const clonedRequest = request.clone();
                requestBody = await clonedRequest.arrayBuffer();
                logger.debug(`[${requestId}] Request body size: ${requestBody.byteLength} bytes`);
            }

            // Use fetchWithRetry for resilient API calls
            const response = await fetchWithRetry({
                getApiKey: getNextGeminiApiKey,
                removeApiKey: removeGeminiApiKey,
                buildRequest: (selectedKey) => {
                    headers.set(HEADERS.X_GOOG_API_KEY, selectedKey);
                    return {
                        url: targetUrl,
                        requestOptions: {
                            method: request.method,
                            headers: headers,
                            body: requestBody,
                            signal: AbortSignal.timeout(this.timeout)
                        }
                    };
                },
                validateResponse: validateJsonResponse,
                requestId: requestId
            });

            if (!response) {
                throw new Error('Failed to get valid response after all retries');
            }

            // Prepare response headers
            const responseHeaders = new Headers();
            const responseContentType = response.headers.get(HEADERS.CONTENT_TYPE.toLowerCase());
            if (responseContentType) {
                responseHeaders.set(HEADERS.CONTENT_TYPE.toLowerCase(), responseContentType);
            }

            // Add request ID to response
            responseHeaders.set(HEADERS.X_REQUEST_ID, requestId);

            logger.info(`[${requestId}] Proxy request completed in ${Date.now() - startTime}ms with status ${response.status}`);

            return new Response(response.body, {
                status: response.status,
                headers: responseHeaders
            });
        } catch (error) {
            logger.error(`[${requestId}] Proxy handler error after ${Date.now() - startTime}ms:`, error.message);
            throw this.formatError(error, 'proxy');
        }
    }

    async validate() {
        try {
            // Try a simple model list request to validate connectivity
            const response = await fetchWithRetry({
                getApiKey: getNextGeminiApiKey,
                removeApiKey: removeGeminiApiKey,
                buildRequest: (selectedKey) => {
                    const headers = new Headers();
                    headers.set(HEADERS.X_GOOG_API_KEY, selectedKey);
                    return {
                        url: `${this.baseUrl}/${GEMINI_API_VERSION}/models?key=${selectedKey}`,
                        requestOptions: {
                            method: HTTP_METHOD.GET,
                            headers: headers,
                            signal: AbortSignal.timeout(this.timeout)
                        }
                    };
                },
                validateResponse: validateJsonResponse
            });

            return response && response.ok;
        } catch (error) {
            logger.warn('Gemini provider validation failed:', error.message);
            return false;
        }
    }

    async makeGeminiRequest({ model, body, endpoint, useTranslationKeys = false }) {
        const startTime = Date.now();
        const requestId = `gemini-${Date.now()}`;

        try {
            const url = `${this.baseUrl}/${GEMINI_API_VERSION}/models/${model}:${endpoint}`;

            // Choose key management strategy based on use case
            const keyStrategy = useTranslationKeys
                ? { getApiKey: getNextTranslateKey, removeApiKey: removeTranslateKey }
                : { getApiKey: getNextGeminiApiKey, removeApiKey: removeGeminiApiKey };

            const response = await fetchWithRetry({
                getApiKey: keyStrategy.getApiKey,
                removeApiKey: keyStrategy.removeApiKey,
                buildRequest: (selectedKey) => {
                    const headers = new Headers();
                    headers.set(HEADERS.CONTENT_TYPE, CONTENT_TYPE.JSON);
                    return {
                        url: `${url}?key=${selectedKey}`,
                        requestOptions: {
                            method: HTTP_METHOD.POST,
                            headers: headers,
                            body: JSON.stringify(body),
                            signal: AbortSignal.timeout(this.timeout)
                        }
                    };
                },
                validateResponse: validateJsonResponse,
                requestId: requestId
            });

            if (!response) {
                throw new Error('Failed to get valid response after all retries');
            }

            const result = await response.json();
            logger.debug(`[${requestId}] Gemini request completed in ${Date.now() - startTime}ms`);
            return result;
        } catch (error) {
            logger.error(`[${requestId}] Gemini request failed:`, error.message);
            throw this.formatError(error, `makeGeminiRequest-${endpoint}`);
        }
    }
}
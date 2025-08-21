import { getNextGeminiApiKey, removeGeminiApiKey } from '../core/api-key-manager.js';
import { fetchWithRetry, validateJsonResponse } from '../utils/fetch-retry.js';
import { Logger } from '../utils/logger.js';
import {
    GEMINI_BASE_URL,
    HTTP_STATUS,
    HTTP_METHOD,
    CONTENT_TYPE,
    HEADERS,
    ERROR_MESSAGES
} from '../core/constants.js';

const logger = new Logger('ProxyService');

export async function proxyToGoogle(request) {
    const startTime = Date.now();

    try {
        const url = new URL(request.url);
        const targetUrl = `${GEMINI_BASE_URL}${url.pathname}${url.search}`;

        logger.info(`Proxying request to: ${targetUrl}`);

        // Prepare headers
        const headers = new Headers();
        const requestContentType = request.headers.get(HEADERS.CONTENT_TYPE.toLowerCase());
        if (requestContentType) {
            headers.set(HEADERS.CONTENT_TYPE.toLowerCase(), requestContentType);
        }

        // Prepare request body
        let requestBody = null;
        if (request.method !== HTTP_METHOD.GET && request.method !== HTTP_METHOD.HEAD) {
            requestBody = await request.arrayBuffer();
            logger.debug(`Request body size: ${requestBody.byteLength} bytes`);
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
                        body: requestBody
                    }
                };
            },
            validateResponse: validateJsonResponse
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

        logger.info(`Proxy request completed in ${Date.now() - startTime}ms with status ${response.status}`);

        return new Response(response.body, {
            status: response.status,
            headers: responseHeaders
        });
    } catch (error) {
        logger.error(`Proxy handler error after ${Date.now() - startTime}ms:`, error.message);
        return new Response(JSON.stringify({ error: ERROR_MESSAGES.INTERNAL }), {
            status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
            headers: { [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON }
        });
    }
}
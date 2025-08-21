import { 
    MAX_RETRIES, 
    HTTP_STATUS, 
    API_KEY_LOG_LENGTH,
    HEADERS,
    CONTENT_TYPE
} from '../core/constants.js';
import { Logger } from './logger.js';
import { CircuitBreaker } from './circuit-breaker.js';

const logger = new Logger('FetchRetry');

// Circuit breaker for API endpoints
const circuitBreakers = new Map();

function getCircuitBreaker(url) {
    const host = new URL(url).host;
    if (!circuitBreakers.has(host)) {
        circuitBreakers.set(host, new CircuitBreaker());
    }
    return circuitBreakers.get(host);
}

export async function fetchWithRetry(options) {
    const {
        getApiKey,
        removeApiKey,
        buildRequest,
        validateResponse = (response) => response.ok,
        maxRetries = MAX_RETRIES,
        requestId = 'unknown'
    } = options;

    let lastResponse = null;
    let successfulResponse = null;
    const startTime = Date.now();
    const usedKeys = new Set();

    logger.info(`[${requestId}] Starting fetch with retry (max attempts: ${maxRetries})`);

    for (let i = 0; i < maxRetries; i++) {
        try {
            const selectedKey = await getApiKey();
            
            // Avoid using the same key twice in the same retry session
            if (usedKeys.has(selectedKey)) {
                logger.debug(`[${requestId}] Skipping already tried key ${selectedKey.slice(0, API_KEY_LOG_LENGTH)}...`);
                continue;
            }
            usedKeys.add(selectedKey);

            const { url, requestOptions } = await buildRequest(selectedKey);
            
            // Check circuit breaker
            const circuitBreaker = getCircuitBreaker(url);
            
            logger.debug(`[${requestId}] Attempt ${i + 1}/${maxRetries} with key ${selectedKey.slice(0, API_KEY_LOG_LENGTH)}...`);

            const response = await circuitBreaker.execute(async () => {
                return await fetch(url, requestOptions);
            });
            
            lastResponse = response;

            // Handle specific status codes
            if (response.status === HTTP_STATUS.FORBIDDEN) {
                logger.warn(`[${requestId}] API key ${selectedKey.slice(0, API_KEY_LOG_LENGTH)}... is invalid (403 Forbidden), removing it`);
                await removeApiKey(selectedKey);
                continue;
            }

            if (response.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
                logger.warn(`[${requestId}] Rate limited (429), waiting before retry`);
                await new Promise(resolve => setTimeout(resolve, Math.min(1000 * (i + 1), 5000)));
                continue;
            }

            // Use custom validation function
            const isValid = await validateResponse(response.clone());
            if (isValid) {
                successfulResponse = response;
                logger.info(`[${requestId}] Success on attempt ${i + 1}/${maxRetries}, took ${Date.now() - startTime}ms`);
                break;
            }

            logger.warn(`[${requestId}] API key ${selectedKey.slice(0, API_KEY_LOG_LENGTH)}... received status ${response.status}. Retry ${i + 1}/${maxRetries}`);
            
            // Exponential backoff for server errors
            if (response.status >= 500) {
                const delay = Math.min(100 * Math.pow(2, i), 5000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            
        } catch (error) {
            logger.error(`[${requestId}] Error during retry ${i + 1}/${maxRetries}:`, error.message);
            
            // Exponential backoff for network errors
            if (i < maxRetries - 1) {
                const delay = Math.min(100 * Math.pow(2, i), 5000);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }

    if (!successfulResponse) {
        logger.warn(`[${requestId}] All ${maxRetries} attempts exhausted, took ${Date.now() - startTime}ms`);
    }

    return successfulResponse || lastResponse;
}

export async function validateJsonResponse(response) {
    if (!response.ok) return false;
    
    const contentType = response.headers.get(HEADERS.CONTENT_TYPE.toLowerCase());
    if (contentType && contentType.includes(CONTENT_TYPE.JSON)) {
        try {
            const body = await response.json();
            const isValid = body && Object.keys(body).length > 0;
            logger.debug(`JSON response validation: ${isValid ? 'valid' : 'invalid'}`);
            return isValid;
        } catch (e) {
            logger.warn("Invalid JSON response");
            return false;
        }
    }
    
    return response.body !== null;
}
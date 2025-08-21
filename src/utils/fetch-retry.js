import { 
    MAX_RETRIES, 
    HTTP_STATUS, 
    API_KEY_LOG_LENGTH,
    HEADERS,
    CONTENT_TYPE
} from '../core/constants.js';
import { Logger } from './logger.js';

const logger = new Logger('FetchRetry');

export async function fetchWithRetry(options) {
    const {
        getApiKey,
        removeApiKey,
        buildRequest,
        validateResponse = (response) => response.ok,
        maxRetries = MAX_RETRIES
    } = options;

    let lastResponse = null;
    let successfulResponse = null;
    const startTime = Date.now();

    logger.info(`Starting fetch with retry (max attempts: ${maxRetries})`);

    for (let i = 0; i < maxRetries; i++) {
        try {
            const selectedKey = await getApiKey();
            const { url, requestOptions } = await buildRequest(selectedKey);

            logger.debug(`Attempt ${i + 1}/${maxRetries} with key ${selectedKey.slice(0, API_KEY_LOG_LENGTH)}...`);

            const response = await fetch(url, requestOptions);
            lastResponse = response;

            // Check for 403 Forbidden, remove key if invalid
            if (response.status === HTTP_STATUS.FORBIDDEN) {
                logger.warn(`API key ${selectedKey.slice(0, API_KEY_LOG_LENGTH)}... is invalid (403 Forbidden), removing it`);
                await removeApiKey(selectedKey);
                continue;
            }

            // Use custom validation function to check if response is valid
            const isValid = await validateResponse(response.clone());
            if (isValid) {
                successfulResponse = response;
                logger.info(`Success on attempt ${i + 1}/${maxRetries}, took ${Date.now() - startTime}ms`);
                break;
            }

            logger.warn(`API key ${selectedKey.slice(0, API_KEY_LOG_LENGTH)}... received status ${response.status}. Retry ${i + 1}/${maxRetries}`);
        } catch (error) {
            logger.error(`Error during retry ${i + 1}/${maxRetries}:`, error.message);
            if (i === maxRetries - 1) throw error;
        }
    }

    if (!successfulResponse) {
        logger.warn(`All ${maxRetries} attempts exhausted, took ${Date.now() - startTime}ms`);
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
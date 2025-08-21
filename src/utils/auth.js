import {
    HTTP_METHOD,
    HEADERS,
    BEARER_PREFIX_REGEX
} from '../core/constants.js';
import { Logger } from './logger.js';

const logger = new Logger('Auth');

export function extractAuthKey(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // 1. Check if this is the /translate/:authKey path
    if (pathname.startsWith('/translate/') && method === HTTP_METHOD.POST) {
        const parts = pathname.split('/');
        const pathKey = parts[2] || '';
        if (pathKey) {
            logger.debug(`Auth key extracted from path: ${pathKey.slice(0, 7)}...`);
            return pathKey.trim();
        }
    }

    // 2. Check x-goog-api-key header
    const googleApiKey = request.headers.get(HEADERS.X_GOOG_API_KEY);
    if (googleApiKey) {
        logger.debug(`Auth key extracted from x-goog-api-key header`);
        return googleApiKey.trim();
    }

    // 3. Check Authorization header
    const authHeader = request.headers.get(HEADERS.AUTHORIZATION);
    if (authHeader) {
        const key = authHeader.replace(BEARER_PREFIX_REGEX, '').trim();
        if (key) {
            logger.debug(`Auth key extracted from Authorization header`);
            return key;
        }
    }

    logger.debug('No authentication key found in request');
    return '';
}
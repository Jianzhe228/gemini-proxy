import { validateClientKey } from './api-key-manager.js';
import { router } from './router.js';
import { proxyToGoogle } from '../services/proxy-service.js';
import { extractAuthKey } from '../utils/auth.js';
import { Logger } from '../utils/logger.js';
import {
    HTTP_STATUS,
    CONTENT_TYPE,
    HEADERS,
    ERROR_MESSAGES
} from './constants.js';

const logger = new Logger('RequestHandler');

function generateRequestId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

async function authenticateRequest(request) {
    const authKey = extractAuthKey(request);

    if (!authKey) {
        return {
            authenticated: false,
            error: ERROR_MESSAGES.MISSING_AUTH,
            message: ERROR_MESSAGES.AUTH_REQUIRED
        };
    }

    const isValid = await validateClientKey(authKey);
    if (!isValid) {
        return {
            authenticated: false,
            error: ERROR_MESSAGES.INVALID_CLIENT_KEY,
            message: ERROR_MESSAGES.UNAUTHORIZED
        };
    }

    return { authenticated: true };
}

export async function handleRequest(request) {
    const requestId = generateRequestId();
    const startTime = Date.now();
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    request.requestId = requestId;
    logger.info(`[${requestId}] Incoming request: ${method} ${pathname}`);

    try {
        // Check if it's a Google proxy request
        if (pathname.startsWith('/v1/') || pathname.startsWith('/v1beta/')) {
            const authResult = await authenticateRequest(request);
            if (!authResult.authenticated) {
                logger.warn(`[${requestId}] Authentication failed`);
                return new Response(JSON.stringify({
                    error: authResult.error,
                    message: authResult.message,
                    requestId: requestId
                }), {
                    status: HTTP_STATUS.UNAUTHORIZED,
                    headers: { [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON }
                });
            }
            
            logger.debug(`[${requestId}] Routing to Google proxy`);
            const response = await proxyToGoogle(request);
            logger.logRequestTime(requestId, pathname, method, startTime);
            return response;
        }

        // Route to appropriate handler
        const response = await router.route(request);
        
        logger.logRequestTime(requestId, pathname, method, startTime);
        logger.info(`[${requestId}] Response status: ${response.status}`);
        return response;

    } catch (error) {
        logger.error(`[${requestId}] Unhandled error:`, error.message);
        const response = new Response(JSON.stringify({
            error: ERROR_MESSAGES.INTERNAL,
            requestId: requestId
        }), {
            status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
            headers: { [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON }
        });
        logger.logRequestTime(requestId, pathname, method, startTime);
        return response;
    }
}
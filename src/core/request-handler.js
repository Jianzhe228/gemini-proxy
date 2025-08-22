import { validateClientKey } from './api-key-manager.js';
import { router } from './router.js';
import { proxyToGoogle } from '../services/proxy-service.js';
import { extractAuthKey } from '../utils/auth.js';
import { Logger } from '../utils/logger.js';
import {
    HTTP_STATUS,
    CONTENT_TYPE,
    HEADERS,
    ERROR_MESSAGES,
    PERFORMANCE
} from './constants.js';

const logger = new Logger('RequestHandler');

// Optimized request ID generation
const requestIdCounter = { value: 0 };
function generateRequestId() {
    const counter = (requestIdCounter.value++ % 1000000).toString(36);
    const timestamp = Date.now().toString(36);
    return `${timestamp}-${counter}`;
}

// Request deduplication
const pendingRequests = new Map();

async function generateRequestKey(request) {
    const url = new URL(request.url);
    const method = request.method;
    const pathname = url.pathname;

    // For GET/HEAD requests, use URL as key
    if (method === 'GET' || method === 'HEAD') {
        return `${method}:${url.href}`;
    }

    // For POST requests, include body hash
    if (method === 'POST' && request.body) {
        try {
            const bodyText = await request.clone().text();
            const encoder = new TextEncoder();
            const data = encoder.encode(`${method}:${pathname}:${bodyText}`);
            const hashBuffer = await crypto.subtle.digest('SHA-1', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            return `${method}:${pathname}:${hashHex}`;
        } catch (error) {
            logger.warn('Failed to generate request key:', error.message);
        }
    }

    return `${method}:${pathname}:${Date.now()}`;
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

async function processRequest(request, requestId, startTime) {
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
                    headers: {
                        [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
                        [HEADERS.X_REQUEST_ID]: requestId
                    }
                });
            }

            logger.debug(`[${requestId}] Routing to Google proxy`);
            const response = await proxyToGoogle(request);
            logger.logRequestTime(requestId, pathname, method, startTime);
            return response;
        }

        // Route to appropriate handler
        const response = await router.route(request);

        // Add request ID to response headers
        const headers = new Headers(response.headers);
        headers.set(HEADERS.X_REQUEST_ID, requestId);

        const finalResponse = new Response(response.body, {
            status: response.status,
            headers: headers
        });

        logger.logRequestTime(requestId, pathname, method, startTime);
        logger.info(`[${requestId}] Response status: ${response.status}`);
        return finalResponse;

    } catch (error) {
        logger.error(`[${requestId}] Unhandled error:`, error.message);
        const response = new Response(JSON.stringify({
            error: ERROR_MESSAGES.INTERNAL,
            requestId: requestId
        }), {
            status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
            headers: {
                [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
                [HEADERS.X_REQUEST_ID]: requestId
            }
        });
        logger.logRequestTime(requestId, pathname, method, startTime);
        return response;
    }
}

export async function handleRequest(request) {
    const requestId = generateRequestId();
    const startTime = Date.now();

    // Generate request key for deduplication
    const requestKey = await generateRequestKey(request);

    // Check if identical request is already being processed
    if (pendingRequests.has(requestKey)) {
        logger.debug(`[${requestId}] Deduplicating request`);
        const existingPromise = pendingRequests.get(requestKey);
        return existingPromise;
    }

    // Process new request
    const responsePromise = processRequest(request, requestId, startTime);
    pendingRequests.set(requestKey, responsePromise);

    try {
        const response = await responsePromise;
        return response;
    } finally {
        // Clean up pending request after a short delay
        setTimeout(() => {
            pendingRequests.delete(requestKey);
        }, PERFORMANCE.REQUEST_DEDUP_TTL);
    }
}
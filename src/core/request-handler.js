import { router } from './router.js';
import { Logger } from '../utils/logger.js';
import {
    HTTP_STATUS,
    CONTENT_TYPE,
    HEADERS,
    ERROR_MESSAGES
} from './constants.js';

const logger = new Logger('RequestHandler');

// Optimized request ID generation
const requestIdCounter = { value: 0 };
function generateRequestId() {
    const counter = (requestIdCounter.value++ % 1000000).toString(36);
    const timestamp = Date.now().toString(36);
    return `${timestamp}-${counter}`;
}

async function processRequest(request, requestId, startTime) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    request.requestId = requestId;
    logger.info(`[${requestId}] Incoming request: ${method} ${pathname}`);

    try {
        // Route to appropriate handler
        const response = await router.route(request);

        // Add request ID to response headers if not already present
        const headers = new Headers(response.headers);
        if (!headers.has(HEADERS.X_REQUEST_ID)) {
            headers.set(HEADERS.X_REQUEST_ID, requestId);
        }

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
            requestId: requestId,
            message: error.message
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
    
    // Simply process each request independently
    return await processRequest(request, requestId, startTime);
}
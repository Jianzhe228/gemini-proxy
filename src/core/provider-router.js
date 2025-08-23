import { providerManager } from './provider-manager.js';
import { validateClientKey } from './api-key-manager.js';
import { Logger } from '../utils/logger.js';
import {
    HTTP_STATUS,
    HTTP_METHOD,
    CONTENT_TYPE,
    HEADERS,
    ERROR_MESSAGES
} from './constants.js';

const logger = new Logger('ProviderRouter');

export async function handleProviderRoute(request) {
    const startTime = Date.now();
    const requestId = request.requestId || 'unknown';
    const { providerName, wildcard } = request.params;

    logger.info(`[${requestId}] Provider route: ${providerName}/${wildcard}`);

    try {
        // Initialize provider manager if not already initialized
        if (!providerManager.initialized) {
            logger.debug(`[${requestId}] Initializing provider manager`);
            await providerManager.initialize();
        }

        // Validate provider exists
        if (!providerManager.hasProvider(providerName)) {
            logger.warn(`[${requestId}] Provider not found: ${providerName}`);
            return new Response(JSON.stringify({
                error: 'Provider not found',
                message: `AI provider '${providerName}' is not available`,
                requestId: requestId,
                availableProviders: providerManager.getProviderNames()
            }), {
                status: HTTP_STATUS.NOT_FOUND,
                headers: {
                    [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
                    [HEADERS.X_REQUEST_ID]: requestId
                }
            });
        }

        // Authenticate request
        const authResult = await authenticateRequest(request, requestId);
        if (!authResult.authenticated) {
            logger.warn(`[${requestId}] Authentication failed for provider: ${providerName}`);
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

        // Route to provider
        const provider = providerManager.getProvider(providerName);
        
        // Handle simplified provider route (no wildcard)
        if (!wildcard || wildcard === '') {
            // For simplified routes, we need to determine the appropriate default endpoint
            // based on the provider and request method/body
            logger.debug(`[${requestId}] Handling simplified ${providerName} route`);
            
            // Try to intelligently route based on request content
            if (request.method === HTTP_METHOD.POST) {
                try {
                    // Clone the request before reading the body
                    const clonedRequest = request.clone();
                    const body = await clonedRequest.json();
                    
                    // If it looks like a chat/completion request
                    if (body.messages || body.prompt) {
                        const response = await provider.chat({
                            messages: body.messages || [{ role: 'user', content: body.prompt }],
                            model: body.model,
                            temperature: body.temperature,
                            maxTokens: body.maxTokens
                        });
                        
                        return new Response(JSON.stringify(response), {
                            status: HTTP_STATUS.OK,
                            headers: {
                                [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
                                [HEADERS.X_REQUEST_ID]: requestId
                            }
                        });
                    }
                } catch (e) {
                    // If JSON parsing fails, continue to proxy handling
                    logger.debug(`[${requestId}] Could not parse request body, falling back to proxy`);
                }
            }
            
            // For GET requests or unrecognized POST requests, show provider info
            return new Response(JSON.stringify({
                provider: providerName,
                info: provider.getInfo(),
                message: `This is the simplified endpoint for ${providerName}. Use /providers/${providerName}/v1/* for specific API endpoints.`,
                endpoints: {
                    chat: `POST /providers/${providerName} - with messages array in body`,
                    proxy: `GET|POST /providers/${providerName}/v1/* - direct API proxy`
                },
                timestamp: new Date().toISOString()
            }), {
                status: HTTP_STATUS.OK,
                headers: {
                    [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
                    [HEADERS.X_REQUEST_ID]: requestId
                }
            });
        }
        
        // For proxy requests with wildcard, pass the original request directly
        logger.debug(`[${requestId}] Proxying to ${providerName}: ${wildcard}`);
        
        // Set the requestId on the request
        request.requestId = requestId;
        
        // Pass the original request directly to the provider's proxy method
        const response = await provider.proxy(request);
        
        logger.info(`[${requestId}] Provider request completed in ${Date.now() - startTime}ms`);
        return response;

    } catch (error) {
        logger.error(`[${requestId}] Provider route error after ${Date.now() - startTime}ms:`, error.message);
        return new Response(JSON.stringify({
            error: ERROR_MESSAGES.INTERNAL,
            message: 'Failed to process provider request',
            requestId: requestId,
            details: error.message
        }), {
            status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
            headers: {
                [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
                [HEADERS.X_REQUEST_ID]: requestId
            }
        });
    }
}

async function authenticateRequest(request, requestId) {
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

function extractAuthKey(request) {
    // Try to extract from URL parameters
    const url = new URL(request.url);
    const keyParam = url.searchParams.get('key');
    if (keyParam) {
        return keyParam;
    }

    // Try to extract from Authorization header
    const authHeader = request.headers.get('authorization');
    if (authHeader) {
        // Handle Bearer token
        if (authHeader.toLowerCase().startsWith('bearer ')) {
            return authHeader.substring(7);
        }
        // Handle direct key in header
        return authHeader;
    }

    // Try to extract from x-goog-api-key header (Gemini specific)
    const googApiKey = request.headers.get('x-goog-api-key');
    if (googApiKey) {
        return googApiKey;
    }

    return null;
}
import { HTTP_STATUS, HTTP_METHOD, CONTENT_TYPE, HEADERS, ERROR_MESSAGES } from './constants.js';
import { handleTranslate } from '../services/translation-service.js';
import { handleProviderRoute } from './provider-router.js';
import { providerManager } from './provider-manager.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('Router');

class Router {
    constructor() {
        this.routes = new Map();
        this.setupRoutes();
    }

    setupRoutes() {
        // Provider-based routes (new architecture)
        this.addRoute('/providers/:providerName/*', {
            [HTTP_METHOD.GET]: handleProviderRoute,
            [HTTP_METHOD.POST]: handleProviderRoute,
            [HTTP_METHOD.PUT]: handleProviderRoute,
            [HTTP_METHOD.DELETE]: handleProviderRoute,
            [HTTP_METHOD.PATCH]: handleProviderRoute,
            [HTTP_METHOD.HEAD]: handleProviderRoute,
            [HTTP_METHOD.OPTIONS]: handleProviderRoute
        });

        // Simplified provider routes (without path details)
        this.addRoute('/providers/:providerName', {
            [HTTP_METHOD.GET]: handleProviderRoute,
            [HTTP_METHOD.POST]: handleProviderRoute,
            [HTTP_METHOD.PUT]: handleProviderRoute,
            [HTTP_METHOD.DELETE]: handleProviderRoute,
            [HTTP_METHOD.PATCH]: handleProviderRoute,
            [HTTP_METHOD.HEAD]: handleProviderRoute,
            [HTTP_METHOD.OPTIONS]: handleProviderRoute
        });

        // Legacy Gemini routes (backward compatibility)
        this.addRoute('/v1/*', {
            [HTTP_METHOD.GET]: this.handleLegacyGeminiRoute,
            [HTTP_METHOD.POST]: this.handleLegacyGeminiRoute,
            [HTTP_METHOD.PUT]: this.handleLegacyGeminiRoute,
            [HTTP_METHOD.DELETE]: this.handleLegacyGeminiRoute,
            [HTTP_METHOD.PATCH]: this.handleLegacyGeminiRoute,
            [HTTP_METHOD.HEAD]: this.handleLegacyGeminiRoute,
            [HTTP_METHOD.OPTIONS]: this.handleLegacyGeminiRoute
        });

        this.addRoute('/v1beta/*', {
            [HTTP_METHOD.GET]: this.handleLegacyGeminiRoute,
            [HTTP_METHOD.POST]: this.handleLegacyGeminiRoute,
            [HTTP_METHOD.PUT]: this.handleLegacyGeminiRoute,
            [HTTP_METHOD.DELETE]: this.handleLegacyGeminiRoute,
            [HTTP_METHOD.PATCH]: this.handleLegacyGeminiRoute,
            [HTTP_METHOD.HEAD]: this.handleLegacyGeminiRoute,
            [HTTP_METHOD.OPTIONS]: this.handleLegacyGeminiRoute
        });

        // Main translation route with dynamic auth key
        this.addRoute('/translate/:authKey', {
            [HTTP_METHOD.POST]: handleTranslate,
            [HTTP_METHOD.OPTIONS]: this.handleCors
        });

        // Root route
        this.addRoute('/', {
            [HTTP_METHOD.GET]: this.handleRoot,
            [HTTP_METHOD.HEAD]: this.handleRoot
        });

        // Health check
        this.addRoute('/health', {
            [HTTP_METHOD.GET]: this.handleHealth
        });

        // Favicon
        this.addRoute('/favicon.ico', {
            [HTTP_METHOD.GET]: this.handleFavicon
        });
    }

    addRoute(pattern, handlers) {
        this.routes.set(pattern, handlers);
    }

    extractParams(pattern, pathname) {
        const patternParts = pattern.split('/');
        const pathParts = pathname.split('/');

        // Handle wildcard patterns
        if (pattern.endsWith('*')) {
            const basePatternParts = patternParts.slice(0, -1);
            if (pathParts.length < basePatternParts.length) {
                return null;
            }

            const params = {};
            for (let i = 0; i < basePatternParts.length; i++) {
                if (basePatternParts[i].startsWith(':')) {
                    const paramName = basePatternParts[i].substring(1);
                    params[paramName] = pathParts[i];
                } else if (basePatternParts[i] !== pathParts[i]) {
                    return null;
                }
            }

            // Add the remaining path as wildcard
            params.wildcard = pathParts.slice(basePatternParts.length).join('/');
            return params;
        }

        // Handle exact patterns
        if (patternParts.length !== pathParts.length) {
            return null;
        }

        const params = {};
        for (let i = 0; i < patternParts.length; i++) {
            if (patternParts[i].startsWith(':')) {
                const paramName = patternParts[i].substring(1);
                params[paramName] = pathParts[i];
            } else if (patternParts[i] !== pathParts[i]) {
                return null;
            }
        }

        return params;
    }

    async route(request) {
        const url = new URL(request.url);
        const pathname = url.pathname;
        const method = request.method;

        logger.debug(`Routing ${method} ${pathname}`);

        // Try to match route
        for (const [pattern, handlers] of this.routes) {
            const params = this.extractParams(pattern, pathname);

            if (params !== null) {
                const handler = handlers[method];

                if (!handler) {
                    logger.warn(`No handler for method ${method} on path ${pathname}`);
                    return this.handleMethodNotAllowed();
                }

                request.params = params;
                logger.debug(`Route matched: ${pattern}`);
                return await handler(request);
            }
        }

        logger.warn(`No route found for ${pathname}`);
        return this.handleNotFound();
    }

    handleRoot = async () => {
        try {
            // Initialize provider manager to get provider info
            await providerManager.initialize();
            const providersInfo = providerManager.getProvidersInfo();
            
            return new Response(JSON.stringify({
                status: 'ok',
                service: 'AI API Gateway',
                version: 'v2',
                description: 'Unified API gateway for multiple AI providers',
                endpoints: {
                    translation: '/translate/:authKey',
                    providers: {
                        simplified: '/providers/:providerName',
                        detailed: '/providers/:providerName/*'
                    },
                    legacy: '/v1/*, /v1beta/*'
                },
                providers: providersInfo,
                timestamp: new Date().toISOString()
            }), {
                status: HTTP_STATUS.OK,
                headers: {
                    [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
                    [HEADERS.CACHE_CONTROL]: 'public, max-age=3600'
                }
            });
        } catch (error) {
            logger.error('Failed to get provider info for root endpoint:', error.message);
            return new Response(JSON.stringify({
                status: 'ok',
                service: 'AI API Gateway',
                version: 'v2',
                description: 'Unified API gateway for multiple AI providers',
                endpoints: {
                    translation: '/translate/:authKey',
                    providers: '/providers/:providerName/*',
                    legacy: '/v1/*, /v1beta/*'
                },
                providers: 'initialization failed',
                timestamp: new Date().toISOString()
            }), {
                status: HTTP_STATUS.OK,
                headers: {
                    [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
                    [HEADERS.CACHE_CONTROL]: 'public, max-age=3600'
                }
            });
        }
    };

    handleHealth = () => {
        return new Response(JSON.stringify({
            status: 'healthy',
            timestamp: new Date().toISOString()
        }), {
            status: HTTP_STATUS.OK,
            headers: {
                [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
                [HEADERS.CACHE_CONTROL]: 'no-cache'
            }
        });
    };

    handleFavicon = () => {
        return new Response(null, {
            status: HTTP_STATUS.NO_CONTENT,
            headers: {
                [HEADERS.CACHE_CONTROL]: 'public, max-age=86400'
            }
        });
    };

    handleCors = () => {
        return new Response(null, {
            status: HTTP_STATUS.NO_CONTENT,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-goog-api-key',
                'Access-Control-Max-Age': '86400'
            }
        });
    };

    handleNotFound = () => {
        return new Response(JSON.stringify({
            error: ERROR_MESSAGES.NOT_FOUND,
            message: 'The requested endpoint was not found'
        }), {
            status: HTTP_STATUS.NOT_FOUND,
            headers: { [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON }
        });
    };

    handleMethodNotAllowed = () => {
        return new Response(JSON.stringify({
            error: ERROR_MESSAGES.METHOD_NOT_ALLOWED,
            message: 'This method is not allowed for this endpoint'
        }), {
            status: HTTP_STATUS.METHOD_NOT_ALLOWED,
            headers: { [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON }
        });
    };

    handleLegacyGeminiRoute = async (request) => {
        // Route legacy Gemini requests to provider router
        request.params = { providerName: 'gemini', wildcard: request.url.split('/').slice(2).join('/') };
        return await handleProviderRoute(request);
    };
}

export const router = new Router();
import { HTTP_STATUS, HTTP_METHOD, CONTENT_TYPE, HEADERS, ERROR_MESSAGES } from './constants.js';
import { handleTranslate } from '../services/translation-service.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('Router');

class Router {
    constructor() {
        this.routes = new Map();
        this.setupRoutes();
    }

    setupRoutes() {
        // Main translation route with dynamic auth key
        this.addRoute('/translate/:authKey', {
            [HTTP_METHOD.POST]: handleTranslate,
            [HTTP_METHOD.OPTIONS]: this.handleCors
        });

        // Root route
        this.addRoute('/', {
            [HTTP_METHOD.GET]: this.handleRoot
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

    handleRoot = () => {
        return new Response(JSON.stringify({
            status: 'ok',
            service: 'Translation API',
            version: 'v1',
            endpoint: '/translate/:authKey'
        }), {
            status: HTTP_STATUS.OK,
            headers: { [HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON }
        });
    };

    handleFavicon = () => {
        return new Response(null, {
            status: HTTP_STATUS.NO_CONTENT
        });
    };

    handleCors = () => {
        return new Response(null, {
            status: HTTP_STATUS.NO_CONTENT,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-goog-api-key'
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
}

export const router = new Router();
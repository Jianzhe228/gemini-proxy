import { Logger } from '../utils/logger.js';

const logger = new Logger('ProviderManager');

export class ProviderManager {
    constructor() {
        this.providers = new Map();
        this.initialized = false;
    }

    /**
     * Initialize the provider manager
     */
    async initialize() {
        if (this.initialized) {
            return;
        }

        try {
            logger.info('Initializing provider manager...');
            
            // Import providers dynamically to avoid circular dependencies
            const { GeminiProvider } = await import('../providers/gemini-provider.js');
            
            // Register Gemini provider
            const geminiProvider = new GeminiProvider();
            this.registerProvider('gemini', geminiProvider);
            
            logger.info('Provider manager initialized successfully with providers:', Array.from(this.providers.keys()));
            this.initialized = true;
        } catch (error) {
            logger.error('Failed to initialize provider manager:', error.message);
            logger.error('Error details:', error.stack);
            throw new Error(`Provider initialization failed: ${error.message}`);
        }
    }

    /**
     * Register a provider
     * @param {string} name - Provider name
     * @param {AIProvider} provider - Provider instance
     */
    registerProvider(name, provider) {
        if (this.providers.has(name)) {
            logger.warn(`Provider ${name} already registered, overwriting`);
        }
        
        this.providers.set(name, provider);
        logger.info(`Registered provider: ${name}`);
    }

    /**
     * Get a provider by name
     * @param {string} name - Provider name
     * @returns {AIProvider} Provider instance
     */
    getProvider(name) {
        const provider = this.providers.get(name);
        if (!provider) {
            throw new Error(`Provider not found: ${name}`);
        }
        return provider;
    }

    /**
     * Check if a provider is registered
     * @param {string} name - Provider name
     * @returns {boolean} True if provider exists
     */
    hasProvider(name) {
        return this.providers.has(name);
    }

    /**
     * Get all registered provider names
     * @returns {Array<string>} Provider names
     */
    getProviderNames() {
        return Array.from(this.providers.keys());
    }

    /**
     * Get information about all providers
     * @returns {Object} Provider information
     */
    getProvidersInfo() {
        const info = {};
        for (const [name, provider] of this.providers) {
            info[name] = provider.getInfo();
        }
        return info;
    }

    /**
     * Route request to appropriate provider
     * @param {string} providerName - Provider name
     * @param {string} method - Method name (chat, complete, embed, proxy, etc.)
     * @param {Object} options - Method options
     * @returns {Promise<any>} Method result
     */
    async routeRequest(providerName, method, options) {
        if (!this.initialized) {
            await this.initialize();
        }

        const provider = this.getProvider(providerName);
        
        if (typeof provider[method] !== 'function') {
            throw new Error(`Method ${method} not supported by provider ${providerName}`);
        }

        try {
            const result = await provider[method](options);
            logger.debug(`Request completed successfully: ${providerName}.${method}`);
            return result;
        } catch (error) {
            logger.error(`Request failed: ${providerName}.${method}`, error.message);
            throw error;
        }
    }

    /**
     * Validate all providers
     * @returns {Promise<Object>} Validation results
     */
    async validateAllProviders() {
        if (!this.initialized) {
            await this.initialize();
        }

        const results = {};
        
        for (const [name, provider] of this.providers) {
            try {
                const isValid = await provider.validate();
                results[name] = {
                    valid: isValid,
                    error: null
                };
                logger.info(`Provider ${name} validation: ${isValid ? 'passed' : 'failed'}`);
            } catch (error) {
                results[name] = {
                    valid: false,
                    error: error.message
                };
                logger.error(`Provider ${name} validation error:`, error.message);
            }
        }

        return results;
    }

    /**
     * Sanitize options for logging (remove sensitive data)
     * @param {Object} options - Original options
     * @returns {Object} Sanitized options
     */
    sanitizeOptions(options) {
        if (!options || typeof options !== 'object') {
            return options;
        }

        const sanitized = { ...options };
        
        // Remove sensitive fields
        const sensitiveFields = ['apiKey', 'token', 'password', 'secret', 'authorization'];
        for (const field of sensitiveFields) {
            if (sanitized[field]) {
                sanitized[field] = '[REDACTED]';
            }
        }

        // Sanitize messages content for logging
        if (sanitized.messages && Array.isArray(sanitized.messages)) {
            sanitized.messages = sanitized.messages.map(msg => ({
                ...msg,
                content: typeof msg.content === 'string' 
                    ? msg.content.length > 100 
                        ? msg.content.substring(0, 100) + '...' 
                        : msg.content
                    : msg.content
            }));
        }

        return sanitized;
    }
}

// Export singleton instance
export const providerManager = new ProviderManager();
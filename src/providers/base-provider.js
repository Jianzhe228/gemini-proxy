/**
 * Abstract base class for AI providers
 * Defines the common interface that all AI providers must implement
 */
export class AIProvider {
    constructor(config = {}) {
        this.name = config.name || 'Unknown';
        this.baseUrl = config.baseUrl || '';
        this.models = config.models || [];
        this.authType = config.authType || 'bearer';
        this.rateLimit = config.rateLimit || 1000;
        this.timeout = config.timeout || 30000;
    }

    /**
     * Chat/completion interface
     * @param {Object} options - Chat options
     * @param {Array} options.messages - Array of messages
     * @param {string} options.model - Model to use
     * @param {number} options.temperature - Temperature parameter
     * @param {number} options.maxTokens - Maximum tokens
     * @returns {Promise<Object>} Chat response
     */
    async chat(options) {
        throw new Error(`chat() method not implemented for provider: ${this.name}`);
    }

    /**
     * Text completion interface
     * @param {Object} options - Completion options
     * @param {string} options.prompt - Text prompt
     * @param {string} options.model - Model to use
     * @param {number} options.temperature - Temperature parameter
     * @param {number} options.maxTokens - Maximum tokens
     * @returns {Promise<Object>} Completion response
     */
    async complete(options) {
        throw new Error(`complete() method not implemented for provider: ${this.name}`);
    }

    /**
     * Embedding interface
     * @param {Object} options - Embedding options
     * @param {string|Array} options.input - Text input(s)
     * @param {string} options.model - Model to use
     * @returns {Promise<Object>} Embedding response
     */
    async embed(options) {
        throw new Error(`embed() method not implemented for provider: ${this.name}`);
    }

    /**
     * Generate content interface (for translation and other generation tasks)
     * @param {Object} options - Generation options
     * @param {string} options.prompt - Generation prompt
     * @param {string} options.systemInstruction - System instruction
     * @param {string} options.model - Model to use
     * @returns {Promise<Object>} Generation response
     */
    async generateContent(options) {
        throw new Error(`generateContent() method not implemented for provider: ${this.name}`);
    }

    /**
     * Generic proxy interface for direct API passthrough
     * @param {Request} request - Original HTTP request
     * @returns {Promise<Response>} Proxy response
     */
    async proxy(request) {
        throw new Error(`proxy() method not implemented for provider: ${this.name}`);
    }

    /**
     * Validate provider configuration and connectivity
     * @returns {Promise<boolean>} True if provider is valid and accessible
     */
    async validate() {
        throw new Error(`validate() method not implemented for provider: ${this.name}`);
    }

    /**
     * Get provider information
     * @returns {Object} Provider metadata
     */
    getInfo() {
        return {
            name: this.name,
            baseUrl: this.baseUrl,
            models: this.models,
            authType: this.authType,
            rateLimit: this.rateLimit,
            timeout: this.timeout
        };
    }

    /**
     * Format error response consistently
     * @param {Error} error - Original error
     * @param {string} operation - Operation that failed
     * @returns {Object} Formatted error object
     */
    formatError(error, operation = 'unknown') {
        return {
            provider: this.name,
            operation,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}
import { Logger } from './logger.js';

const logger = new Logger('CircuitBreaker');

export class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.successThreshold = options.successThreshold || 2;
        this.timeout = options.timeout || 60000;
        this.failureCount = 0;
        this.successCount = 0;
        this.state = 'CLOSED';
        this.nextAttempt = Date.now();
    }

    async execute(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                const waitTime = Math.ceil((this.nextAttempt - Date.now()) / 1000);
                logger.debug(`Circuit breaker is OPEN, wait ${waitTime}s`);
                throw new Error(`Circuit breaker is OPEN, please wait ${waitTime} seconds`);
            }
            this.state = 'HALF_OPEN';
            logger.info('Circuit breaker transitioned to HALF_OPEN');
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    onSuccess() {
        this.failureCount = 0;

        if (this.state === 'HALF_OPEN') {
            this.successCount++;
            if (this.successCount >= this.successThreshold) {
                this.state = 'CLOSED';
                this.successCount = 0;
                logger.info('Circuit breaker transitioned to CLOSED');
            }
        }
    }

    onFailure() {
        this.successCount = 0;
        this.failureCount++;

        if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.timeout;
            logger.warn(`Circuit breaker transitioned to OPEN, will retry at ${new Date(this.nextAttempt).toISOString()}`);
        }
    }

    getState() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            nextAttempt: this.state === 'OPEN' ? new Date(this.nextAttempt).toISOString() : null
        };
    }

    reset() {
        this.failureCount = 0;
        this.successCount = 0;
        this.state = 'CLOSED';
        this.nextAttempt = Date.now();
        logger.info('Circuit breaker reset');
    }
}
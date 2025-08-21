import { LOG_LEVEL, LOG_PERFORMANCE_METRICS } from '../core/constants.js';

const LOG_LEVELS = {
    none: -1,
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
};

export class Logger {
    constructor(context = '') {
        this.context = context;
        this.currentLevel = LOG_LEVEL.toLowerCase();
        this.minLevel = LOG_LEVELS[this.currentLevel] ?? LOG_LEVELS.info;
    }

    shouldLog(level) {
        if (this.minLevel === LOG_LEVELS.none) {
            return false;
        }
        return LOG_LEVELS[level] <= this.minLevel;
    }

    formatMessage(level, message) {
        // Only format if we're going to log
        if (!this.shouldLog(level)) {
            return null;
        }

        const timestamp = new Date().toISOString();
        const prefix = this.context ? `[${this.context}]` : '';
        const levelStr = level.toUpperCase().padEnd(5);
        return `[${timestamp}] [${levelStr}] ${prefix} ${message}`;
    }

    log(level, message, ...args) {
        const formattedMessage = this.formatMessage(level, message);
        if (!formattedMessage) {
            return;
        }

        switch (level) {
            case 'error':
                console.error(formattedMessage, ...args);
                break;
            case 'warn':
                console.warn(formattedMessage, ...args);
                break;
            case 'debug':
                console.log(formattedMessage, ...args);
                break;
            case 'info':
            default:
                console.info(formattedMessage, ...args);
                break;
        }
    }

    debug(message, ...args) {
        this.log('debug', message, ...args);
    }

    info(message, ...args) {
        this.log('info', message, ...args);
    }

    warn(message, ...args) {
        this.log('warn', message, ...args);
    }

    error(message, ...args) {
        this.log('error', message, ...args);
    }

    logRequestTime(requestId, pathname, method, startTime) {
        if (!LOG_PERFORMANCE_METRICS || this.minLevel === LOG_LEVELS.none) {
            return;
        }

        const duration = Date.now() - startTime;
        const level = duration > 5000 ? 'warn' : duration > 1000 ? 'info' : 'debug';
        this[level](`Request ${requestId} | ${method} ${pathname} | Duration: ${duration}ms`);
    }

    setLogLevel(level) {
        const newLevel = level.toLowerCase();
        if (LOG_LEVELS.hasOwnProperty(newLevel)) {
            this.currentLevel = newLevel;
            this.minLevel = LOG_LEVELS[newLevel];
            this.debug(`Log level changed to: ${newLevel}`);
        } else {
            this.warn(`Invalid log level: ${level}. Using current level: ${this.currentLevel}`);
        }
    }

    getLogLevel() {
        return this.currentLevel;
    }
}
import { LOG_LEVEL} from '../core/constants.js';

const LOG_LEVELS = {
    none: -1,   // No log output
    error: 0,   // Only output errors
    warn: 1,    // Output warnings and errors
    info: 2,    // Output info, warnings and errors
    debug: 3    // Output all logs
};

export class Logger {
    constructor(context = '') {
        this.context = context;
        this.currentLevel = LOG_LEVEL.toLowerCase();
        this.minLevel = LOG_LEVELS[this.currentLevel] ?? LOG_LEVELS.info;
    }

    shouldLog(level) {
        // If set to none, don't output any logs
        if (this.minLevel === LOG_LEVELS.none) {
            return false;
        }
        return LOG_LEVELS[level] <= this.minLevel;
    }

    formatMessage(level, message) {
        const timestamp = new Date().toISOString();
        const prefix = this.context ? `[${this.context}]` : '';
        const levelStr = level.toUpperCase().padEnd(5);
        return `[${timestamp}] [${levelStr}] ${prefix} ${message}`;
    }

    log(level, message, ...args) {
        if (!this.shouldLog(level)) {
            return;
        }

        const formattedMessage = this.formatMessage(level, message);

        // Use different console methods based on log level
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
        if (this.minLevel === LOG_LEVELS.none) {
            return;
        }

        const duration = Date.now() - startTime;
        const level = duration > 5000 ? 'warn' : duration > 1000 ? 'info' : 'debug';
        this[level](`Request ${requestId} | ${method} ${pathname} | Duration: ${duration}ms`);
    }

    // Dynamically change log level (optional feature)
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

    // Get current log level
    getLogLevel() {
        return this.currentLevel;
    }
}

// Create a global log manager (optional)
export class LogManager {
    static loggers = new Map();
    static globalLevel = LOG_LEVEL.toLowerCase();

    static getLogger(context) {
        if (!this.loggers.has(context)) {
            this.loggers.set(context, new Logger(context));
        }
        return this.loggers.get(context);
    }

    static setGlobalLogLevel(level) {
        const newLevel = level.toLowerCase();
        if (LOG_LEVELS.hasOwnProperty(newLevel)) {
            this.globalLevel = newLevel;
            // Update all existing loggers
            this.loggers.forEach(logger => {
                logger.setLogLevel(newLevel);
            });
        }
    }

    static clearLoggers() {
        this.loggers.clear();
    }
}
/**
 * Edge Runtime compatible async utilities
 */

/**
 * Schedule a function to run asynchronously
 * Uses the most appropriate method available in the runtime
 */
export function scheduleAsync(fn) {
    // Try queueMicrotask first (fastest)
    if (typeof queueMicrotask !== 'undefined') {
        queueMicrotask(fn);
    }
    // Fallback to Promise.resolve().then()
    else {
        Promise.resolve().then(fn);
    }
}

/**
 * Schedule a function to run after a delay
 * @param {Function} fn - Function to run
 * @param {number} delay - Delay in milliseconds
 */
export function scheduleDelayed(fn, delay = 0) {
    return setTimeout(fn, delay);
}

/**
 * Create a deferred promise
 */
export function createDeferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
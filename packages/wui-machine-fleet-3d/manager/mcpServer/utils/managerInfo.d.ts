/**
 * Manager Information Utilities
 *
 * Utilities for retrieving information about the current JavaScript manager instance.
 * Uses process PID and PMON status to identify the own manager.
 */
/**
 * Get the manager number by matching process PID with PMON status.
 *
 * This function retrieves the current process PID and matches it against
 * the running managers in PMON to find the manager number.
 *
 * @returns Promise with the manager number if found, null otherwise
 */
export declare function getOwnManagerNumber(): Promise<number | null>;
/**
 * Get the manager number with caching.
 * First call matches PID with PMON, subsequent calls return cached value.
 *
 * @returns Promise with the manager number if found, null otherwise
 */
export declare function getOwnManagerNumberCached(): Promise<number | null>;
//# sourceMappingURL=managerInfo.d.ts.map
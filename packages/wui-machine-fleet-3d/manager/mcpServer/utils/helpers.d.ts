/**
 * Utility helper functions for MCP tool responses and datapoint operations
 */
import type { WinccoaManager } from 'winccoa-manager';
import type { McpContent, McpToolResponse, DatapointChild } from '../types/index.js';
/**
 * Create content array for MCP responses, filtering internal types if needed
 * @param arr - Array of type names
 * @param withInternals - Whether to include internal types (starting with _)
 * @returns Content array for MCP response
 */
export declare function mkTypesContent(arr: string[], withInternals?: boolean): McpContent[];
/**
 * Recursively add description and unit information to datapoint children
 * @param children - Array of child datapoint elements
 * @param parentPath - Parent datapoint path
 * @param winccoa - WinCC OA manager instance
 */
export declare function addDescriptionAndUnitsToChildren(children: DatapointChild[], parentPath: string, winccoa: WinccoaManager): void;
/**
 * Create standardized error response for MCP tools
 * @param message - Error message
 * @param codeOrDetails - Error code (string) or details object (optional)
 * @returns MCP error response
 */
export declare function createErrorResponse(message: string, codeOrDetails?: string | Record<string, any>): McpToolResponse;
/**
 * Create standardized success response for MCP tools
 * @param result - Result data
 * @param message - Optional success message
 * @returns MCP success response
 */
export declare function createSuccessResponse<T = any>(result: T, message?: string): McpToolResponse;
/**
 * Validate datapoint name format
 * @param dpName - Datapoint name to validate
 * @returns True if valid
 */
export declare function isValidDatapointName(dpName: string): boolean;
/**
 * Validate datapoint element for dpGet operations
 * Rejects asterisk (*) wildcard to prevent large responses
 * @param dpe - Datapoint element name to validate
 * @returns True if valid for dpGet
 */
export declare function isValidDatapointElementForGet(dpe: string): boolean;
/**
 * Validate array of datapoint elements for dpGet operations
 * @param dpes - Array of datapoint element names
 * @returns Validation result with invalid entries if any
 */
export declare function validateDatapointElementsForGet(dpes: string[]): {
    valid: boolean;
    invalid: string[];
};
//# sourceMappingURL=helpers.d.ts.map
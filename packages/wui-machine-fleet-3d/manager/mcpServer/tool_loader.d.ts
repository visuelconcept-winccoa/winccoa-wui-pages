/**
 * Tool Loader
 *
 * Dynamically loads and registers MCP tools based on configuration.
 */
import type { ServerContext, ToolRegistrationResult } from './types/index.js';
/**
 * Dynamically load and register tools based on TOOLS environment variable
 * @param server - The MCP server instance
 * @param context - Shared server context
 */
export declare function loadAllTools(server: any, context: ServerContext): Promise<void>;
/**
 * Load tools from a specific category (for testing)
 * @param server - The MCP server instance
 * @param context - Shared context
 * @param category - Tool category to load
 * @returns Results of tool registration
 */
export declare function loadToolCategory(server: any, context: ServerContext, category: string): Promise<ToolRegistrationResult[]>;
//# sourceMappingURL=tool_loader.d.ts.map
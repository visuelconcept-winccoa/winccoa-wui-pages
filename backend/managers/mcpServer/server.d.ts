/**
 * MCP Server Initialization
 *
 * Initializes the MCP server with WinCC OA manager, resources, and tools.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "./types/index.js";
/**
 * Initialize the MCP server with all tools and resources
 * @returns Configured MCP server
 */
export declare function initializeServer(): Promise<McpServer>;
/**
 * Get the current context (for testing or debugging)
 * @returns Current server context
 */
export declare function getContext(): ServerContext;
//# sourceMappingURL=server.d.ts.map
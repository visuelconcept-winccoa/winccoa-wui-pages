/**
 * OPC UA Connection Manager
 *
 * Provides functionality to create, configure, and browse OPC UA connections in WinCC OA.
 */
import { BaseConnection } from './BaseConnection.js';
import type { OpcUaConnectionConfig, BrowseEventSource, BrowseResult } from '../../types/index.js';
export { SecurityPolicy, MessageSecurityMode, OPCUA_DEFAULTS } from '../../types/index.js';
/**
 * OPC UA Connection Manager Class
 *
 * Extends BaseConnection with OPC UA-specific functionality.
 */
export declare class OpcUaConnection extends BaseConnection {
    /**
     * Cache for browse results
     * Key format: `${connectionName}:${nodeId}:${eventSource}:${depth}`
     */
    private browseCache;
    /**
     * Default TTL for cache entries (5 minutes in milliseconds)
     */
    private readonly DEFAULT_CACHE_TTL;
    /**
     * Maximum number of nodes to return in a single browse operation
     * Protects against context window overflow on client side
     * Set to 800 for optimal context usage with smart auto-depth
     */
    private readonly MAX_NODE_COUNT;
    /**
     * Browse operation timeout in milliseconds
     * Prevents indefinite hangs on problematic browse operations
     */
    private readonly BROWSE_TIMEOUT_MS;
    /**
     * Maximum cache size in bytes (50MB)
     * Prevents unbounded cache growth
     */
    private readonly MAX_CACHE_SIZE_BYTES;
    /**
     * Generate a unique browse request ID
     * @returns Unique request ID
     */
    private generateBrowseRequestId;
    /**
     * Generate cache key for browse results
     * @param connectionName - Connection name
     * @param nodeId - Node ID
     * @param eventSource - Event source type
     * @param depth - Browse depth
     * @returns Cache key
     */
    private generateBrowseCacheKey;
    /**
     * Get cached browse results if available and not expired
     * @param key - Cache key
     * @returns Cached nodes or undefined
     */
    private getCachedBrowseResults;
    /**
     * Cache browse results
     * @param key - Cache key
     * @param nodes - Browse nodes to cache
     * @param ttl - Time to live in milliseconds (optional, defaults to DEFAULT_CACHE_TTL)
     */
    private cacheBrowseResults;
    /**
     * Clear expired cache entries (automatic cleanup)
     */
    private cleanupExpiredCache;
    /**
     * Clear all cache entries for a specific connection
     * @param connectionName - Connection name
     */
    private clearConnectionCache;
    /**
     * Generate a unique connection name for OPC UA
     * @returns Connection name in format _OpcUAConnection<n>
     */
    generateConnectionName(): Promise<string>;
    /**
     * Ensure that the _OPCUA<managerNumber> datapoint exists
     * @param managerNumber - Manager number
     * @returns true on success
     */
    ensureOpcUaManagerDpExists(managerNumber: number): Promise<boolean>;
    /**
     * Validate the OPC UA connection configuration
     * @param config - Configuration to validate
     * @throws Error on invalid configuration
     */
    private validateConnectionConfig;
    /**
     * Validate that the OPC UA driver exists, is running, and has the correct manager number configured
     * @param managerNumber - The manager number to validate (e.g., 4 for _OPCUA4)
     * @returns Validation result with status, optional error message, and optional warnings
     */
    private validateOpcUaDriver;
    /**
     * Add server to running OPC UA driver using AddServer command
     * This allows the connection to be available immediately without driver restart
     * @param managerNumber - Manager number
     * @param connectionName - Connection name (WITHOUT leading underscore)
     * @returns true on success, false on failure (but logs warning only)
     */
    private addServerToRunningDriver;
    /**
     * Register the connection with the OPC UA manager
     * @param managerNumber - Manager number
     * @param connectionName - Connection name (WITHOUT leading underscore)
     * @returns true on success
     */
    private registerConnectionWithManager;
    /**
     * Configure the OPC UA connection
     * @param config - Connection configuration
     * @param connectionName - Connection name
     * @returns true on success
     */
    private configureConnection;
    /**
     * Browse a single level (depth=1) for size estimation
     * Used to check address space size before allowing deep browsing
     *
     * @param connDp - Connection datapoint name (with _ prefix)
     * @param nodeId - Node ID to browse
     * @param eventSource - Event source type
     * @returns Promise with array of direct children nodes
     */
    private browseSingleLevel;
    /**
     * Build branch estimates from browse results
     * Analyzes flat browse results to identify large branches
     *
     * @param nodes - Flat array of browse nodes
     * @param parentNodeId - Parent node that was browsed
     * @returns Array of branch information for branches with > 100 estimated children
     */
    private buildBranchEstimates;
    /**
     * Browse with automatic depth selection (smart auto-depth)
     * Tries depth=2 first, retries with depth=1 if result exceeds 800 nodes
     * Uses 'auto' cache key to maximize cache hit rate
     *
     * @param connectionName - Connection name
     * @param parentNodeId - Parent node ID to browse
     * @param eventSource - Event source type
     * @param useCache - Use cached results
     * @param refreshCache - Force refresh cache
     * @param maxNodes - Maximum nodes to return (default: 800)
     * @returns Browse result with actualDepthUsed metadata
     */
    private browseWithAutoDepth;
    /**
     * Selective recursive browse (Option C)
     * Pre-checks depth=1, then selectively browses children to stay under maxNodes
     * Maximizes depth within node budget
     *
     * @param connectionName - Connection name
     * @param parentNodeId - Parent node ID to browse
     * @param eventSource - Event source type
     * @param useCache - Use cached results
     * @param refreshCache - Force refresh cache
     * @param maxNodes - Maximum total nodes to return (default: 800)
     * @returns Browse result with expandableBranches metadata
     */
    private selectiveBrowse;
    /**
     * Estimate safe depth for batched browsing based on remaining budget
     * Uses hasChildren information and conservative estimates to avoid exceeding limits
     *
     * @param remainingBudget - Number of nodes remaining in budget
     * @param parentNode - Parent node being browsed (optional, for hasChildren hint)
     * @returns Recommended depth for next browse operation (1-3)
     */
    private estimateSafeDepth;
    /**
     * Check if OPC UA connection is established and ready for browsing
     * Uses Common.State.ConnState (unified driver state across all WinCC OA drivers)
     * @param connDp - Connection datapoint name (with _ prefix)
     * @throws Error if connection is not established (Common.State.ConnState < 256)
     */
    private checkConnectionEstablished;
    /**
     * Browse full branch recursively using depth-first exploration
     * Explores entire branch to leaf nodes, minimizing API calls by using batched depth
     *
     * @param connectionName - Connection name (with _ prefix)
     * @param startNodeId - Starting node ID for branch
     * @param eventSource - Event source type
     * @param softLimit - Soft limit for node count (default: 800, orientation)
     * @param hardLimit - Hard limit for node count (default: 1000, absolute maximum)
     * @param maxDepth - Maximum recursion depth (default: 10, safety limit)
     * @param useCache - Use cached results
     * @param refreshCache - Force refresh cache
     * @returns Browse result with full branch exploration
     */
    private browseFullBranch;
    /**
     * Browse the OPC UA address space with smart auto-depth and pagination
     *
     * @param connectionName - Name of the connection (e.g., '_OpcUAConnection1')
     * @param parentNodeId - Node ID of the parent node (optional, default: "ns=0;i=85" for Objects folder)
     * @param eventSource - 0=Value (default), 1=Event, 2=Alarm&Condition
     * @param depth - Number of levels to browse (optional). If not specified, auto-selects depth=1 or 2 based on address space size.
     *                When specified: 1-5 allowed. User-specified depths are validated (rejected if would exceed 800 nodes).
     * @param useCache - Use cached results if available (default: true)
     * @param refreshCache - Force refresh cache (default: false)
     * @param maxNodeCount - Maximum nodes to return (default: 800). Prevents context overflow.
     * @param offset - Starting position for pagination (default: 0). Skip first N nodes.
     * @param limit - Max nodes per page (default: 800, max: 800). Use with offset for pagination.
     * @returns Promise with browse result including nodes and pagination metadata
     */
    browse(connectionName: string, parentNodeId?: string, eventSource?: BrowseEventSource, depth?: number, useCache?: boolean, refreshCache?: boolean, maxNodeCount?: number, offset?: number, limit?: number): Promise<BrowseResult>;
    /**
     * Get detailed node information for specific nodes (batch operation)
     * COMMENTED OUT: NodeDetails type was removed along with opcua_node_details tool
     * Can be re-enabled if needed by adding back NodeDetails type definition
     *
     * @param connectionName - Name of the connection (e.g., '_OpcUAConnection1')
     * @param nodeIds - Array of node IDs to fetch details for
     * @returns Promise with array of node details
     */
    /**
     * Get manager number for a given OPC UA connection
     * Searches for which _OPCUA{num} manager has this connection registered
     *
     * @param connectionName - Connection name (normalized with _ prefix)
     * @returns Manager number (1-255)
     * @throws Error if no manager found
     */
    private getManagerNumberForConnection;
    /**
     * Validate manager number and check if connection is registered with it
     *
     * @param managerNumber - Manager number to validate
     * @param connectionName - Connection name (normalized with _ prefix)
     * @throws Error if validation fails
     */
    private validateManagerNumberForConnection;
    /**
     * Ensure that a poll group exists for polling or spontaneous mode
     *
     * Based on reference implementation IT_OT_BL.ctl lines 1014-1041:
     * - Uses _PollGroup type (not _OPCUASubscription)
     * - For polling mode: Uses PollInterval to control how often data is queried
     * - For spontaneous mode: Just needs a name in _poll_group attribute
     * - Poll group can be shared across multiple datapoints
     *
     * @param subscriptionName - Poll group/subscription name (e.g., '_DefaultSubscription' or 'DefaultSubscription')
     * @param connectionName - Connection name (normalized with _ prefix)
     * @returns Poll group name with _ prefix
     * @throws Error if poll group cannot be created
     */
    private ensureSubscriptionExists;
    /**
     * Build OPC UA reference string
     * Format: ConnectionName$$1$1$NodeId (note the DOUBLE $$)
     *
     * IMPORTANT: Based on reference implementation IT_OT_BL.ctl line 1048:
     * - Use DOUBLE dollar signs $$ between connection and mode
     * - Do NOT include subscription name in reference string
     * - Subscription is specified separately in _poll_group attribute
     *
     * @param connectionName - Connection name (with _ prefix, e.g., '_OpcUAConnection1')
     * @param nodeId - OPC UA Node ID (e.g., 'ns=2;s=MyVariable')
     * @returns Formatted reference string
     */
    private buildReferenceString;
    /**
     * Configure address and distribution settings for an OPC UA datapoint element
     * Sets both _address and _distrib configs with OPC UA-specific parameters
     *
     * @param dpName - Full datapoint element name (e.g., 'MyDatapoint.Value')
     * @param connectionName - OPC UA connection name (with or without _ prefix)
     * @param reference - OPC UA NodeId reference (e.g., 'ns=2;s=MyVariable')
     * @param datatype - OPC UA transformation type (750-768, default: 750=DEFAULT)
     * @param direction - Address direction mode (0-15, default: 4=INPUT_POLL)
     * @param active - Activate address immediately (default: true)
     * @param managerNumber - Optional manager number (1-255). If not specified, auto-detected.
     * @param subscription - Optional poll group name. If not specified, uses '_DefaultPollingFast'.
     * @returns true on success
     * @throws Error with detailed message on failure
     */
    addAddressConfig(dpName: string, connectionName: string, reference: string, datatype?: number, direction?: number, active?: boolean, managerNumber?: number, subscription?: string): Promise<boolean>;
    /**
     * Create and configure an OPC UA client connection
     *
     * @param config - Configuration of the OPC UA connection
     * @returns Connection name on success, throws Error on failure
     */
    addConnection(config: OpcUaConnectionConfig): Promise<string>;
    /**
     * Delete an OPC UA connection
     *
     * Completely removes an OPC UA connection by:
     * 1. Removing it from the manager's server list (_OPCUA{num}.Config.Servers)
     * 2. Deleting the connection datapoint
     * 3. If no connections remain on the driver:
     *    - Stops the OPC UA driver
     *    - Removes the driver from Pmon
     *    - Deletes the _OPCUA{num} manager datapoint
     * 4. Cleans up any other unused _OPCUA{num} datapoints (those with empty server lists)
     *
     * This provides complete cleanup - the entire OPC UA infrastructure is removed
     * if no longer needed, including orphaned manager datapoints.
     *
     * Note: The driver may need to be restarted for the changes to take full effect,
     * or will reload automatically if configured to do so.
     *
     * @param connectionName - Name of the connection to delete (with or without _ prefix)
     * @param managerNumber - Optional manager number. If not specified, will be auto-detected.
     * @returns true on success, throws Error on failure
     */
    deleteConnection(connectionName: string, managerNumber?: number): Promise<boolean>;
}
export default OpcUaConnection;
//# sourceMappingURL=OpcUaConnection.d.ts.map
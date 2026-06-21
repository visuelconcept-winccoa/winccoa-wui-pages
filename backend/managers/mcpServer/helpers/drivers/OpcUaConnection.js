/**
 * OPC UA Connection Manager
 *
 * Provides functionality to create, configure, and browse OPC UA connections in WinCC OA.
 */
import { BaseConnection } from './BaseConnection.js';
import { DpConfigType, OpcUaDatatype, DpAddressDirection } from '../../types/index.js';
import { PmonClient } from '../pmon/PmonClient.js';
import { ManagerState } from '../../types/pmon/protocol.js';
// Re-export enums and constants for backward compatibility
export { SecurityPolicy, MessageSecurityMode, OPCUA_DEFAULTS } from '../../types/index.js';
/**
 * OPC UA Connection Manager Class
 *
 * Extends BaseConnection with OPC UA-specific functionality.
 */
export class OpcUaConnection extends BaseConnection {
    constructor() {
        super(...arguments);
        /**
         * Cache for browse results
         * Key format: `${connectionName}:${nodeId}:${eventSource}:${depth}`
         */
        this.browseCache = new Map();
        /**
         * Default TTL for cache entries (5 minutes in milliseconds)
         */
        this.DEFAULT_CACHE_TTL = 5 * 60 * 1000;
        /**
         * Maximum number of nodes to return in a single browse operation
         * Protects against context window overflow on client side
         * Set to 800 for optimal context usage with smart auto-depth
         */
        this.MAX_NODE_COUNT = 800;
        /**
         * Browse operation timeout in milliseconds
         * Prevents indefinite hangs on problematic browse operations
         */
        this.BROWSE_TIMEOUT_MS = 120000; // 120 seconds (2 minutes)
        /**
         * Maximum cache size in bytes (50MB)
         * Prevents unbounded cache growth
         */
        this.MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024;
    }
    /**
     * Generate a unique browse request ID
     * @returns Unique request ID
     */
    generateBrowseRequestId() {
        return `browse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    /**
     * Generate cache key for browse results
     * @param connectionName - Connection name
     * @param nodeId - Node ID
     * @param eventSource - Event source type
     * @param depth - Browse depth
     * @returns Cache key
     */
    generateBrowseCacheKey(connectionName, nodeId, eventSource, depth) {
        return `${connectionName}:${nodeId}:${eventSource}:${depth}`;
    }
    /**
     * Get cached browse results if available and not expired
     * @param key - Cache key
     * @returns Cached nodes or undefined
     */
    getCachedBrowseResults(key) {
        const entry = this.browseCache.get(key);
        if (!entry) {
            return undefined;
        }
        const now = Date.now();
        if (now - entry.timestamp > entry.ttl) {
            // Entry expired, remove it
            this.browseCache.delete(key);
            return undefined;
        }
        console.log(`✓ Cache HIT for ${key}`);
        return entry.nodes;
    }
    /**
     * Cache browse results
     * @param key - Cache key
     * @param nodes - Browse nodes to cache
     * @param ttl - Time to live in milliseconds (optional, defaults to DEFAULT_CACHE_TTL)
     */
    cacheBrowseResults(key, nodes, ttl) {
        this.browseCache.set(key, {
            nodes,
            timestamp: Date.now(),
            ttl: ttl ?? this.DEFAULT_CACHE_TTL
        });
        console.log(`✓ Cached ${nodes.length} nodes for ${key} (TTL: ${ttl ?? this.DEFAULT_CACHE_TTL}ms)`);
    }
    /**
     * Clear expired cache entries (automatic cleanup)
     */
    cleanupExpiredCache() {
        const now = Date.now();
        let removedCount = 0;
        for (const [key, entry] of this.browseCache.entries()) {
            if (now - entry.timestamp > entry.ttl) {
                this.browseCache.delete(key);
                removedCount++;
            }
        }
        if (removedCount > 0) {
            console.log(`✓ Cleaned up ${removedCount} expired cache entries`);
        }
    }
    /**
     * Clear all cache entries for a specific connection
     * @param connectionName - Connection name
     */
    clearConnectionCache(connectionName) {
        let removedCount = 0;
        for (const key of this.browseCache.keys()) {
            if (key.startsWith(`${connectionName}:`)) {
                this.browseCache.delete(key);
                removedCount++;
            }
        }
        if (removedCount > 0) {
            console.log(`✓ Cleared ${removedCount} cache entries for connection ${connectionName}`);
        }
    }
    /**
     * Generate a unique connection name for OPC UA
     * @returns Connection name in format _OpcUAConnection<n>
     */
    async generateConnectionName() {
        return super.generateConnectionName('_OpcUAConnection');
    }
    /**
     * Ensure that the _OPCUA<managerNumber> datapoint exists
     * @param managerNumber - Manager number
     * @returns true on success
     */
    async ensureOpcUaManagerDpExists(managerNumber) {
        try {
            const dpName = `_OPCUA${managerNumber}`;
            if (this.checkDpExists(dpName)) {
                console.log(`Manager datapoint ${dpName} already exists`);
                return true;
            }
            console.log(`Creating manager datapoint ${dpName} of type _OPCUA`);
            const created = await this.winccoa.dpCreate(dpName, '_OPCUA');
            if (!created) {
                console.error(`Failed to create manager datapoint ${dpName}`);
                return false;
            }
            console.log(`Successfully created manager datapoint ${dpName}`);
            return true;
        }
        catch (error) {
            console.error(`Error ensuring manager datapoint exists:`, error);
            return false;
        }
    }
    /**
     * Validate the OPC UA connection configuration
     * @param config - Configuration to validate
     * @throws Error on invalid configuration
     */
    validateConnectionConfig(config) {
        // Validate IP address
        if (!this.validateIpAddress(config.ipAddress)) {
            throw new Error(`Invalid IP address or hostname: ${config.ipAddress}`);
        }
        // Validate port
        if (!this.validatePort(config.port)) {
            throw new Error(`Invalid port number: ${config.port}. Must be between 1 and 65535`);
        }
        // Validate manager number
        if (!this.validateManagerNumber(config.managerNumber)) {
            throw new Error(`Invalid manager number: ${config.managerNumber}. Must be between 1 and 99`);
        }
        // Validate reconnect timer
        if (config.reconnectTimer !== undefined && config.reconnectTimer <= 0) {
            throw new Error('Reconnect timer must be positive');
        }
    }
    /**
     * Validate that the OPC UA driver exists, is running, and has the correct manager number configured
     * @param managerNumber - The manager number to validate (e.g., 4 for _OPCUA4)
     * @returns Validation result with status, optional error message, and optional warnings
     */
    async validateOpcUaDriver(managerNumber) {
        const warnings = [];
        try {
            console.log(`🔍 Validating OPC UA driver for manager number ${managerNumber}...`);
            // 1. Ensure the manager datapoint exists (create if necessary)
            const managerDp = `_OPCUA${managerNumber}`;
            if (!this.checkDpExists(managerDp)) {
                console.log(`⚠️  Manager datapoint ${managerDp} does not exist`);
                console.log(`🔧 Creating manager datapoint ${managerDp}...`);
                try {
                    const created = await this.winccoa.dpCreate(managerDp, '_OPCUA');
                    if (!created) {
                        console.error(`❌ Failed to create manager datapoint ${managerDp}`);
                        return {
                            valid: false,
                            error: `OPC UA Manager datapoint ${managerDp} does not exist and could not be created automatically. Please create it manually using dpCreate("${managerDp}", "_OPCUA").`
                        };
                    }
                    console.log(`✅ Successfully created manager datapoint ${managerDp}`);
                    warnings.push(`Manager datapoint ${managerDp} was automatically created.`);
                }
                catch (createError) {
                    const errorMsg = createError instanceof Error ? createError.message : String(createError);
                    console.error(`❌ Error creating manager datapoint: ${errorMsg}`);
                    return {
                        valid: false,
                        error: `Failed to create manager datapoint ${managerDp}: ${errorMsg}. Please create it manually.`
                    };
                }
            }
            else {
                console.log(`✓ Manager datapoint ${managerDp} exists`);
            }
            // 1b. Ensure the _Driver{num} datapoint exists (required by WinCC OA driver infrastructure)
            const driverDp = `_Driver${managerNumber}`;
            if (!this.checkDpExists(driverDp)) {
                console.log(`🔧 Creating driver common datapoint ${driverDp}...`);
                try {
                    const createdDriver = await this.winccoa.dpCreate(driverDp, '_DriverCommon');
                    if (!createdDriver) {
                        console.warn(`⚠️  Failed to create driver common datapoint ${driverDp}`);
                        warnings.push(`Could not create driver common datapoint ${driverDp}.`);
                    }
                    else {
                        console.log(`✅ Successfully created driver common datapoint ${driverDp}`);
                        warnings.push(`Driver common datapoint ${driverDp} was automatically created.`);
                    }
                }
                catch (createDriverError) {
                    const errorMsg = createDriverError instanceof Error ? createDriverError.message : String(createDriverError);
                    console.warn(`⚠️  Error creating driver common datapoint: ${errorMsg}`);
                    warnings.push(`Could not create driver common datapoint ${driverDp}: ${errorMsg}`);
                }
            }
            else {
                console.log(`✓ Driver common datapoint ${driverDp} exists`);
            }
            // 2. Connect to Pmon and get manager status
            const pmonClient = new PmonClient();
            let status;
            let managerList;
            try {
                status = await pmonClient.getManagerStatus();
                managerList = await pmonClient.getManagerList();
                console.log(`✓ Connected to Pmon, found ${status.managers.length} managers`);
            }
            catch (pmonError) {
                const errorMsg = pmonError instanceof Error ? pmonError.message : String(pmonError);
                console.warn(`⚠️  Could not connect to Pmon: ${errorMsg}`);
                warnings.push(`Could not verify driver status via Pmon: ${errorMsg}. ` +
                    `Connection may fail if driver is not running. ` +
                    `Please ensure the OPC UA driver with '-num ${managerNumber}' is configured and running.`);
                return {
                    valid: true,
                    warnings
                };
            }
            // 3. First, check if the requested manager number is already in use by ANY driver
            const usedManagerNumbers = new Set();
            for (let i = 0; i < status.managers.length; i++) {
                const mgr = status.managers[i];
                if (!mgr)
                    continue;
                const mgrDetails = managerList[mgr.index];
                if (!mgrDetails)
                    continue;
                const commandLineStr = mgrDetails.commandlineOptions || '';
                // Extract -num parameter, default to 1 if not specified
                const numMatch = commandLineStr.match(/-num\s+(\d+)/);
                const configuredNum = numMatch && numMatch[1] ? parseInt(numMatch[1], 10) : 1;
                usedManagerNumbers.add(configuredNum);
            }
            console.log(`Currently used manager numbers: ${Array.from(usedManagerNumbers).sort((a, b) => a - b).join(', ')}`);
            // Check if requested manager number is already taken
            if (usedManagerNumbers.has(managerNumber)) {
                // Find which driver is using this number
                let conflictingDriver = null;
                for (let i = 0; i < status.managers.length; i++) {
                    const mgr = status.managers[i];
                    if (!mgr)
                        continue;
                    const mgrDetails = managerList[mgr.index];
                    if (!mgrDetails)
                        continue;
                    const commandLineStr = mgrDetails.commandlineOptions || '';
                    const numMatch = commandLineStr.match(/-num\s+(\d+)/);
                    const configuredNum = numMatch && numMatch[1] ? parseInt(numMatch[1], 10) : 1;
                    if (configuredNum === managerNumber) {
                        const managerNameStr = mgrDetails.manager || 'unknown';
                        const isOpcUaDriver = managerNameStr.toLowerCase().includes('opcua') ||
                            managerNameStr.toLowerCase().includes('opc-ua');
                        if (isOpcUaDriver) {
                            // It's an OPC UA driver - we can use it!
                            conflictingDriver = null;
                            break;
                        }
                        else {
                            // It's a different driver type
                            conflictingDriver = managerNameStr;
                            if (!numMatch) {
                                conflictingDriver += ' (running without -num parameter, implicitly uses -num 1)';
                            }
                        }
                    }
                }
                if (conflictingDriver) {
                    console.error(`❌ Manager number ${managerNumber} is already in use by: ${conflictingDriver}`);
                    return {
                        valid: false,
                        error: `Manager number ${managerNumber} is already in use by another driver: ${conflictingDriver}.\n\n` +
                            `Currently used manager numbers: ${Array.from(usedManagerNumbers).sort((a, b) => a - b).join(', ')}\n\n` +
                            `Please choose a different manager number (1-99) that is not already in use.`
                    };
                }
            }
            // 4. Search for OPC UA driver with the correct manager number
            let driverFound = false;
            let driverRunning = false;
            let driverIndex = null;
            let driverName = '';
            for (let i = 0; i < status.managers.length; i++) {
                const mgr = status.managers[i];
                if (!mgr)
                    continue;
                const mgrDetails = managerList[mgr.index];
                if (!mgrDetails)
                    continue;
                // Check if this is an OPC UA driver (look for OPCUA in the manager name)
                const isOpcUaDriver = mgrDetails.manager?.toLowerCase().includes('opcua') ||
                    mgrDetails.manager?.toLowerCase().includes('opc-ua');
                if (isOpcUaDriver) {
                    const managerNameStr = mgrDetails.manager || 'unknown';
                    const commandLineStr = mgrDetails.commandlineOptions || '';
                    console.log(`  Found OPC UA manager: ${managerNameStr}, options: "${commandLineStr}"`);
                    // Check if the manager number matches (look for "-num X" in command line options)
                    // IMPORTANT: Drivers without -num parameter implicitly run as -num 1
                    const numMatch = commandLineStr.match(/-num\s+(\d+)/);
                    const configuredNum = numMatch && numMatch[1] ? parseInt(numMatch[1], 10) : 1; // Default to 1 if no -num specified
                    if (configuredNum === managerNumber) {
                        driverFound = true;
                        driverIndex = mgr.index;
                        driverName = managerNameStr;
                        driverRunning = (mgr.state === ManagerState.Running);
                        if (numMatch) {
                            console.log(`✓ Found matching OPC UA driver '${driverName}' at index ${driverIndex} with -num ${managerNumber}`);
                        }
                        else {
                            console.log(`✓ Found matching OPC UA driver '${driverName}' at index ${driverIndex} (running as -num 1 by default, no -num specified)`);
                        }
                        console.log(`  Driver state: ${driverRunning ? 'RUNNING' : 'NOT RUNNING'} (state code: ${mgr.state})`);
                        break;
                    }
                }
            }
            // 5. Evaluate results and auto-create driver if missing
            if (!driverFound) {
                console.log(`❌ No OPC UA driver with '-num ${managerNumber}' found`);
                console.log(`🔧 Attempting to automatically create OPC UA driver...`);
                try {
                    // Try different manager names for different WinCC OA versions
                    const managerNames = ['WCCOAopcua', 'WCCOAopcuadrv'];
                    let addedSuccessfully = false;
                    let usedManagerName = '';
                    let usedPosition = 0;
                    for (const managerName of managerNames) {
                        // Find a free position for the new manager (after existing managers)
                        // Try to find the highest index and add after it
                        let maxIndex = 0;
                        for (const mgr of status.managers) {
                            if (mgr && mgr.index > maxIndex) {
                                maxIndex = mgr.index;
                            }
                        }
                        const nextPosition = maxIndex + 1;
                        console.log(`🔧 Trying to add manager '${managerName}' at position ${nextPosition}...`);
                        // Add the OPC UA driver using PmonClient with 'once' start option
                        const addResult = await pmonClient.addManager(nextPosition, managerName, 'once', 30, 3, 5, `-num ${managerNumber}`);
                        if (addResult.success) {
                            console.log(`✅ Successfully added OPC UA driver '${managerName}' at position ${nextPosition}`);
                            addedSuccessfully = true;
                            usedManagerName = managerName;
                            usedPosition = nextPosition;
                            break;
                        }
                        else {
                            console.warn(`⚠️  Failed to add manager '${managerName}': ${addResult.error}`);
                            // Try next manager name
                        }
                    }
                    if (!addedSuccessfully) {
                        console.error(`❌ Failed to add OPC UA driver with any manager name`);
                        return {
                            valid: false,
                            error: `No OPC UA driver with '-num ${managerNumber}' found and automatic creation failed.\n\n` +
                                `Tried manager names: ${managerNames.join(', ')}\n\n` +
                                `Please add the driver manually via WinCC OA Console:\n` +
                                `  1. Open Console and go to Para -> Distributed Systems -> Managers\n` +
                                `  2. Add new manager: ${managerNames[0]}\n` +
                                `  3. Options: -num ${managerNumber}\n` +
                                `  4. Start mode: always\n` +
                                `  5. Apply and start the manager`
                        };
                    }
                    console.log(`✅ Manager '${usedManagerName}' added to Pmon at position ${usedPosition}`);
                    // Wait a moment for Pmon to process
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    // Verify the manager was actually added by refreshing the status
                    console.log(`🔍 Verifying manager was added to Pmon...`);
                    const verifyStatus = await pmonClient.getManagerStatus();
                    const verifyList = await pmonClient.getManagerList();
                    let verified = false;
                    for (let i = 0; i < verifyStatus.managers.length; i++) {
                        const mgr = verifyStatus.managers[i];
                        if (!mgr)
                            continue;
                        const mgrDetails = verifyList[mgr.index];
                        if (!mgrDetails)
                            continue;
                        if (mgrDetails.manager === usedManagerName &&
                            mgrDetails.commandlineOptions?.includes(`-num ${managerNumber}`)) {
                            verified = true;
                            usedPosition = mgr.index;
                            console.log(`✅ Verified: Manager '${usedManagerName}' is in Pmon at index ${usedPosition}`);
                            break;
                        }
                    }
                    if (!verified) {
                        console.error(`❌ Manager was reported as added but cannot be found in Pmon`);
                        warnings.push(`OPC UA driver '${usedManagerName}' was added to Pmon configuration but verification failed. ` +
                            `Please check WinCC OA Console to verify the manager exists and start it manually if needed.`);
                        return {
                            valid: true,
                            warnings
                        };
                    }
                    // Try to start the newly created driver
                    console.log(`🔧 Attempting to start the OPC UA driver at index ${usedPosition}...`);
                    const startResult = await pmonClient.startManager(usedPosition);
                    if (startResult.success) {
                        console.log(`✅ Successfully started OPC UA driver '${usedManagerName}' at index ${usedPosition}`);
                        warnings.push(`OPC UA driver '${usedManagerName}' was automatically created and started at position ${usedPosition}. ` +
                            `The driver is now running and ready for connections.`);
                    }
                    else {
                        console.warn(`⚠️  Driver created but failed to start: ${startResult.error}`);
                        warnings.push(`OPC UA driver '${usedManagerName}' was automatically created at position ${usedPosition} but could not be started. ` +
                            `Error: ${startResult.error}. ` +
                            `Please start it manually using WinCC OA Console. ` +
                            `The connection will work after starting the driver.`);
                    }
                    // Driver was created, continue with success
                    return {
                        valid: true,
                        warnings: warnings.length > 0 ? warnings : undefined
                    };
                }
                catch (createError) {
                    const createErrorMsg = createError instanceof Error ? createError.message : String(createError);
                    console.error(`❌ Error creating OPC UA driver:`, createErrorMsg);
                    return {
                        valid: false,
                        error: `No OPC UA driver with '-num ${managerNumber}' found and automatic creation failed.\n\n` +
                            `Error: ${createErrorMsg}\n\n` +
                            `Please add the driver manually:\n` +
                            `  1. Open WinCC OA Console -> Para -> Distributed Systems -> Managers\n` +
                            `  2. Add manager: WCCOAopcua (or WCCOAopcuadrv)\n` +
                            `  3. Options: -num ${managerNumber}\n` +
                            `  4. Start mode: always\n` +
                            `  5. Apply and start the driver`
                    };
                }
            }
            if (!driverRunning) {
                console.log(`⚠️  Driver found but not running (index ${driverIndex})`);
                console.log(`🔧 Attempting to start the OPC UA driver...`);
                try {
                    const startResult = await pmonClient.startManager(driverIndex);
                    if (startResult.success) {
                        console.log(`✅ Successfully started OPC UA driver '${driverName}' at index ${driverIndex}`);
                        warnings.push(`OPC UA driver '${driverName}' (index ${driverIndex}) was not running and has been automatically started. ` +
                            `The driver is now ready for connections.`);
                    }
                    else {
                        console.warn(`⚠️  Failed to start driver: ${startResult.error}`);
                        warnings.push(`OPC UA driver '${driverName}' (index ${driverIndex}) exists with '-num ${managerNumber}' ` +
                            `but is not running and could not be started automatically. ` +
                            `Error: ${startResult.error}. ` +
                            `Please start it manually using WinCC OA Console. ` +
                            `The connection will work after starting the driver.`);
                    }
                }
                catch (startError) {
                    const startErrorMsg = startError instanceof Error ? startError.message : String(startError);
                    console.error(`❌ Error starting driver:`, startErrorMsg);
                    warnings.push(`OPC UA driver '${driverName}' (index ${driverIndex}) exists but is not running. ` +
                        `Automatic start failed: ${startErrorMsg}. ` +
                        `Please start it manually using WinCC OA Console.`);
                }
            }
            console.log(`✓ OPC UA driver validation completed successfully`);
            return {
                valid: true,
                warnings: warnings.length > 0 ? warnings : undefined
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`❌ Error during driver validation:`, errorMessage);
            // If validation fails due to unexpected error, warn but don't block
            warnings.push(`Driver validation encountered an error: ${errorMessage}. ` +
                `Proceeding with connection creation, but please verify the driver configuration manually.`);
            return {
                valid: true,
                warnings
            };
        }
    }
    /**
     * Add server to running OPC UA driver using AddServer command
     * This allows the connection to be available immediately without driver restart
     * @param managerNumber - Manager number
     * @param connectionName - Connection name (WITHOUT leading underscore)
     * @returns true on success, false on failure (but logs warning only)
     */
    async addServerToRunningDriver(managerNumber, connectionName) {
        try {
            const managerDpName = `_OPCUA${managerNumber}`;
            const cmdAddServer = `${managerDpName}.Command.AddServer`;
            // Connection name without leading underscore
            const nameWithoutUnderscore = connectionName.startsWith('_')
                ? connectionName.substring(1)
                : connectionName;
            // Check if the Command.AddServer datapoint element exists
            if (!this.checkDpExists(managerDpName)) {
                console.warn(`Manager datapoint ${managerDpName} does not exist, skipping AddServer command`);
                return false;
            }
            console.log(`Triggering AddServer command for connection ${nameWithoutUnderscore} on running driver ${managerDpName}`);
            // Trigger AddServer command with connection name
            // This command adds the server to the running driver without restart
            await this.winccoa.dpSetWait(cmdAddServer, nameWithoutUnderscore);
            console.log(`✓ Successfully triggered AddServer command for ${nameWithoutUnderscore}`);
            return true;
        }
        catch (error) {
            // Don't fail the entire operation if AddServer command fails
            // The connection is already registered in Config.Servers, so it will work after driver restart
            console.warn(`Warning: Could not trigger AddServer command (driver may not be running or command not available):`, error);
            console.warn(`Connection will be available after driver restart`);
            return false;
        }
    }
    /**
     * Register the connection with the OPC UA manager
     * @param managerNumber - Manager number
     * @param connectionName - Connection name (WITHOUT leading underscore)
     * @returns true on success
     */
    async registerConnectionWithManager(managerNumber, connectionName) {
        try {
            const managerDpName = `_OPCUA${managerNumber}`;
            // Connection name without leading underscore
            const nameWithoutUnderscore = connectionName.startsWith('_')
                ? connectionName.substring(1)
                : connectionName;
            // Get current server list
            const currentServersRaw = await this.winccoa.dpGet(`${managerDpName}.Config.Servers`);
            const currentServers = Array.isArray(currentServersRaw) ? currentServersRaw : [];
            // Check if connection is already registered
            if (currentServers.includes(nameWithoutUnderscore)) {
                console.log(`Connection ${nameWithoutUnderscore} already registered with manager ${managerNumber}`);
                return true;
            }
            // Add connection to the list
            currentServers.push(nameWithoutUnderscore);
            console.log(`Registering connection ${nameWithoutUnderscore} with manager ${managerNumber}`);
            await this.winccoa.dpSetWait(`${managerDpName}.Config.Servers`, currentServers);
            console.log(`Successfully registered connection ${nameWithoutUnderscore}`);
            // Trigger AddServer command to add server to running driver (if available)
            // This eliminates the need for driver restart
            await this.addServerToRunningDriver(managerNumber, nameWithoutUnderscore);
            return true;
        }
        catch (error) {
            console.error(`Error registering connection with manager:`, error);
            return false;
        }
    }
    /**
     * Configure the OPC UA connection
     * @param config - Connection configuration
     * @param connectionName - Connection name
     * @returns true on success
     */
    async configureConnection(config, connectionName) {
        try {
            const serverUrl = `opc.tcp://${config.ipAddress}:${config.port}`;
            // Get defaults from imported constant
            const defaults = await import('../../types/index.js').then(m => m.OPCUA_DEFAULTS);
            // Basic configuration
            const dpes = [
                `${connectionName}.Config.ConnInfo`,
                `${connectionName}.Config.AccessInfo`,
                `${connectionName}.Config.Password`,
                `${connectionName}.Config.Security.Policy`,
                `${connectionName}.Config.Security.MessageMode`,
                `${connectionName}.Config.Security.Certificate`,
                `${connectionName}.Config.Active`,
                `${connectionName}.Config.ReconnectTimer`,
                `${connectionName}.Config.Separator`,
                `${connectionName}.Config.Flags`,
                `${connectionName}.Redu.Config.ConnInfo`,
                `${connectionName}.Redu.Config.Active`
            ];
            const values = [
                serverUrl, // ConnInfo
                config.username || '', // AccessInfo (Username)
                config.password ? Buffer.from(config.password, 'utf-8') : Buffer.alloc(0), // Password (blob type)
                config.securityPolicy ?? defaults.securityPolicy, // Security Policy
                config.messageSecurityMode ?? defaults.messageSecurityMode, // Message Mode
                config.clientCertificate || '', // Client Certificate
                (config.enableConnection ?? defaults.enableConnection) ? 1 : 0, // Active
                config.reconnectTimer ?? defaults.reconnectTimer, // ReconnectTimer
                config.separator ?? defaults.separator, // Separator
                0, // Flags (default)
                'opc.tcp://', // Redu.ConnInfo (empty)
                0 // Redu.Active (inactive)
            ];
            console.log(`Configuring connection ${connectionName}:`);
            console.log(`- Server URL: ${serverUrl}`);
            console.log(`- Authentication: ${config.username ? 'Username/Password' : 'Anonymous'}`);
            console.log(`- Reconnect Timer: ${config.reconnectTimer ?? defaults.reconnectTimer} seconds`);
            // Set the configuration
            await this.winccoa.dpSetWait(dpes, values);
            console.log(`Successfully configured connection ${connectionName}`);
            return true;
        }
        catch (error) {
            console.error(`Error configuring connection:`, error);
            return false;
        }
    }
    /**
     * Browse a single level (depth=1) for size estimation
     * Used to check address space size before allowing deep browsing
     *
     * @param connDp - Connection datapoint name (with _ prefix)
     * @param nodeId - Node ID to browse
     * @param eventSource - Event source type
     * @returns Promise with array of direct children nodes
     */
    async browseSingleLevel(connDp, nodeId, eventSource) {
        try {
            const requestId = this.generateBrowseRequestId();
            const nodeCount = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout during size estimation'));
                }, 10000); // 10 second timeout
                const callback = async () => {
                    try {
                        const values = await this.winccoa.dpGet([
                            `${connDp}.Browse.RequestId`,
                            `${connDp}.Browse.DisplayNames`
                        ]);
                        const returnedRequestId = values[0];
                        if (returnedRequestId !== requestId) {
                            return; // Not our request
                        }
                        const displayNames = values[1];
                        const count = displayNames ? displayNames.filter(n => n && n.length > 0).length : 0;
                        clearTimeout(timeout);
                        this.winccoa.dpDisconnect(connId);
                        resolve(count);
                    }
                    catch (error) {
                        clearTimeout(timeout);
                        this.winccoa.dpDisconnect(connId);
                        reject(error);
                    }
                };
                const connId = this.winccoa.dpConnect(callback, [`${connDp}.Browse.DisplayNames`, `${connDp}.Browse.RequestId`], false);
                this.winccoa
                    .dpSetWait(`${connDp}.Browse.GetBranch:_original.._value`, [requestId, nodeId, 1, eventSource])
                    .catch(reject);
            });
            return nodeCount;
        }
        catch (error) {
            console.error('Error estimating address space size:', error);
            return 0; // Return 0 on error to allow browsing to proceed
        }
    }
    /**
     * Build branch estimates from browse results
     * Analyzes flat browse results to identify large branches
     *
     * @param nodes - Flat array of browse nodes
     * @param parentNodeId - Parent node that was browsed
     * @returns Array of branch information for branches with > 100 estimated children
     */
    buildBranchEstimates(nodes, parentNodeId) {
        const branchMap = new Map();
        // Parse browsePaths to identify parent-child relationships
        // BrowsePath format: "/0:Objects/2:DeviceSet/3:IoT_Suite_Mobile/3:Counters"
        for (const node of nodes) {
            // Skip nodes without browsePath (shouldn't happen but be safe)
            if (!node.nodeId)
                continue;
            // For depth=1 browse, all nodes are direct children - count them
            // For depth>1, we need to parse browsePaths to group by parent
            // Simple heuristic: If node is Object/Folder type, estimate children count
            // based on how many nodes appear after this one in the hierarchy
            const isContainer = node.nodeClass?.includes('Object') || node.nodeClass?.includes('Folder');
            if (isContainer) {
                branchMap.set(node.nodeId, {
                    count: 1, // Will be updated if we find children
                    node: node
                });
            }
        }
        // Build branch info for branches with significant child counts
        const largeBranches = [];
        for (const [nodeId, info] of branchMap.entries()) {
            // For depth=1 results, we can't estimate children accurately
            // Mark as "potentially large" if it's a container type
            if (info.node.hasChildren) {
                largeBranches.push({
                    nodeId: nodeId,
                    displayName: info.node.displayName,
                    estimatedChildren: 0, // Unknown for depth=1
                    level: 1,
                    browsePath: nodeId
                });
            }
        }
        return largeBranches;
    }
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
    async browseWithAutoDepth(connectionName, parentNodeId, eventSource, useCache, refreshCache, maxNodes = 800) {
        // Check cache with 'auto' key first
        const autoCacheKey = this.generateBrowseCacheKey(connectionName, parentNodeId, eventSource, 'auto');
        if (useCache && !refreshCache) {
            const cachedResults = this.getCachedBrowseResults(autoCacheKey);
            if (cachedResults) {
                console.log(`✓ Auto-depth cache HIT for ${autoCacheKey}`);
                return {
                    nodes: cachedResults.slice(0, maxNodes),
                    isPartial: cachedResults.length > maxNodes,
                    totalNodes: cachedResults.length,
                    offset: 0,
                    limit: maxNodes,
                    hasMore: cachedResults.length > maxNodes,
                    nextOffset: cachedResults.length > maxNodes ? maxNodes : null,
                    actualDepthUsed: 2 // Assume cached results were depth=2
                };
            }
        }
        console.log(`Auto-depth browse: Trying depth=2 first...`);
        try {
            // Try depth=2 first (temporarily disable smart depth limiting)
            const result = await this.browse(connectionName, parentNodeId, eventSource, 2, // depth=2
            useCache, refreshCache, maxNodes, 0, // offset
            maxNodes // limit
            );
            // If result has more than maxNodes nodes, retry with depth=1
            if (result.totalNodes && result.totalNodes > maxNodes) {
                console.log(`Auto-depth: depth=2 returned ${result.totalNodes} nodes (> ${maxNodes}), retrying with depth=1...`);
                const result1 = await this.browse(connectionName, parentNodeId, eventSource, 1, // depth=1
                useCache, refreshCache, maxNodes, 0, maxNodes);
                // Add metadata showing we auto-downgraded
                result1.actualDepthUsed = 1;
                result1.warning = (result1.warning || '') +
                    ` Auto-adjusted from depth=2 to depth=1 to stay under ${maxNodes}-node limit. ` +
                    `Address space is large. Browse specific nodes for deeper levels.`;
                // Identify large branches
                if (result1.nodes.length > 0) {
                    result1.largeBranches = this.buildBranchEstimates(result1.nodes, parentNodeId);
                }
                // Cache result with 'auto' key
                this.cacheBrowseResults(autoCacheKey, result1.nodes);
                return result1;
            }
            // depth=2 fit under limit, return it
            console.log(`Auto-depth: depth=2 returned ${result.totalNodes || result.nodes.length} nodes, within limit`);
            result.actualDepthUsed = 2;
            // Cache result with 'auto' key
            this.cacheBrowseResults(autoCacheKey, result.nodes);
            return result;
        }
        catch (error) {
            // If depth=2 failed due to smart depth limiting, fall back to depth=1
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (errorMsg.includes('depth=2') || errorMsg.includes('Address space is large')) {
                console.log(`Auto-depth: depth=2 rejected by smart limiting, using depth=1...`);
                const result1 = await this.browse(connectionName, parentNodeId, eventSource, 1, useCache, refreshCache, maxNodes, 0, maxNodes);
                result1.actualDepthUsed = 1;
                result1.warning = (result1.warning || '') +
                    ` Auto-adjusted to depth=1 due to large address space. Browse specific nodes for deeper levels.`;
                // Identify large branches
                if (result1.nodes.length > 0) {
                    result1.largeBranches = this.buildBranchEstimates(result1.nodes, parentNodeId);
                }
                // Cache result with 'auto' key
                this.cacheBrowseResults(autoCacheKey, result1.nodes);
                return result1;
            }
            // Other error, rethrow
            throw error;
        }
    }
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
    async selectiveBrowse(connectionName, parentNodeId, eventSource, useCache, refreshCache, maxNodes = 800) {
        console.log(`Selective browse: Starting with depth=1 pre-check...`);
        // Step 1: Browse depth=1 to get direct children
        const level1Result = await this.browse(connectionName, parentNodeId, eventSource, 1, useCache, refreshCache, maxNodes, 0, maxNodes);
        const directChildren = level1Result.nodes;
        const directChildCount = directChildren.length;
        console.log(`Selective browse: Found ${directChildCount} direct children`);
        // If depth=1 already exceeds budget, return as-is
        if (directChildCount >= maxNodes) {
            console.log(`Selective browse: depth=1 already at/over budget, returning level 1 only`);
            level1Result.actualDepthUsed = 1;
            level1Result.warning = `Address space has ${directChildCount} direct children. ` +
                `Showing first ${maxNodes}. Browse specific nodes for deeper levels.`;
            return level1Result;
        }
        // Step 2: Calculate budget for expanding children
        const remainingBudget = maxNodes - directChildCount;
        console.log(`Selective browse: ${remainingBudget} nodes remaining for expansions`);
        // Step 3: Identify expandable children (Objects/Folders with hasChildren=true)
        const expandableBranches = directChildren.filter(node => node.hasChildren === true);
        if (expandableBranches.length === 0) {
            console.log(`Selective browse: No expandable branches found, returning depth=1`);
            level1Result.actualDepthUsed = 1;
            return level1Result;
        }
        console.log(`Selective browse: Found ${expandableBranches.length} expandable branches`);
        // Step 4: Try to expand all branches with depth=2 if budget allows
        // Estimate: each branch might have ~10-20 children average
        const estimatedPerBranch = Math.floor(remainingBudget / expandableBranches.length);
        if (estimatedPerBranch < 5) {
            // Not enough budget to expand meaningfully, return depth=1 with expandable info
            console.log(`Selective browse: Budget too tight (${estimatedPerBranch} per branch), returning depth=1 with guidance`);
            level1Result.actualDepthUsed = 1;
            level1Result.expandableBranches = expandableBranches.map(node => ({
                nodeId: node.nodeId,
                displayName: node.displayName,
                estimatedChildren: 0,
                level: 1
            }));
            level1Result.warning = `Showing ${directChildCount} nodes at depth=1. ` +
                `${expandableBranches.length} branches can be expanded. ` +
                `Browse specific branches individually: ${expandableBranches.slice(0, 3).map(n => n.displayName).join(', ')}${expandableBranches.length > 3 ? ', ...' : ''}`;
            return level1Result;
        }
        // Step 5: Expand selected branches
        console.log(`Selective browse: Expanding branches (budget: ${estimatedPerBranch} nodes per branch)...`);
        const allNodes = [...directChildren];
        const notExpandedBranches = [];
        let expandedCount = 0;
        for (const branch of expandableBranches) {
            // Check if we still have budget
            if (allNodes.length >= maxNodes) {
                // Out of budget, mark remaining branches as not expanded
                notExpandedBranches.push({
                    nodeId: branch.nodeId,
                    displayName: branch.displayName,
                    estimatedChildren: 0,
                    level: 1
                });
                continue;
            }
            try {
                // Browse this specific branch with depth=1 (its direct children)
                const branchResult = await this.browse(connectionName, branch.nodeId, eventSource, 1, useCache, refreshCache, maxNodes - allNodes.length, // Remaining budget
                0, maxNodes - allNodes.length);
                // Add children to result
                const childrenToAdd = branchResult.nodes.slice(0, maxNodes - allNodes.length);
                allNodes.push(...childrenToAdd);
                expandedCount++;
                console.log(`Selective browse: Expanded ${branch.displayName} (+${childrenToAdd.length} nodes, total: ${allNodes.length})`);
                // If we're at budget, stop
                if (allNodes.length >= maxNodes) {
                    // Mark remaining as not expanded
                    const currentIndex = expandableBranches.indexOf(branch);
                    for (let i = currentIndex + 1; i < expandableBranches.length; i++) {
                        const remainingBranch = expandableBranches[i];
                        if (remainingBranch) {
                            notExpandedBranches.push({
                                nodeId: remainingBranch.nodeId,
                                displayName: remainingBranch.displayName,
                                estimatedChildren: 0,
                                level: 1
                            });
                        }
                    }
                    break;
                }
            }
            catch (error) {
                console.error(`Selective browse: Failed to expand ${branch.displayName}:`, error);
                notExpandedBranches.push({
                    nodeId: branch.nodeId,
                    displayName: branch.displayName,
                    estimatedChildren: 0,
                    level: 1
                });
            }
        }
        // Build final result
        const result = {
            nodes: allNodes,
            isPartial: notExpandedBranches.length > 0,
            totalNodes: allNodes.length,
            actualDepthUsed: expandedCount > 0 ? 2 : 1,
            expandableBranches: notExpandedBranches.length > 0 ? notExpandedBranches : undefined,
            warning: notExpandedBranches.length > 0
                ? `Showing ${allNodes.length} nodes with selective expansion (${expandedCount}/${expandableBranches.length} branches expanded). ` +
                    `${notExpandedBranches.length} branches not expanded due to ${maxNodes}-node limit. ` +
                    `Browse these nodes individually: ${notExpandedBranches.slice(0, 3).map(b => b.displayName).join(', ')}${notExpandedBranches.length > 3 ? ', ...' : ''}`
                : `Showing ${allNodes.length} nodes with full expansion at depth=2`,
            offset: 0,
            limit: maxNodes,
            hasMore: false,
            nextOffset: null
        };
        console.log(`Selective browse: Complete. ${allNodes.length} total nodes, depth=${result.actualDepthUsed}, ${notExpandedBranches.length} branches not expanded`);
        return result;
    }
    /**
     * Estimate safe depth for batched browsing based on remaining budget
     * Uses hasChildren information and conservative estimates to avoid exceeding limits
     *
     * @param remainingBudget - Number of nodes remaining in budget
     * @param parentNode - Parent node being browsed (optional, for hasChildren hint)
     * @returns Recommended depth for next browse operation (1-3)
     */
    estimateSafeDepth(remainingBudget, parentNode) {
        // Use hasChildren hint if available
        // If parent has no children, no need to browse deeper
        if (parentNode && parentNode.hasChildren === false) {
            return 1; // Leaf node, no point going deeper
        }
        // Conservative depth estimation to avoid budget overrun
        // Formula: depth=N typically returns N levels * avgChildren^(N-1) nodes
        if (remainingBudget > 700) {
            // Plenty of budget: try depth=3
            // Estimate: ~100-200 nodes for typical hierarchy
            return 3;
        }
        if (remainingBudget > 400) {
            // Moderate budget: try depth=2
            // Estimate: ~20-50 nodes for typical hierarchy
            return 2;
        }
        if (remainingBudget > 100) {
            // Low budget: use depth=1
            // Estimate: ~5-15 nodes
            return 1;
        }
        // Very low budget: depth=1 but we're close to limit
        return 1;
    }
    /**
     * Check if OPC UA connection is established and ready for browsing
     * Uses Common.State.ConnState (unified driver state across all WinCC OA drivers)
     * @param connDp - Connection datapoint name (with _ prefix)
     * @throws Error if connection is not established (Common.State.ConnState < 256)
     */
    async checkConnectionEstablished(connDp) {
        try {
            // Check if connection datapoint exists
            const exists = this.winccoa.dpExists(connDp);
            if (!exists) {
                throw new Error(`OPC UA connection '${connDp}' does not exist. ` +
                    `Please create the connection first using the 'opcua-add-connection' tool.`);
            }
            // Read common connection state (unified across all drivers)
            const connStateResult = await this.winccoa.dpGet([`${connDp}.Common.State.ConnState`]);
            const connState = connStateResult[0];
            // Check if connected (state >= 256)
            // Per WinCC OA documentation: values < 256 = not connected, values >= 256 = connected
            if (connState < 256) {
                // Get server state for additional context
                let serverState = 'Unknown';
                try {
                    const serverStateResult = await this.winccoa.dpGet([`${connDp}.State.ServerState`]);
                    serverState = serverStateResult[0] || 'Unknown';
                }
                catch {
                    // Ignore error, server state is optional context
                }
                // State meanings for user reference (from WinCC OA Common.State.ConnState)
                const stateDescriptions = {
                    [-1]: 'Not Initialized',
                    0: 'Undefined',
                    1: 'Not Connected',
                    2: 'Connecting',
                    3: 'Not Active',
                    4: 'Disconnecting',
                    5: 'Failure',
                    9: 'WaitForReconnect'
                };
                const currentStateDesc = stateDescriptions[connState] || `Unknown state (${connState})`;
                throw new Error(`OPC UA connection '${connDp}' is not established.\n` +
                    `Connection state (Common.State.ConnState): ${connState} (${currentStateDesc})\n` +
                    `Server state: ${serverState}\n\n` +
                    `Please ensure:\n` +
                    `- The OPC UA connection is active\n` +
                    `- The OPC UA server is reachable\n` +
                    `- The OPC UA driver is running\n\n` +
                    `State meanings (Common.State.ConnState):\n` +
                    `- -1 = Not Initialized\n` +
                    `- 0 = Undefined\n` +
                    `- 1 = Not Connected\n` +
                    `- 2 = Connecting (please wait and retry)\n` +
                    `- 3 = Not Active\n` +
                    `- 4 = Disconnecting\n` +
                    `- 5 = Failure\n` +
                    `- 9 = WaitForReconnect\n` +
                    `- 256+ = Connected (ready to browse)`);
            }
            console.log(`Connection ${connDp} is established (Common.State.ConnState=${connState}, >= 256 = connected)`);
        }
        catch (error) {
            // Re-throw with context
            if (error instanceof Error) {
                throw error;
            }
            throw new Error(`Failed to check connection status for ${connDp}: ${String(error)}`);
        }
    }
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
    async browseFullBranch(connectionName, startNodeId, eventSource, softLimit = 800, hardLimit = 1000, maxDepth = 10, useCache = true, refreshCache = false) {
        console.log(`Full branch browse: Starting recursive exploration of ${startNodeId}`);
        console.log(`Limits: soft=${softLimit}, hard=${hardLimit}, maxDepth=${maxDepth}`);
        const allNodes = [];
        const exploredBranches = [];
        const expandableBranches = [];
        let totalApiCalls = 0;
        let maxDepthReached = 0;
        let leafNodesCount = 0;
        const nodesToExplore = [{
                nodeId: startNodeId,
                displayName: 'root',
                currentDepth: 0
            }];
        // Track which nodes we've already explored to avoid duplicates
        const exploredNodeIds = new Set();
        // Depth-first exploration loop
        while (nodesToExplore.length > 0 && allNodes.length < hardLimit) {
            // Pop from end (depth-first)
            const current = nodesToExplore.pop();
            // Skip if already explored
            if (exploredNodeIds.has(current.nodeId)) {
                continue;
            }
            // Check depth limit
            if (current.currentDepth >= maxDepth) {
                console.log(`Depth limit reached at ${current.displayName} (depth=${current.currentDepth})`);
                expandableBranches.push({
                    nodeId: current.nodeId,
                    displayName: current.displayName,
                    estimatedChildren: 0,
                    level: current.currentDepth
                });
                continue;
            }
            // Calculate safe batch depth for this browse operation
            const remainingBudget = hardLimit - allNodes.length;
            const batchDepth = this.estimateSafeDepth(remainingBudget);
            console.log(`Browsing ${current.displayName} (depth=${current.currentDepth}, batchDepth=${batchDepth}, remaining=${remainingBudget})`);
            try {
                // Browse this node with calculated batch depth
                const result = await this.browse(connectionName, current.nodeId, eventSource, batchDepth, useCache, refreshCache, hardLimit, 0, hardLimit);
                totalApiCalls++;
                exploredNodeIds.add(current.nodeId);
                // Add all returned nodes
                const newNodes = result.nodes || [];
                allNodes.push(...newNodes);
                console.log(`  → Got ${newNodes.length} nodes (total: ${allNodes.length})`);
                // Update max depth reached
                maxDepthReached = Math.max(maxDepthReached, current.currentDepth + batchDepth);
                // Check if we're approaching limits
                if (allNodes.length >= softLimit && allNodes.length < hardLimit) {
                    console.log(`Soft limit reached (${allNodes.length}/${softLimit}), will complete current branches`);
                }
                // Find nodes with children that need further exploration
                const nodesWithChildren = newNodes.filter(n => n.hasChildren === true);
                const leafNodes = newNodes.filter(n => n.hasChildren === false);
                leafNodesCount += leafNodes.length;
                console.log(`  → ${nodesWithChildren.length} expandable, ${leafNodes.length} leaves`);
                // If we have nodes with children and budget remaining, queue them for exploration
                if (nodesWithChildren.length > 0 && allNodes.length < hardLimit) {
                    // Add to stack (reverse order for depth-first left-to-right)
                    for (let i = nodesWithChildren.length - 1; i >= 0; i--) {
                        const node = nodesWithChildren[i];
                        if (!node)
                            continue; // Skip undefined nodes
                        // Check if this would exceed hard limit
                        if (allNodes.length + nodesToExplore.length >= hardLimit) {
                            expandableBranches.push({
                                nodeId: node.nodeId,
                                displayName: node.displayName,
                                estimatedChildren: 0,
                                level: current.currentDepth + 1
                            });
                        }
                        else {
                            nodesToExplore.push({
                                nodeId: node.nodeId,
                                displayName: node.displayName,
                                currentDepth: current.currentDepth + 1
                            });
                        }
                    }
                }
                // Mark branch as fully explored if we reached all leaves
                if (nodesWithChildren.length === 0 || allNodes.length >= hardLimit) {
                    exploredBranches.push(current.displayName);
                }
                // Hard limit check
                if (allNodes.length >= hardLimit) {
                    console.log(`Hard limit reached (${allNodes.length}/${hardLimit}), stopping exploration`);
                    // Mark remaining queued nodes as expandable
                    for (const remaining of nodesToExplore) {
                        expandableBranches.push({
                            nodeId: remaining.nodeId,
                            displayName: remaining.displayName,
                            estimatedChildren: 0,
                            level: remaining.currentDepth
                        });
                    }
                    break;
                }
            }
            catch (error) {
                console.error(`Error browsing ${current.displayName}:`, error);
                expandableBranches.push({
                    nodeId: current.nodeId,
                    displayName: current.displayName,
                    estimatedChildren: 0,
                    level: current.currentDepth
                });
            }
        }
        // Build final result
        const hitSoftLimit = allNodes.length >= softLimit;
        const hitHardLimit = allNodes.length >= hardLimit;
        let warning = '';
        if (hitHardLimit) {
            warning = `Hard limit reached (${allNodes.length}/${hardLimit} nodes). `;
        }
        else if (hitSoftLimit) {
            warning = `Soft limit reached (${allNodes.length}/${softLimit} nodes). `;
        }
        if (exploredBranches.length > 0) {
            warning += `Fully explored: ${exploredBranches.slice(0, 3).join(', ')}${exploredBranches.length > 3 ? ', ...' : ''}. `;
        }
        if (expandableBranches.length > 0) {
            warning += `Not explored (${expandableBranches.length} branches): ${expandableBranches.slice(0, 3).map(b => b.displayName).join(', ')}${expandableBranches.length > 3 ? ', ...' : ''}. Browse these individually.`;
        }
        const result = {
            nodes: allNodes,
            isPartial: expandableBranches.length > 0,
            totalNodes: allNodes.length,
            actualDepthUsed: maxDepthReached,
            exploredBranches: exploredBranches.length > 0 ? exploredBranches : undefined,
            expandableBranches: expandableBranches.length > 0 ? expandableBranches : undefined,
            recursionStats: {
                maxDepthReached,
                totalLevelsExplored: maxDepthReached,
                leafNodesReached: leafNodesCount,
                totalApiCalls
            },
            warning: warning || undefined,
            offset: 0,
            limit: hardLimit,
            hasMore: false,
            nextOffset: null
        };
        console.log(`Full branch browse complete: ${allNodes.length} nodes, ${totalApiCalls} API calls, max depth ${maxDepthReached}`);
        return result;
    }
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
    async browse(connectionName, parentNodeId, eventSource = 0, depth, useCache = true, refreshCache = false, maxNodeCount, offset = 0, limit) {
        try {
            // Ensure connection name has leading underscore
            const connDp = connectionName.startsWith('_') ? connectionName : `_${connectionName}`;
            // Check if connection is established before browsing
            await this.checkConnectionEstablished(connDp);
            // Default to Objects folder if no parent specified
            const startNode = parentNodeId || 'ns=0;i=85';
            // Maximum nodes to return (default to 800, matching Option C requirement)
            const maxNodes = maxNodeCount || 800;
            // Apply pagination parameters
            const pageOffset = Math.max(0, offset); // Ensure non-negative
            const pageLimit = limit ? Math.min(limit, maxNodes) : maxNodes;
            // AUTO-DEPTH: If depth not specified, use smart auto-depth strategy
            if (depth === undefined) {
                // For root nodes (Objects folder), be conservative with auto-depth
                // For specific branches, be more aggressive (try up to depth=3)
                const isRootNode = startNode === 'ns=0;i=85' || startNode === 'ns=0;i=84' ||
                    startNode === 'ns=0;i=86' || startNode === 'ns=0;i=87';
                if (isRootNode) {
                    console.log(`Auto-depth browsing (root node) for ${startNode}`);
                    return await this.browseWithAutoDepth(connDp, startNode, eventSource, useCache, refreshCache, maxNodes);
                }
                else {
                    // Specific branch: browse entire branch recursively to leaf nodes
                    console.log(`Auto-depth browsing (specific branch) for ${startNode} - using full branch browse`);
                    return await this.browseFullBranch(connDp, startNode, eventSource, maxNodes, // soft limit (800)
                    1000, // hard limit
                    10, // max depth
                    useCache, refreshCache);
                }
            }
            // VALIDATE USER-SPECIFIED DEPTH: Ensure it won't cause overflow
            // Validate depth range (1-5 allowed, 0 disabled for safety)
            if (depth < 1 || depth > 5) {
                throw new Error(`Invalid depth ${depth}. Depth must be between 1 and 5. ` +
                    `depth=0 (unlimited browsing) is disabled for safety to prevent crashes on large address spaces. ` +
                    `Omit depth parameter to use smart auto-depth selection.`);
            }
            // Smart depth limiting: check address space size before allowing deep browse
            if (depth > 1 && !refreshCache) {
                console.log(`Checking address space size for depth=${depth} validation...`);
                const childCount = await this.browseSingleLevel(connDp, startNode, eventSource);
                console.log(`Found ${childCount} direct children at this level`);
                // If > 50 children and depth > 2, reject (would return 10K+ nodes)
                if (childCount > 50 && depth > 2) {
                    throw new Error(`Address space is large (${childCount} direct children). ` +
                        `depth=${depth} would likely return 10,000+ nodes causing context overflow (>200K tokens). ` +
                        `Maximum depth allowed for this node: 2. ` +
                        `Recommendation: Use depth=1 or depth=2, and browse incrementally with pagination.`);
                }
                // If > 100 children, only allow depth=1
                if (childCount > 100 && depth > 1) {
                    throw new Error(`Address space is very large (${childCount} direct children). ` +
                        `depth=${depth} would cause context overflow. ` +
                        `Only depth=1 allowed for this node. ` +
                        `Please browse incrementally: use depth=1 to get children, then browse each child individually.`);
                }
            }
            // Cleanup expired cache entries periodically
            this.cleanupExpiredCache();
            // Generate cache key
            const cacheKey = this.generateBrowseCacheKey(connDp, startNode, eventSource, depth);
            // Check cache if enabled and not refreshing
            if (useCache && !refreshCache) {
                const cachedFullResults = this.getCachedBrowseResults(cacheKey);
                if (cachedFullResults) {
                    console.log(`✓ Cache HIT for ${cacheKey} (${cachedFullResults.length} total nodes cached)`);
                    // Apply pagination to CACHED FULL results
                    const totalNodes = cachedFullResults.length;
                    const startIndex = pageOffset;
                    const endIndex = Math.min(startIndex + pageLimit, totalNodes);
                    const paginatedResults = cachedFullResults.slice(startIndex, endIndex);
                    // Calculate pagination metadata
                    const hasMore = endIndex < totalNodes;
                    const nextOffset = hasMore ? endIndex : null;
                    const isPartial = hasMore;
                    let warning;
                    if (isPartial) {
                        warning = `Showing nodes ${startIndex + 1}-${endIndex} of ${totalNodes} total (from cache). ` +
                            `Use offset=${nextOffset} to get the next page.`;
                    }
                    console.log(`Returning page ${startIndex}-${endIndex} from cache`);
                    // Return paginated cached results with full metadata
                    return {
                        nodes: paginatedResults,
                        isPartial,
                        warning,
                        appliedLimit: pageLimit,
                        totalNodes,
                        offset: startIndex,
                        limit: pageLimit,
                        hasMore,
                        nextOffset
                    };
                }
                console.log(`Cache MISS for ${cacheKey}`);
            }
            console.log(`Browsing ${depth} level(s) for node ${startNode}`);
            // Generate unique request ID
            const requestId = this.generateBrowseRequestId();
            // Perform browse operation with specified depth, timeout, and node limit
            const browseResult = await new Promise((resolve, reject) => {
                let timeoutId = null;
                let connId = null;
                let isCompleted = false;
                // Cleanup function to avoid memory leaks
                const cleanup = () => {
                    if (isCompleted)
                        return;
                    isCompleted = true;
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                        timeoutId = null;
                    }
                    if (connId !== null) {
                        this.winccoa.dpDisconnect(connId);
                        connId = null;
                    }
                };
                // Setup timeout protection
                timeoutId = setTimeout(() => {
                    if (isCompleted)
                        return;
                    console.error(`Browse operation timed out after ${this.BROWSE_TIMEOUT_MS}ms`);
                    cleanup();
                    reject(new Error(`Browse operation timed out after ${this.BROWSE_TIMEOUT_MS / 1000} seconds (2 minutes). ` +
                        `This usually indicates a very large address space or connectivity issues. ` +
                        `Try browsing a more specific node, reducing the depth parameter, or checking server connectivity.`));
                }, this.BROWSE_TIMEOUT_MS);
                // Callback function for dpConnect
                const browseCallback = async (dpes) => {
                    try {
                        if (isCompleted)
                            return; // Already completed (timeout or previous call)
                        console.log(`Browse callback triggered`);
                        // Read all values at once with a single dpGet call
                        const values = await this.winccoa.dpGet([
                            `${connDp}.Browse.RequestId`,
                            `${connDp}.Browse.DisplayNames`,
                            `${connDp}.Browse.BrowsePaths`,
                            `${connDp}.Browse.NodeIds`,
                            `${connDp}.Browse.DataTypes`,
                            `${connDp}.Browse.ValueRanks`,
                            `${connDp}.Browse.NodeClasses`
                        ]);
                        const returnedRequestId = values[0];
                        const displayNames = values[1];
                        const browsePaths = values[2];
                        const nodeIds = values[3];
                        const dataTypes = values[4];
                        const valueRanks = values[5];
                        const nodeClasses = values[6];
                        // Check if this is our request
                        if (returnedRequestId !== requestId) {
                            console.log(`RequestId mismatch, ignoring callback`);
                            return; // Not our request, ignore
                        }
                        console.log(`RequestId matches, processing ${displayNames.length} nodes`);
                        // Build ALL results first (MINIMAL FIELDS ONLY)
                        const allResults = [];
                        for (let i = 0; i < displayNames.length; i++) {
                            const displayName = displayNames[i];
                            if (displayName && displayName.length > 0) {
                                const nodeClass = nodeClasses?.[i] || 'Unknown';
                                // Smart heuristic for hasChildren flag
                                // Objects and Folders typically have children, Variables typically don't
                                let hasChildren = undefined;
                                if (nodeClass.includes('Object') || nodeClass.includes('Folder')) {
                                    hasChildren = true;
                                }
                                else if (nodeClass.includes('Variable')) {
                                    hasChildren = false;
                                }
                                // For other node classes (Method, etc.), leave undefined
                                // MINIMAL RESPONSE: Only displayName, nodeId, nodeClass, hasChildren
                                // For full details (browsePath, dataType, valueRank, description, etc.),
                                // use opcua-get-node-details tool
                                allResults.push({
                                    displayName: displayName,
                                    nodeId: nodeIds[i] || '',
                                    nodeClass: nodeClass,
                                    hasChildren: hasChildren
                                });
                            }
                        }
                        // Apply pagination: slice results based on offset and limit
                        const totalNodes = allResults.length;
                        const startIndex = pageOffset;
                        const endIndex = Math.min(startIndex + pageLimit, totalNodes);
                        const paginatedResults = allResults.slice(startIndex, endIndex);
                        // Calculate pagination metadata
                        const hasMore = endIndex < totalNodes;
                        const nextOffset = hasMore ? endIndex : null;
                        const isPartial = hasMore;
                        let warning;
                        if (isPartial) {
                            warning = `Showing nodes ${startIndex + 1}-${endIndex} of ${totalNodes} total. ` +
                                `Use offset=${nextOffset} to get the next page.`;
                        }
                        console.log(`Browse completed: ${paginatedResults.length} nodes returned (${startIndex}-${endIndex} of ${totalNodes})`);
                        // Cleanup and resolve with pagination metadata
                        cleanup();
                        resolve({
                            nodes: paginatedResults,
                            isPartial,
                            warning,
                            appliedLimit: pageLimit,
                            totalNodes,
                            offset: startIndex,
                            limit: pageLimit,
                            hasMore,
                            nextOffset,
                            _fullResults: allResults // Internal field for caching (not exposed to client)
                        });
                    }
                    catch (error) {
                        console.error(`Error in browse callback:`, error);
                        cleanup();
                        reject(error);
                    }
                };
                // Connect callback to browse datapoints
                connId = this.winccoa.dpConnect(browseCallback, [
                    `${connDp}.Browse.DisplayNames`,
                    `${connDp}.Browse.BrowsePaths`,
                    `${connDp}.Browse.NodeIds`,
                    `${connDp}.Browse.DataTypes`,
                    `${connDp}.Browse.ValueRanks`,
                    `${connDp}.Browse.NodeClasses`,
                    `${connDp}.Browse.RequestId`
                ], false // Don't send initial values
                );
                // Trigger browse request - pass depth directly to WinCC OA
                this.winccoa
                    .dpSetWait(`${connDp}.Browse.GetBranch:_original.._value`, [requestId, startNode, depth, eventSource])
                    .catch((error) => {
                    cleanup();
                    reject(error);
                });
            });
            // Cache FULL results (not paginated) for future pagination requests
            if (useCache && browseResult._fullResults) {
                const fullResults = browseResult._fullResults;
                const estimatedSize = JSON.stringify(fullResults).length;
                // Only cache if total size < 5MB
                if (estimatedSize < this.MAX_CACHE_SIZE_BYTES / 10) {
                    const cacheKey = this.generateBrowseCacheKey(connDp, startNode, eventSource, depth);
                    this.cacheBrowseResults(cacheKey, fullResults);
                    console.log(`✓ Cached ${fullResults.length} FULL nodes for ${cacheKey} (all pages can use this cache)`);
                }
                else {
                    console.log(`⚠ Skipping cache: Result size (${Math.round(estimatedSize / 1024 / 1024)}MB) exceeds 5MB limit`);
                }
                // Remove internal field before returning to client
                delete browseResult._fullResults;
            }
            return browseResult;
        }
        catch (error) {
            console.error(`Error browsing OPC UA connection:`, error);
            throw error;
        }
    }
    /**
     * Get detailed node information for specific nodes (batch operation)
     * COMMENTED OUT: NodeDetails type was removed along with opcua_node_details tool
     * Can be re-enabled if needed by adding back NodeDetails type definition
     *
     * @param connectionName - Name of the connection (e.g., '_OpcUAConnection1')
     * @param nodeIds - Array of node IDs to fetch details for
     * @returns Promise with array of node details
     */
    /*
    async getNodeDetails(
      connectionName: string,
      nodeIds: string[]
    ): Promise<NodeDetails[]> {
      try {
        // Ensure connection name has leading underscore
        const connDp = connectionName.startsWith('_') ? connectionName : `_${connectionName}`;
  
        console.log(`Fetching details for ${nodeIds.length} nodes from ${connDp}`);
  
        // Validate node IDs
        if (!nodeIds || nodeIds.length === 0) {
          throw new Error('nodeIds array is empty. Please provide at least one node ID.');
        }
  
        const results: NodeDetails[] = [];
  
        // Process each node ID (batch operation)
        for (const nodeId of nodeIds) {
          try {
            // Generate unique request ID for this node
            const requestId = this.generateBrowseRequestId();
  
            // Browse this specific node at depth=0 to get its full details
            // This gives us all the attributes we need
            const nodeInfo = await new Promise<NodeDetails>((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error(`Timeout fetching details for node ${nodeId}`));
              }, 10000); // 10 second timeout per node
  
              // Callback function for dpConnect
              const detailsCallback = async (dpes: string[]) => {
                try {
                  // Read all values at once
                  const values = await this.winccoa.dpGet([
                    `${connDp}.Browse.RequestId`,
                    `${connDp}.Browse.DisplayNames`,
                    `${connDp}.Browse.BrowsePaths`,
                    `${connDp}.Browse.NodeIds`,
                    `${connDp}.Browse.DataTypes`,
                    `${connDp}.Browse.ValueRanks`,
                    `${connDp}.Browse.NodeClasses`
                  ]) as any[];
  
                  const returnedRequestId = values[0] as string;
                  if (returnedRequestId !== requestId) {
                    return; // Not our request
                  }
  
                  const displayNames = values[1] as string[];
                  const browsePaths = values[2] as string[];
                  const nodeIds = values[3] as string[];
                  const dataTypes = values[4] as string[];
                  const valueRanks = values[5] as string[];
                  const nodeClasses = values[6] as string[];
  
                  // Should have exactly one result (the node itself)
                  if (displayNames && displayNames.length > 0 && displayNames[0]) {
                    clearTimeout(timeout);
                    this.winccoa.dpDisconnect(connId);
  
                    resolve({
                      nodeId: nodeId,
                      displayName: displayNames[0] || '',
                      browsePath: browsePaths[0] || '',
                      nodeClass: nodeClasses[0] || 'Unknown',
                      dataType: dataTypes[0] || '',
                      valueRank: valueRanks[0] || ''
                    });
                  } else {
                    clearTimeout(timeout);
                    this.winccoa.dpDisconnect(connId);
                    reject(new Error(`Node ${nodeId} not found or has no data`));
                  }
                } catch (error) {
                  clearTimeout(timeout);
                  this.winccoa.dpDisconnect(connId);
                  reject(error);
                }
              };
  
              // Connect callback
              const connId = this.winccoa.dpConnect(
                detailsCallback,
                [
                  `${connDp}.Browse.DisplayNames`,
                  `${connDp}.Browse.BrowsePaths`,
                  `${connDp}.Browse.NodeIds`,
                  `${connDp}.Browse.DataTypes`,
                  `${connDp}.Browse.ValueRanks`,
                  `${connDp}.Browse.NodeClasses`,
                  `${connDp}.Browse.RequestId`
                ],
                false
              );
  
              // Trigger browse for this specific node (depth=0, eventSource=0)
              this.winccoa
                .dpSetWait(`${connDp}.Browse.GetBranch:_original.._value`, [requestId, nodeId, 0, 0])
                .catch(reject);
            });
  
            results.push(nodeInfo);
            console.log(`✓ Fetched details for node: ${nodeInfo.displayName} (${nodeId})`);
          } catch (error) {
            // If individual node fails, add error entry but continue with others
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`✗ Failed to fetch details for node ${nodeId}:`, errorMessage);
            results.push({
              nodeId: nodeId,
              displayName: '',
              browsePath: '',
              nodeClass: '',
              dataType: '',
              valueRank: '',
              error: errorMessage
            });
          }
        }
  
        console.log(`Fetched details for ${results.length} nodes (${results.filter(r => !r.error).length} successful)`);
        return results;
      } catch (error) {
        console.error(`Error fetching node details:`, error);
        throw error;
      }
    }
    */
    /**
     * Get manager number for a given OPC UA connection
     * Searches for which _OPCUA{num} manager has this connection registered
     *
     * @param connectionName - Connection name (normalized with _ prefix)
     * @returns Manager number (1-255)
     * @throws Error if no manager found
     */
    async getManagerNumberForConnection(connectionName) {
        try {
            // Normalize connection name (remove leading underscore for search)
            const normalizedName = connectionName.startsWith('_')
                ? connectionName.substring(1)
                : connectionName;
            console.log(`Auto-detecting manager for connection: ${normalizedName}`);
            // 1. Try to find which _OPCUA{num} has this connection registered
            // Get all _OPCUA{num} datapoints
            const opcuaManagers = this.winccoa.dpNames('_OPCUA*', '_OPCUA');
            for (const managerDp of opcuaManagers) {
                try {
                    const servers = await this.winccoa.dpGet(`${managerDp}.Config.Servers`);
                    if (Array.isArray(servers) && servers.includes(normalizedName)) {
                        // Extract number from "_OPCUA{num}"
                        const match = managerDp.match(/_OPCUA(\d+)/);
                        if (match && match[1]) {
                            const managerNum = parseInt(match[1]);
                            console.log(`Found connection registered with ${managerDp}`);
                            return managerNum;
                        }
                    }
                }
                catch (error) {
                    // Skip managers that don't have Config.Servers or are not accessible
                    continue;
                }
            }
            // 2. Fallback: Find first running OPCUA driver by checking _Driver* datapoints
            const drivers = this.winccoa.dpNames('_Driver*', '_DriverCommon');
            for (const driverDp of drivers) {
                try {
                    const driverType = await this.winccoa.dpGet(`${driverDp}.DT`);
                    if (driverType === "OPCUAC") { // OPC UA Client driver type
                        const match = driverDp.match(/_Driver(\d+)/);
                        if (match && match[1]) {
                            const driverNum = parseInt(match[1]);
                            console.log(`Found running OPC UA driver with number ${driverNum}`);
                            return driverNum;
                        }
                    }
                }
                catch (error) {
                    continue;
                }
            }
            throw new Error(`No OPC UA manager found for connection ${connectionName}. ` +
                `Please ensure: 1) Connection is registered with a manager (_OPCUA{num}.Config.Servers), ` +
                `or 2) An OPC UA driver is running.`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to detect manager number: ${errorMessage}`);
        }
    }
    /**
     * Validate manager number and check if connection is registered with it
     *
     * @param managerNumber - Manager number to validate
     * @param connectionName - Connection name (normalized with _ prefix)
     * @throws Error if validation fails
     */
    async validateManagerNumberForConnection(managerNumber, connectionName) {
        // 1. Validate range
        if (managerNumber < 1 || managerNumber > 255) {
            throw new Error(`Manager number ${managerNumber} out of valid range (1-255)`);
        }
        // 2. Check if manager datapoint exists
        const managerDp = `_OPCUA${managerNumber}`;
        if (!this.checkDpExists(managerDp)) {
            throw new Error(`OPC UA Manager ${managerDp} does not exist. ` +
                `Please create it first or check your manager number.`);
        }
        // 3. Check if connection is registered with this manager
        const normalizedName = connectionName.startsWith('_')
            ? connectionName.substring(1)
            : connectionName;
        try {
            const servers = await this.winccoa.dpGet(`${managerDp}.Config.Servers`);
            if (!Array.isArray(servers) || !servers.includes(normalizedName)) {
                throw new Error(`Connection ${connectionName} is not registered with manager ${managerDp}. ` +
                    `Registered connections: ${servers && servers.length > 0 ? servers.join(', ') : 'none'}`);
            }
            console.log(`Validated: Connection ${connectionName} is registered with ${managerDp}`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to validate manager registration: ${errorMessage}`);
        }
    }
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
    async ensureSubscriptionExists(subscriptionName, connectionName) {
        try {
            // Normalize subscription name (ensure _ prefix)
            const normalizedSub = subscriptionName.startsWith('_')
                ? subscriptionName
                : `_${subscriptionName}`;
            // Check if subscription/poll group already exists
            const subscriptionExists = this.checkDpExists(normalizedSub);
            if (subscriptionExists) {
                console.log(`Poll group/subscription ${normalizedSub} already exists`);
                return normalizedSub;
            }
            // Create as _PollGroup (used for both polling and spontaneous)
            // For polling mode: PollInterval controls how often data is queried
            // For spontaneous mode: Just needs a name reference in _poll_group attribute
            console.log(`Creating poll group ${normalizedSub} of type _PollGroup`);
            const created = await this.winccoa.dpCreate(normalizedSub, '_PollGroup');
            if (!created) {
                throw new Error(`Failed to create poll group ${normalizedSub}`);
            }
            // Configure poll group settings
            // Active: Enable the poll group
            // PollInterval: Controls polling frequency (1000ms = 1 second)
            console.log(`Configuring poll group ${normalizedSub}:`);
            console.log(`  - Active: true`);
            console.log(`  - PollInterval: 1000ms`);
            await this.winccoa.dpSetWait([
                `${normalizedSub}.Active`,
                `${normalizedSub}.PollInterval`
            ], [
                1, // Active = true
                1000 // Poll interval in ms (1 second)
            ]);
            console.log(`✓ Successfully created and configured poll group ${normalizedSub}`);
            return normalizedSub;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to ensure subscription exists: ${errorMessage}`);
        }
    }
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
    buildReferenceString(connectionName, nodeId) {
        // Remove leading underscore for reference string
        const conn = connectionName.startsWith('_')
            ? connectionName.substring(1)
            : connectionName;
        // Format: Connection$$Variant$Mode$NodeId
        // Note: DOUBLE $$ is critical!
        // Variant: 1 = NodeId (not browse path)
        // Mode: 1 = NodeId format
        return `${conn}$$1$1$${nodeId}`;
    }
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
    async addAddressConfig(dpName, connectionName, reference, datatype = OpcUaDatatype.DEFAULT, direction = DpAddressDirection.DPATTR_ADDR_MODE_INPUT_POLL, active = true, managerNumber, subscription = 'DefaultPollingFast') {
        try {
            console.log(`Configuring OPC UA address for ${dpName}`);
            // 1. Validate datapoint exists
            const dpBaseName = dpName.split('.')[0];
            if (!dpBaseName || !this.checkDpExists(dpBaseName)) {
                throw new Error(`Datapoint ${dpName} does not exist. Please create it first.`);
            }
            // 2. Normalize connectionName (ensure _ prefix)
            const normalizedConnection = connectionName.startsWith('_')
                ? connectionName
                : `_${connectionName}`;
            // 3. Validate connection exists
            if (!this.checkDpExists(normalizedConnection)) {
                throw new Error(`OPC UA connection ${normalizedConnection} does not exist. ` +
                    `Available connections: ${this.winccoa.dpNames('_OpcUAConnection*', '_OPCUAServer').join(', ')}`);
            }
            // 4. Get manager number: explicit or auto-detect
            let finalManagerNumber;
            if (managerNumber !== undefined) {
                await this.validateManagerNumberForConnection(managerNumber, normalizedConnection);
                finalManagerNumber = managerNumber;
                console.log(`Using explicitly specified manager number: ${finalManagerNumber}`);
            }
            else {
                finalManagerNumber = await this.getManagerNumberForConnection(normalizedConnection);
                console.log(`Auto-detected manager number: ${finalManagerNumber}`);
            }
            // 5. Validate datatype (750-768 for OPC UA)
            if (datatype < 750 || datatype > 768) {
                throw new Error(`Invalid OPC UA datatype ${datatype}. Must be between 750 and 768.\n` +
                    `Common values:\n` +
                    `  750 = DEFAULT (automatic detection)\n` +
                    `  751 = BOOLEAN\n` +
                    `  756 = INT32\n` +
                    `  760 = FLOAT\n` +
                    `  762 = STRING\n` +
                    `See OpcUaDatatype enum for full list.`);
            }
            // 6. Validate direction (0-15)
            if (direction < 0 || direction > 15) {
                throw new Error(`Invalid address direction ${direction}. Must be between 0 and 15.\n` +
                    `Common values:\n` +
                    `  4 = INPUT_POLL (polled input, default)\n` +
                    `  2 = INPUT_SPONT (spontaneous input)\n` +
                    `  1 = OUTPUT (output)\n` +
                    `See DpAddressDirection enum for full list.`);
            }
            // 7. Ensure subscription exists (create if necessary)
            const normalizedSubscription = await this.ensureSubscriptionExists(subscription, normalizedConnection);
            // 8. Build proper reference string (NO subscription in reference!)
            //    Subscription is specified in _poll_group attribute
            const fullReference = this.buildReferenceString(normalizedConnection, reference);
            // 9. Build DpAddressConfig with ALL required fields
            const addressConfig = {
                _type: DpConfigType.DPCONFIG_PERIPH_ADDR_MAIN,
                _drv_ident: "OPCUA",
                // NOTE: _connection is intentionally NOT set for OPC UA (based on working config)
                _reference: fullReference, // Full reference (single $ separators)
                _direction: direction,
                _datatype: datatype, // CRITICAL: Transformation type
                _subindex: 0, // Always 0 for OPC UA
                _internal: false,
                _lowlevel: true,
                _offset: 0, // No offset by default
                _poll_group: normalizedSubscription, // Poll group name (used for both polling and spontaneous modes)
                _active: active // Set active in the initial config
            };
            // 10. Build DpDistribConfig
            const distribConfig = {
                _type: DpConfigType.DPCONFIG_DISTRIBUTION_INFO,
                _driver: finalManagerNumber
            };
            console.log(`\n╔════════════════════════════════════════════════════════════════╗`);
            console.log(`║ OPC UA Address Configuration for: ${dpName.padEnd(30)} ║`);
            console.log(`╠════════════════════════════════════════════════════════════════╣`);
            console.log(`  Connection: ${normalizedConnection}`);
            console.log(`  Poll Group: ${normalizedSubscription}`);
            console.log(`  Full Reference: ${fullReference}`);
            console.log(`  Original NodeId: ${reference}`);
            console.log(`  Datatype: ${datatype} (CRITICAL FIELD)`);
            console.log(`  Direction: ${direction}`);
            console.log(`  Manager: ${finalManagerNumber}`);
            console.log(`╠════════════════════════════════════════════════════════════════╣`);
            console.log(`║ Complete addressConfig object:                                 ║`);
            console.log(`╚════════════════════════════════════════════════════════════════╝`);
            console.log(JSON.stringify(addressConfig, null, 2));
            console.log(`\n╔════════════════════════════════════════════════════════════════╗`);
            console.log(`║ Complete distribConfig object:                                 ║`);
            console.log(`╚════════════════════════════════════════════════════════════════╝`);
            console.log(JSON.stringify(distribConfig, null, 2));
            console.log();
            // 11. Set BOTH _address and _distrib configs in a SINGLE ATOMIC operation
            //     CRITICAL: WinCC OA requires these to be set together!
            const configSuccess = await this.setAddressAndDistribConfig(dpName, addressConfig, distribConfig);
            if (!configSuccess) {
                throw new Error('Failed to set _address and _distrib configuration atomically');
            }
            console.log(`✓ Successfully configured OPC UA address for ${dpName}`);
            return true;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`✗ Error configuring OPC UA address for ${dpName}:`, errorMessage);
            throw error; // Re-throw for detailed error in MCP Tool
        }
    }
    /**
     * Create and configure an OPC UA client connection
     *
     * @param config - Configuration of the OPC UA connection
     * @returns Connection name on success, throws Error on failure
     */
    async addConnection(config) {
        try {
            console.log('========================================');
            console.log('Starting OPC UA Connection Setup');
            console.log('========================================');
            // Validate configuration
            this.validateConnectionConfig(config);
            console.log('✓ Configuration validated');
            // Validate OPC UA driver existence and status
            const driverValidation = await this.validateOpcUaDriver(config.managerNumber);
            if (!driverValidation.valid) {
                throw new Error(driverValidation.error);
            }
            if (driverValidation.warnings && driverValidation.warnings.length > 0) {
                console.log('========================================');
                console.log('⚠️  Driver Validation Warnings:');
                console.log('========================================');
                driverValidation.warnings.forEach(warning => {
                    console.warn(`⚠️  ${warning}`);
                });
                console.log('========================================');
            }
            console.log('✓ OPC UA driver validated');
            // Auto-generate connection name
            const connectionName = await this.generateConnectionName();
            console.log(`✓ Connection name: ${connectionName}`);
            // Ensure that _OPCUA<managerNumber> exists
            const managerDpCreated = await this.ensureOpcUaManagerDpExists(config.managerNumber);
            if (!managerDpCreated) {
                throw new Error('Failed to ensure manager datapoint exists');
            }
            console.log(`✓ Manager datapoint _OPCUA${config.managerNumber} ready`);
            // Create connection datapoint
            const connectionDpCreated = await this.ensureConnectionDpExists(connectionName, '_OPCUAServer');
            if (!connectionDpCreated) {
                throw new Error('Failed to create connection datapoint');
            }
            console.log(`✓ Connection datapoint ${connectionName} ready`);
            // Configure connection
            const configured = await this.configureConnection(config, connectionName);
            if (!configured) {
                throw new Error('Failed to configure connection');
            }
            console.log(`✓ Connection configured`);
            // Register connection with manager
            const registered = await this.registerConnectionWithManager(config.managerNumber, connectionName);
            if (!registered) {
                throw new Error('Failed to register connection with manager');
            }
            console.log(`✓ Connection registered with _OPCUA${config.managerNumber}`);
            console.log('========================================');
            console.log('✓ OPC UA Connection Setup Complete');
            console.log(`  Connection: ${connectionName}`);
            console.log(`  Server: opc.tcp://${config.ipAddress}:${config.port}`);
            console.log(`  Manager: _OPCUA${config.managerNumber}`);
            console.log('========================================');
            return connectionName;
        }
        catch (error) {
            console.error('========================================');
            console.error('✗ OPC UA Connection Setup Failed');
            console.error('========================================');
            console.error(`Error: ${error}`);
            throw error;
        }
    }
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
    async deleteConnection(connectionName, managerNumber) {
        try {
            console.log('========================================');
            console.log('Starting OPC UA Connection Deletion');
            console.log('========================================');
            // Normalize connection name (ensure _ prefix)
            const normalizedConnection = connectionName.startsWith('_')
                ? connectionName
                : `_${connectionName}`;
            console.log(`Connection to delete: ${normalizedConnection}`);
            // Check if connection exists
            const connectionExists = this.checkDpExists(normalizedConnection);
            if (!connectionExists) {
                console.warn(`⚠️  Connection ${normalizedConnection} does not exist`);
                console.log(`Available connections: ${this.winccoa.dpNames('_OpcUAConnection*', '_OPCUAServer').join(', ')}`);
                console.log(`Will proceed with cleanup of unused manager datapoints and drivers...`);
            }
            // Get manager number if not provided (only if connection exists)
            let finalManagerNumber;
            let managerDp;
            if (connectionExists) {
                if (managerNumber !== undefined) {
                    finalManagerNumber = managerNumber;
                    console.log(`Using provided manager number: ${finalManagerNumber}`);
                }
                else {
                    finalManagerNumber = await this.getManagerNumberForConnection(normalizedConnection);
                    console.log(`Auto-detected manager number: ${finalManagerNumber}`);
                }
                managerDp = `_OPCUA${finalManagerNumber}`;
                // Connection name without leading underscore
                const nameWithoutUnderscore = normalizedConnection.startsWith('_')
                    ? normalizedConnection.substring(1)
                    : normalizedConnection;
                // 1. Remove connection from manager's server list
                console.log(`Removing connection from ${managerDp}.Config.Servers...`);
                try {
                    const currentServersRaw = await this.winccoa.dpGet(`${managerDp}.Config.Servers`);
                    const currentServers = Array.isArray(currentServersRaw) ? currentServersRaw : [];
                    const updatedServers = currentServers.filter(s => s !== nameWithoutUnderscore);
                    if (updatedServers.length === currentServers.length) {
                        console.warn(`⚠️  Connection ${nameWithoutUnderscore} was not found in server list`);
                    }
                    else {
                        await this.winccoa.dpSetWait(`${managerDp}.Config.Servers`, updatedServers);
                        console.log(`✓ Removed connection from server list`);
                    }
                }
                catch (error) {
                    console.warn(`⚠️  Could not update server list:`, error);
                    // Continue with deletion anyway
                }
                // 2. Delete the connection datapoint
                // Note: The connection will be removed from the driver when it's restarted,
                // or immediately if the driver reloads its configuration automatically
                console.log(`Deleting connection datapoint ${normalizedConnection}...`);
                try {
                    const deleted = await this.winccoa.dpDelete(normalizedConnection);
                    if (!deleted) {
                        throw new Error(`dpDelete returned false for ${normalizedConnection}`);
                    }
                    console.log(`✓ Deleted connection datapoint ${normalizedConnection}`);
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    throw new Error(`Failed to delete connection datapoint: ${errorMessage}`);
                }
            }
            else {
                console.log(`Skipping connection deletion as it does not exist`);
            }
            // 3. Check if there are any remaining connections on this driver (only if manager was identified)
            let remainingServers = [];
            let driverRemovedSuccessfully = false;
            if (managerDp && finalManagerNumber !== undefined) {
                console.log(`Checking for remaining connections on ${managerDp}...`);
                try {
                    const remainingServersRaw = await this.winccoa.dpGet(`${managerDp}.Config.Servers`);
                    remainingServers = Array.isArray(remainingServersRaw) ? remainingServersRaw : [];
                    if (remainingServers.length === 0) {
                        console.log(`⚠️  No more connections on ${managerDp}, removing driver...`);
                        // Get the driver's manager index from Pmon
                        const pmonClient = new PmonClient();
                        let driverIndex = null;
                        try {
                            const status = await pmonClient.getManagerStatus();
                            const managerList = await pmonClient.getManagerList();
                            for (let i = 0; i < status.managers.length; i++) {
                                const mgr = status.managers[i];
                                if (!mgr)
                                    continue;
                                const mgrDetails = managerList[mgr.index];
                                if (!mgrDetails)
                                    continue;
                                // Check if this is the OPC UA driver with the correct number
                                const isOpcUaDriver = mgrDetails.manager?.toLowerCase().includes('opcua') ||
                                    mgrDetails.manager?.toLowerCase().includes('opc-ua');
                                if (isOpcUaDriver) {
                                    // IMPORTANT: Drivers without -num parameter implicitly run as -num 1
                                    const numMatch = mgrDetails.commandlineOptions?.match(/-num\s+(\d+)/);
                                    const configuredNum = numMatch && numMatch[1] ? parseInt(numMatch[1], 10) : 1; // Default to 1 if no -num specified
                                    if (configuredNum === finalManagerNumber) {
                                        driverIndex = mgr.index;
                                        console.log(`Found driver at Pmon index ${driverIndex}`);
                                        break;
                                    }
                                }
                            }
                            if (driverIndex !== null) {
                                // Stop the driver first
                                console.log(`🔧 Stopping OPC UA driver at index ${driverIndex}...`);
                                const stopResult = await pmonClient.stopManager(driverIndex);
                                if (stopResult.success) {
                                    console.log(`✓ Stopped OPC UA driver`);
                                }
                                else {
                                    console.warn(`⚠️  Failed to stop driver: ${stopResult.error}`);
                                }
                                // Wait a moment for the driver to stop
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                // Remove the driver from Pmon
                                console.log(`🔧 Removing OPC UA driver from Pmon...`);
                                const removeResult = await pmonClient.removeManager(driverIndex);
                                if (removeResult.success) {
                                    console.log(`✅ Successfully removed OPC UA driver from Pmon`);
                                    driverRemovedSuccessfully = true;
                                }
                                else {
                                    console.warn(`⚠️  Failed to remove driver from Pmon: ${removeResult.error}`);
                                }
                                // Delete the _OPCUA{num} datapoint
                                console.log(`🔧 Deleting manager datapoint ${managerDp}...`);
                                try {
                                    const deletedMgr = await this.winccoa.dpDelete(managerDp);
                                    if (deletedMgr) {
                                        console.log(`✅ Successfully deleted manager datapoint ${managerDp}`);
                                    }
                                    else {
                                        console.warn(`⚠️  Failed to delete manager datapoint ${managerDp}`);
                                    }
                                }
                                catch (deleteMgrError) {
                                    const deleteMgrErrorMsg = deleteMgrError instanceof Error ? deleteMgrError.message : String(deleteMgrError);
                                    console.warn(`⚠️  Error deleting manager datapoint: ${deleteMgrErrorMsg}`);
                                }
                                // Delete the _Driver{num} datapoint
                                // IMPORTANT: Never delete _Driver1, _Driver2, _Driver3 - these are reserved for system managers
                                if (finalManagerNumber > 3) {
                                    const driverDp = `_Driver${finalManagerNumber}`;
                                    console.log(`🔧 Deleting driver common datapoint ${driverDp}...`);
                                    try {
                                        if (this.checkDpExists(driverDp)) {
                                            const deletedDriver = await this.winccoa.dpDelete(driverDp);
                                            if (deletedDriver) {
                                                console.log(`✅ Successfully deleted driver common datapoint ${driverDp}`);
                                            }
                                            else {
                                                console.warn(`⚠️  Failed to delete driver common datapoint ${driverDp}`);
                                            }
                                        }
                                        else {
                                            console.log(`  Driver common datapoint ${driverDp} does not exist, skipping`);
                                        }
                                    }
                                    catch (deleteDriverError) {
                                        const deleteDriverErrorMsg = deleteDriverError instanceof Error ? deleteDriverError.message : String(deleteDriverError);
                                        console.warn(`⚠️  Error deleting driver common datapoint: ${deleteDriverErrorMsg}`);
                                    }
                                }
                                else {
                                    console.log(`Skipping _Driver${finalManagerNumber} deletion - reserved for system managers (1-3)`);
                                }
                            }
                            else {
                                console.warn(`⚠️  Could not find driver in Pmon (may already be removed)`);
                            }
                        }
                        catch (pmonError) {
                            const pmonErrorMsg = pmonError instanceof Error ? pmonError.message : String(pmonError);
                            console.warn(`⚠️  Could not remove driver from Pmon: ${pmonErrorMsg}`);
                        }
                    }
                    else {
                        console.log(`✓ Driver has ${remainingServers.length} remaining connection(s), keeping it active`);
                    }
                }
                catch (checkError) {
                    console.warn(`⚠️  Could not check for remaining connections:`, checkError);
                    // Continue anyway
                }
            }
            else {
                console.log(`No specific manager to check, proceeding with general cleanup...`);
            }
            // 4. Clean up any other unused _OPCUA{num} datapoints (client managers only, not server)
            console.log(`🔍 Checking for other unused OPC UA client manager datapoints and drivers...`);
            try {
                const allOpcuaDps = this.winccoa.dpNames('_OPCUA*', '_OPCUA');
                let cleanedCount = 0;
                let cleanedDrivers = 0;
                // Get Pmon information once for all cleanup operations
                const pmonClient = new PmonClient();
                let status;
                let managerList;
                try {
                    status = await pmonClient.getManagerStatus();
                    managerList = await pmonClient.getManagerList();
                }
                catch (pmonError) {
                    console.warn(`⚠️  Could not connect to Pmon for driver cleanup:`, pmonError);
                    // Continue with datapoint cleanup only
                }
                for (const opcuaDp of allOpcuaDps) {
                    // Skip _OPCUAPvssServer - that's for OPC UA Server functionality, not client
                    if (opcuaDp === '_OPCUAPvssServer') {
                        continue;
                    }
                    // Skip the one we successfully removed in step 3
                    if (opcuaDp === managerDp && driverRemovedSuccessfully) {
                        console.log(`  Skipping ${opcuaDp} - already processed in step 3`);
                        continue;
                    }
                    try {
                        // Check if datapoint still exists (might have been deleted already)
                        if (!this.checkDpExists(opcuaDp)) {
                            console.log(`  Skipping ${opcuaDp} - already deleted`);
                            continue;
                        }
                        // Check if this datapoint has any servers configured
                        const serversRaw = await this.winccoa.dpGet(`${opcuaDp}.Config.Servers`);
                        const servers = Array.isArray(serversRaw) ? serversRaw : [];
                        if (servers.length === 0) {
                            console.log(`🔧 Found unused client manager datapoint ${opcuaDp}, cleaning up...`);
                            // Extract manager number from datapoint name (e.g., _OPCUA4 -> 4)
                            const managerNumMatch = opcuaDp.match(/_OPCUA(\d+)/);
                            const managerNum = managerNumMatch && managerNumMatch[1] ? parseInt(managerNumMatch[1], 10) : null;
                            // Try to find and remove the corresponding driver from Pmon
                            if (managerNum !== null && status && managerList) {
                                let foundDriverIndex = null;
                                for (let i = 0; i < status.managers.length; i++) {
                                    const mgr = status.managers[i];
                                    if (!mgr)
                                        continue;
                                    const mgrDetails = managerList[mgr.index];
                                    if (!mgrDetails)
                                        continue;
                                    // Check if this is the OPC UA driver with the correct number
                                    const isOpcUaDriver = mgrDetails.manager?.toLowerCase().includes('opcua') ||
                                        mgrDetails.manager?.toLowerCase().includes('opc-ua');
                                    if (isOpcUaDriver) {
                                        // IMPORTANT: Drivers without -num parameter implicitly run as -num 1
                                        const numMatch = mgrDetails.commandlineOptions?.match(/-num\s+(\d+)/);
                                        const configuredNum = numMatch && numMatch[1] ? parseInt(numMatch[1], 10) : 1; // Default to 1 if no -num specified
                                        if (configuredNum === managerNum) {
                                            foundDriverIndex = mgr.index;
                                            break;
                                        }
                                    }
                                }
                                if (foundDriverIndex !== null) {
                                    console.log(`  🔧 Stopping driver at Pmon index ${foundDriverIndex}...`);
                                    try {
                                        await pmonClient.stopManager(foundDriverIndex);
                                        await new Promise(resolve => setTimeout(resolve, 500));
                                        console.log(`  🔧 Removing driver from Pmon...`);
                                        const removeResult = await pmonClient.removeManager(foundDriverIndex);
                                        if (removeResult.success) {
                                            console.log(`  ✅ Removed driver for ${opcuaDp}`);
                                            cleanedDrivers++;
                                        }
                                    }
                                    catch (removeDriverError) {
                                        console.warn(`  ⚠️  Could not remove driver for ${opcuaDp}:`, removeDriverError);
                                    }
                                }
                            }
                            // Delete the datapoint
                            const deleted = await this.winccoa.dpDelete(opcuaDp);
                            if (deleted) {
                                console.log(`  ✅ Deleted unused client manager datapoint ${opcuaDp}`);
                                cleanedCount++;
                            }
                            // Also delete the _Driver{num} datapoint if it exists
                            // IMPORTANT: Never delete _Driver1, _Driver2, _Driver3 - these are reserved for system managers
                            if (managerNum !== null && managerNum > 3) {
                                const driverDp = `_Driver${managerNum}`;
                                if (this.checkDpExists(driverDp)) {
                                    console.log(`  🔧 Deleting driver common datapoint ${driverDp}...`);
                                    const deletedDriver = await this.winccoa.dpDelete(driverDp);
                                    if (deletedDriver) {
                                        console.log(`  ✅ Deleted driver common datapoint ${driverDp}`);
                                        cleanedCount++;
                                    }
                                }
                            }
                            else if (managerNum !== null && managerNum <= 3) {
                                console.log(`  Skipping _Driver${managerNum} - reserved for system managers`);
                            }
                        }
                    }
                    catch (checkDpError) {
                        // Datapoint might not exist anymore or have issues, skip it
                        continue;
                    }
                }
                if (cleanedCount > 0 || cleanedDrivers > 0) {
                    console.log(`✅ Cleaned up ${cleanedCount} unused client manager datapoint(s) and ${cleanedDrivers} driver(s)`);
                }
                else {
                    console.log(`✓ No unused client manager datapoints or drivers found`);
                }
            }
            catch (cleanupError) {
                console.warn(`⚠️  Could not check for unused client manager datapoints:`, cleanupError);
                // Continue anyway
            }
            console.log('========================================');
            console.log('✓ OPC UA Connection Deletion Complete');
            if (connectionExists) {
                console.log(`  Connection: ${normalizedConnection}`);
                if (managerDp) {
                    console.log(`  Manager: ${managerDp}`);
                }
            }
            else {
                console.log(`  Connection did not exist, performed cleanup only`);
            }
            console.log('========================================');
            return true;
        }
        catch (error) {
            console.error('========================================');
            console.error('✗ OPC UA Connection Deletion Failed');
            console.error('========================================');
            console.error(`Error: ${error}`);
            throw error;
        }
    }
}
// Default export
export default OpcUaConnection;
//# sourceMappingURL=OpcUaConnection.js.map
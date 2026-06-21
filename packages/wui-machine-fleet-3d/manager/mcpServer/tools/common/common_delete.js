/**
 * Common Config Delete Tool
 *
 * MCP tool for deleting common config attributes from datapoint elements.
 */
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse } from '../../utils/helpers.js';
/**
 * Delete common config attributes for a datapoint element
 * Deletes by setting attributes to empty strings
 */
async function deleteCommonConfig(winccoa, dpe, deleteDescription, deleteAlias, deleteFormat, deleteUnit) {
    const deletedAttributes = [];
    try {
        // Delete description if requested
        if (deleteDescription) {
            console.log(`Deleting description for ${dpe}`);
            await winccoa.dpSetDescription(dpe, '');
            deletedAttributes.push('description');
        }
        // Delete alias if requested
        if (deleteAlias) {
            console.log(`Deleting alias for ${dpe}`);
            await winccoa.dpSetAlias(dpe, '');
            deletedAttributes.push('alias');
        }
        // Delete format if requested
        if (deleteFormat) {
            console.log(`Deleting format for ${dpe}`);
            await winccoa.dpSetFormat(dpe, '');
            deletedAttributes.push('format');
        }
        // Delete unit if requested
        if (deleteUnit) {
            console.log(`Deleting unit for ${dpe}`);
            await winccoa.dpSetUnit(dpe, '');
            deletedAttributes.push('unit');
        }
        return deletedAttributes;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to delete attributes (successfully deleted: ${deletedAttributes.join(', ')}): ${errorMessage}`);
    }
}
/**
 * Register common config delete tools
 * @param server - MCP server instance
 * @param context - Server context with winccoa, configs, etc.
 * @returns Number of tools registered
 */
export function registerTools(server, context) {
    const { winccoa } = context;
    server.tool("common-delete", `Delete specific common config attributes from a datapoint element in WinCC OA.

    Deletes attributes by setting them to empty strings.
    You can delete individual attributes or all attributes at once.
    At least one attribute or 'all' must be specified.

    Examples:

    Delete only unit:
    {
      "dpe": "System1:Temperature.",
      "unit": true
    }

    Delete description and alias:
    {
      "dpe": "System1:Temperature.",
      "description": true,
      "alias": true
    }

    Delete format and unit:
    {
      "dpe": "System1:Pressure.",
      "format": true,
      "unit": true
    }

    Delete all attributes:
    {
      "dpe": "System1:Temperature.",
      "all": true
    }

    Returns: Success with list of deleted attributes.
    `, {
        config: z.union([
            z.object({
                dpe: z.string().describe('Datapoint element name (e.g., System1:MyTag.)'),
                description: z.boolean().optional().describe('Delete description if true'),
                alias: z.boolean().optional().describe('Delete alias if true'),
                format: z.boolean().optional().describe('Delete format if true'),
                unit: z.boolean().optional().describe('Delete unit if true'),
                all: z.boolean().optional().describe('Delete all attributes if true')
            }),
            z.string()
        ])
    }, async ({ config }) => {
        try {
            // Parse string if needed
            let parsedConfig = typeof config === 'string' ? JSON.parse(config) : config;
            console.log('========================================');
            console.log('Deleting Common Config Attributes');
            console.log('========================================');
            console.log(`DPE: ${parsedConfig.dpe}`);
            // Check if DPE exists
            if (!winccoa.dpExists(parsedConfig.dpe)) {
                throw new Error(`DPE ${parsedConfig.dpe} does not exist in the system`);
            }
            // Determine which attributes to delete
            const deleteAll = parsedConfig.all === true;
            const deleteDescription = deleteAll || parsedConfig.description === true;
            const deleteAlias = deleteAll || parsedConfig.alias === true;
            const deleteFormat = deleteAll || parsedConfig.format === true;
            const deleteUnit = deleteAll || parsedConfig.unit === true;
            // Validate at least one attribute is specified for deletion
            if (!deleteDescription && !deleteAlias && !deleteFormat && !deleteUnit) {
                throw new Error('At least one attribute must be specified for deletion (description, alias, format, unit, or all)');
            }
            // Delete the common config attributes
            const deletedAttributes = await deleteCommonConfig(winccoa, parsedConfig.dpe, deleteDescription, deleteAlias, deleteFormat, deleteUnit);
            console.log(`✓ Deleted attributes: ${deletedAttributes.join(', ')}`);
            console.log('========================================');
            console.log('✓ Common Config Delete Complete');
            console.log('========================================');
            return createSuccessResponse({
                dpe: parsedConfig.dpe,
                message: 'Common config attributes deleted successfully',
                deletedAttributes: deletedAttributes
            });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('========================================');
            console.error('✗ Common Config Delete Failed');
            console.error('========================================');
            console.error(`Error: ${errorMessage}`);
            return createErrorResponse(`Failed to delete common config: ${errorMessage}`);
        }
    });
    return 1; // Number of tools registered
}
//# sourceMappingURL=common_delete.js.map
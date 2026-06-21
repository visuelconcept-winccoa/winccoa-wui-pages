/**
 * Dashboard Widget Schema Types
 *
 * Based on WinCC OA Dashboard Widget Instance JSON Schema
 * Implements the official context-based widget structure
 */
/**
 * Helper to check if settings are structured
 */
export function isStructuredSettings(settings) {
    return 'config' in settings && typeof settings.config === 'object';
}
/**
 * Helper to create an array context
 */
export function createArrayContext(items) {
    return {
        context: 'array',
        config: items
    };
}
/**
 * Helper to create a simplified group context (without wrapping static values)
 * The framework will automatically wrap simple values in static contexts
 */
export function createSimpleGroupContext(config) {
    return {
        context: 'group',
        config: unwrapStaticValues(config)
    };
}
/**
 * Unwrap static context wrappers from config object
 * Keeps data-point contexts wrapped (they need backend queries)
 */
function unwrapStaticValues(config) {
    const unwrapped = {};
    for (const [key, value] of Object.entries(config)) {
        if (value && typeof value === 'object') {
            // Keep data-point contexts wrapped (they're dynamic)
            if (value.context === 'data-point') {
                unwrapped[key] = value;
            }
            // Keep array contexts but unwrap their items
            else if (value.context === 'array') {
                unwrapped[key] = {
                    context: 'array',
                    config: value.config.map((item) => item.context === 'group' ? createSimpleGroupContext(item.config) : item)
                };
            }
            // Keep group contexts but unwrap their config
            else if (value.context === 'group') {
                unwrapped[key] = createSimpleGroupContext(value.config);
            }
            // Unwrap static contexts to simple values
            else if (value.context === 'static') {
                unwrapped[key] = value.config;
            }
            // Keep other objects as-is
            else {
                unwrapped[key] = value;
            }
        }
        else {
            // Primitive values stay as-is
            unwrapped[key] = value;
        }
    }
    return unwrapped;
}
//# sourceMappingURL=schema.js.map
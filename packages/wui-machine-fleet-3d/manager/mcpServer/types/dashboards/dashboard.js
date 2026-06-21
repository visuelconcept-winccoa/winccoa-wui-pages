/**
 * Dashboard Types
 *
 * Defines dashboard configuration and identification types
 */
/**
 * Check if identifier is by ID
 */
export function isWidgetIdIdentifier(identifier) {
    return 'id' in identifier;
}
/**
 * Check if identifier is by index
 */
export function isWidgetIndexIdentifier(identifier) {
    return 'index' in identifier;
}
/**
 * Generate dashboard datapoint name from number
 */
export function getDashboardDatapointName(dashboardNumber) {
    const paddedNumber = dashboardNumber.toString().padStart(6, '0');
    return `_Dashboard_${paddedNumber}`;
}
/**
 * Extract dashboard number from datapoint name
 */
export function extractDashboardNumber(dpName) {
    const match = dpName.match(/_Dashboard_0*(\d+)/);
    return match && match[1] ? parseInt(match[1], 10) : null;
}
/**
 * Create default dashboard settings
 */
export function createDefaultDashboardSettings(name, description) {
    return {
        name: {
            'en_US.utf8': name
        },
        description: {
            'en_US.utf8': description
        },
        presentation: {
            margin: null,
            backgroundColor: {
                color: 'rgba(255,255,255,1)',
                useDifferentColors: true,
                darkModeColor: 'rgba(19,19,19,1)'
            },
            transparentWidgets: false
        },
        rangeSelectorValue: {
            state: 'undefined'
        },
        icon: null,
        showInMenu: false
    };
}
//# sourceMappingURL=dashboard.js.map
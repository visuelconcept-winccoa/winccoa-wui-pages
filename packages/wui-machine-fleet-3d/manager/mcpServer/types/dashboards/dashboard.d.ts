/**
 * Dashboard Types
 *
 * Defines dashboard configuration and identification types
 */
/**
 * Dashboard configuration
 */
export interface DashboardConfig {
    name: string;
    description: string;
    createdBy: string;
}
/**
 * Dashboard information (as returned by listDashboards)
 */
export interface DashboardInfo {
    id: string;
    dashboardNumber: number;
    name: string;
    description: string;
    widgetCount: number;
    isPublished: boolean;
}
/**
 * Widget identifier (by ID or by index in array)
 */
export type WidgetIdentifier = {
    id: string;
} | {
    index: number;
};
/**
 * Check if identifier is by ID
 */
export declare function isWidgetIdIdentifier(identifier: WidgetIdentifier): identifier is {
    id: string;
};
/**
 * Check if identifier is by index
 */
export declare function isWidgetIndexIdentifier(identifier: WidgetIdentifier): identifier is {
    index: number;
};
/**
 * Dashboard datapoint structure (minimal required fields)
 */
export interface DashboardDatapoint {
    id: number;
    isPublished: number;
    settings: string;
    widgets: string[];
}
/**
 * Generate dashboard datapoint name from number
 */
export declare function getDashboardDatapointName(dashboardNumber: number): string;
/**
 * Extract dashboard number from datapoint name
 */
export declare function extractDashboardNumber(dpName: string): number | null;
/**
 * Dashboard settings JSON structure
 */
export interface DashboardSettings {
    name: {
        [locale: string]: string;
    };
    description: {
        [locale: string]: string;
    };
    presentation: {
        margin: null;
        backgroundColor: {
            color: string;
            useDifferentColors: boolean;
            darkModeColor: string;
        };
        transparentWidgets: boolean;
    };
    rangeSelectorValue: {
        state: string;
    };
    icon: null;
    showInMenu: boolean;
}
/**
 * Create default dashboard settings
 */
export declare function createDefaultDashboardSettings(name: string, description: string): DashboardSettings;
//# sourceMappingURL=dashboard.d.ts.map
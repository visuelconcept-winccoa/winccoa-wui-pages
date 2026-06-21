/**
 * Dashboard Manager
 *
 * Central class for managing dashboards and widgets in WinCC OA.
 * Provides CRUD operations for dashboards and widgets.
 */
import type { WinccoaManager } from 'winccoa-manager';
import { WidgetFactory } from './WidgetFactory.js';
import { LayoutHelper } from './LayoutHelper.js';
import type { DashboardConfig, DashboardInfo, WidgetIdentifier } from '../../types/dashboards/dashboard.js';
import type { WidgetInstance } from '../../types/dashboards/schema.js';
import type { WidgetConfig } from '../../types/dashboards/widgets.js';
/**
 * Dashboard Manager Class
 */
export declare class DashboardManager {
    private winccoa;
    private widgetFactory;
    private layoutHelper;
    constructor(winccoa: WinccoaManager);
    /**
     * Get the WidgetFactory instance (for registering custom widget types)
     */
    getWidgetFactory(): WidgetFactory;
    /**
     * Get the LayoutHelper instance
     */
    getLayoutHelper(): LayoutHelper;
    /**
     * Create a new dashboard
     * @param config - Dashboard configuration (name, description, createdBy)
     * @returns Dashboard datapoint name (e.g. "_Dashboard_000001")
     */
    createDashboard(config: DashboardConfig): Promise<string>;
    /**
     * Edit dashboard properties
     * @param dashboardId - Dashboard datapoint name
     * @param updates - Properties to update (name and/or description)
     */
    editDashboard(dashboardId: string, updates: Partial<DashboardConfig>): Promise<void>;
    /**
     * Delete a dashboard
     * @param dashboardId - Dashboard datapoint name
     */
    deleteDashboard(dashboardId: string): Promise<void>;
    /**
     * List all dashboards
     * @returns Array of dashboard information
     */
    listDashboards(): Promise<DashboardInfo[]>;
    /**
     * Add a widget to a dashboard
     * @param dashboardId - Dashboard datapoint name
     * @param config - Widget configuration
     * @returns Widget ID (UUID)
     */
    addWidget(dashboardId: string, config: WidgetConfig): Promise<string>;
    /**
     * Edit a widget on a dashboard
     * @param dashboardId - Dashboard datapoint name
     * @param identifier - Widget identifier (by ID or index)
     * @param updates - Widget configuration updates
     */
    editWidget(dashboardId: string, identifier: WidgetIdentifier, updates: Partial<WidgetConfig>): Promise<void>;
    /**
     * Delete a widget from a dashboard
     * @param dashboardId - Dashboard datapoint name
     * @param identifier - Widget identifier (by ID or index)
     */
    deleteWidget(dashboardId: string, identifier: WidgetIdentifier): Promise<void>;
    /**
     * List all widgets on a dashboard
     * @param dashboardId - Dashboard datapoint name
     * @returns Array of widget instances
     */
    listWidgets(dashboardId: string): Promise<WidgetInstance[]>;
    /**
     * Get next available dashboard number
     * @returns Next dashboard number
     */
    private getNextDashboardNumber;
    /**
     * Get widgets from dashboard
     * @param dashboardId - Dashboard datapoint name
     * @returns Array of widget instances
     */
    private getWidgets;
    /**
     * Find widget index by identifier
     * @param widgets - Array of widgets
     * @param identifier - Widget identifier
     * @returns Widget index or -1 if not found
     */
    private findWidgetIndex;
    /**
     * Validate widget configuration
     * @param config - Widget configuration
     */
    private validateWidgetConfig;
    /**
     * Validate that datapoints exist
     * @param config - Widget configuration
     */
    private validateDatapoints;
    /**
     * Get unit from datapoint configuration
     * @param dpName - Datapoint name
     * @returns Unit string or undefined
     */
    private getDatapointUnit;
}
//# sourceMappingURL=DashboardManager.d.ts.map
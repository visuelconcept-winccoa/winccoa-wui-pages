/**
 * Widget Factory
 *
 * Factory class for creating widget instances with proper schema structure.
 * Uses Factory Pattern to allow registration of new widget types.
 */
import type { WidgetInstance } from '../../types/dashboards/schema.js';
import type { WidgetConfig } from '../../types/dashboards/widgets.js';
import type { WidgetDimensions } from '../../types/dashboards/layout.js';
/**
 * Widget creator function type
 */
type WidgetCreator = (config: any, dimensions: WidgetDimensions) => WidgetInstance;
/**
 * Widget Factory Class
 */
export declare class WidgetFactory {
    private creators;
    constructor();
    /**
     * Register a new widget type
     * @param type - Widget type identifier
     * @param creator - Function to create widget instances
     */
    registerWidgetType(type: string, creator: WidgetCreator): void;
    /**
     * Create a widget instance
     * @param config - Widget configuration
     * @param dimensions - Widget dimensions (position and size)
     * @returns Complete widget instance
     */
    createWidget(config: WidgetConfig, dimensions: WidgetDimensions): WidgetInstance;
    /**
     * Generate UUID v4 for widget IDs
     * @returns UUID v4 string
     */
    generateUuidV4(): string;
    /**
     * Create general settings (appearance) from widget appearance config
     * @param appearance - Optional appearance configuration
     * @returns Group context for settings.general
     */
    private createGeneralSettings;
    /**
     * Create Gauge widget
     */
    private createGauge;
    /**
     * Create Label widget
     */
    private createLabel;
    /**
     * Create Trend widget
     * Supports single or multiple datapoints with custom y-axis per series
     */
    private createTrend;
    /**
     * Create Pie widget
     * ECharts-based widget extending WuiEchartsWithLegend
     */
    private createPie;
    /**
     * Create Progress Bar widget
     */
    private createProgressBar;
    /**
     * Create Bar Chart widget
     */
    private createBarChart;
}
export {};
//# sourceMappingURL=WidgetFactory.d.ts.map
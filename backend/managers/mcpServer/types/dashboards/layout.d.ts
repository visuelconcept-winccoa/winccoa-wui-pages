/**
 * Dashboard Layout Types
 *
 * Defines layout presets and grid positioning for dashboard widgets
 */
/**
 * Grid position with size
 */
export interface GridPosition {
    x: number;
    y: number;
    cols: number;
    rows: number;
}
/**
 * Minimum dimensions for widgets
 */
export interface MinimumDimensions {
    minCols: number;
    minRows: number;
}
/**
 * Complete widget dimensions including minimums
 */
export interface WidgetDimensions extends GridPosition, MinimumDimensions {
}
/**
 * Layout preset names
 */
export type LayoutPreset = 'auto' | 'small' | 'medium' | 'large' | 'fullwidth';
/**
 * Layout configuration (preset name or explicit position)
 */
export type LayoutConfig = LayoutPreset | GridPosition;
/**
 * Widget size category presets
 */
export interface WidgetSizePreset {
    cols: number;
    rows: number;
    minCols: number;
    minRows: number;
}
/**
 * Map of presets for a widget type
 */
export type WidgetPresets = {
    [K in Exclude<LayoutPreset, 'auto'>]?: WidgetSizePreset;
};
/**
 * Dashboard grid constants
 */
export declare const DASHBOARD_GRID: {
    /** Total columns in dashboard grid */
    readonly TOTAL_COLUMNS: 50;
    /** Default widget spacing */
    readonly SPACING: 0;
    /** Minimum widget size */
    readonly MIN_SIZE: 3;
    /** Grid alignment for auto-positioning (widgets snap to multiples of this value) */
    readonly ALIGNMENT: 4;
};
/**
 * Widget Size Presets - Sizing Philosophy
 *
 * All widget sizes follow 4-column grid alignment principle for professional dashboard layouts.
 *
 * SIZING PHILOSOPHY:
 * - Small: Discouraged for production use (hard to read, creates visual clutter)
 * - Medium: RECOMMENDED baseline for professional dashboards (optimal readability)
 * - Large: For emphasis or data-heavy widgets requiring more space
 * - Fullwidth: Special case for single-row spanning widgets
 *
 * GRID ALIGNMENT:
 * - Dashboard width: 50 columns
 * - Recommended column widths: 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48
 * - Using 4-column increments ensures perfect grid alignment
 * - Examples: 8 cols = 1/6 width (6 per row), 12 cols = 1/4 width (4 per row), 24 cols = 1/2 width (2 per row)
 *
 * DESIGN GUIDELINES:
 * - Consistent sizing within widget groups creates professional appearance
 * - Medium (8x8 gauge, 12x8 chart, 24x8 trend) creates the "Tunnel Lighting System" look
 * - Avoid mixing small/medium/large randomly - leads to unstructured layouts
 */
/**
 * Default preset dimensions for Gauge widget
 */
export declare const GAUGE_PRESETS: WidgetPresets;
/**
 * Default preset dimensions for Label widget
 */
export declare const LABEL_PRESETS: WidgetPresets;
/**
 * Default preset dimensions for Trend widget
 */
export declare const TREND_PRESETS: WidgetPresets;
/**
 * Default preset dimensions for Pie widget
 */
export declare const PIE_PRESETS: WidgetPresets;
/**
 * Default preset dimensions for Bar Chart widget
 */
export declare const BARCHART_PRESETS: WidgetPresets;
/**
 * Get presets for a widget type
 */
export declare function getWidgetPresets(widgetType: string): WidgetPresets;
/**
 * Get default dimensions for a widget type
 */
export declare function getDefaultDimensions(widgetType: string): WidgetSizePreset;
/**
 * Check if a layout config is a preset name
 */
export declare function isLayoutPreset(layout: LayoutConfig): layout is LayoutPreset;
/**
 * Check if a layout config is a grid position
 */
export declare function isGridPosition(layout: LayoutConfig): layout is GridPosition;
//# sourceMappingURL=layout.d.ts.map
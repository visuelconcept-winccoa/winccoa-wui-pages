/**
 * Dashboard Layout Types
 *
 * Defines layout presets and grid positioning for dashboard widgets
 */
/**
 * Dashboard grid constants
 */
export const DASHBOARD_GRID = {
    /** Total columns in dashboard grid */
    TOTAL_COLUMNS: 50,
    /** Default widget spacing */
    SPACING: 0,
    /** Minimum widget size */
    MIN_SIZE: 3,
    /** Grid alignment for auto-positioning (widgets snap to multiples of this value) */
    ALIGNMENT: 4
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
export const GAUGE_PRESETS = {
    medium: { cols: 8, rows: 8, minCols: 6, minRows: 6 },
    large: { cols: 8, rows: 8, minCols: 6, minRows: 6 }
};
/**
 * Default preset dimensions for Label widget
 */
export const LABEL_PRESETS = {
    medium: { cols: 8, rows: 4, minCols: 6, minRows: 3 },
    large: { cols: 12, rows: 4, minCols: 6, minRows: 3 }
};
/**
 * Default preset dimensions for Trend widget
 */
export const TREND_PRESETS = {
    medium: { cols: 24, rows: 8, minCols: 8, minRows: 8 },
    large: { cols: 24, rows: 12, minCols: 8, minRows: 8 },
    fullwidth: { cols: 24, rows: 8, minCols: 8, minRows: 8 }
};
/**
 * Default preset dimensions for Pie widget
 */
export const PIE_PRESETS = {
    medium: { cols: 8, rows: 8, minCols: 6, minRows: 6 },
    large: { cols: 12, rows: 12, minCols: 6, minRows: 6 }
};
/**
 * Default preset dimensions for Bar Chart widget
 */
export const BARCHART_PRESETS = {
    medium: { cols: 12, rows: 8, minCols: 6, minRows: 6 },
    large: { cols: 16, rows: 10, minCols: 6, minRows: 6 }
};
/**
 * Get presets for a widget type
 */
export function getWidgetPresets(widgetType) {
    switch (widgetType) {
        case 'gauge':
            return GAUGE_PRESETS;
        case 'label':
            return LABEL_PRESETS;
        case 'trend':
            return TREND_PRESETS;
        case 'pie':
            return PIE_PRESETS;
        case 'barchart':
        case 'progressbar':
            return BARCHART_PRESETS;
        default:
            // Default to medium gauge preset for unknown types
            return GAUGE_PRESETS;
    }
}
/**
 * Get default dimensions for a widget type
 */
export function getDefaultDimensions(widgetType) {
    const presets = getWidgetPresets(widgetType);
    return presets.medium || { cols: 8, rows: 8, minCols: 6, minRows: 6 };
}
/**
 * Check if a layout config is a preset name
 */
export function isLayoutPreset(layout) {
    return typeof layout === 'string';
}
/**
 * Check if a layout config is a grid position
 */
export function isGridPosition(layout) {
    return (typeof layout === 'object' &&
        'x' in layout &&
        'y' in layout &&
        'cols' in layout &&
        'rows' in layout);
}
//# sourceMappingURL=layout.js.map
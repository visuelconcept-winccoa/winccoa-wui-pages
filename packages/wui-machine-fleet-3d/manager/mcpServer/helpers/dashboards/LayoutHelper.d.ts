/**
 * Layout Helper
 *
 * Helper class for resolving widget layouts, finding positions, and validating grid placements.
 */
import type { LayoutConfig, LayoutPreset, GridPosition, WidgetDimensions, WidgetSizePreset } from '../../types/dashboards/layout.js';
import type { WidgetInstance } from '../../types/dashboards/schema.js';
import type { WidgetType } from '../../types/dashboards/widgets.js';
/**
 * Layout Helper Class
 */
export declare class LayoutHelper {
    /**
     * Resolve layout configuration to concrete grid position with dimensions
     * @param layout - Layout configuration (preset or explicit position)
     * @param widgetType - Type of widget
     * @param existingWidgets - Array of existing widgets on dashboard
     * @returns Complete widget dimensions
     */
    resolveLayout(layout: LayoutConfig | undefined, widgetType: WidgetType, existingWidgets: WidgetInstance[]): WidgetDimensions;
    /**
     * Get preset dimensions for a widget type
     * @param preset - Preset name
     * @param widgetType - Widget type
     * @returns Widget size preset with dimensions
     */
    getPresetDimensions(preset: LayoutPreset, widgetType: WidgetType): WidgetSizePreset;
    /**
     * Align a coordinate to the grid alignment
     * @param value - Coordinate value
     * @returns Aligned coordinate (multiple of DASHBOARD_GRID.ALIGNMENT)
     */
    private alignToGrid;
    /**
     * Find next available position in grid for a widget
     * Uses simple top-to-bottom, left-to-right placement with 4-column grid alignment
     * @param existingWidgets - Array of existing widgets
     * @param widgetSize - Size of widget to place
     * @returns Grid position {x, y}
     */
    findAutoPosition(existingWidgets: WidgetInstance[], widgetSize: {
        cols: number;
        rows: number;
    }): {
        x: number;
        y: number;
    };
    /**
     * Check if a position is available (no overlap with existing widgets)
     * @param position - Position to check
     * @param size - Size of widget
     * @param existingWidgets - Existing widgets on dashboard
     * @returns true if position is available
     */
    private isPositionAvailable;
    /**
     * Check if two widgets overlap
     * @param w1 - First widget
     * @param w2 - Second widget
     * @returns true if widgets overlap
     */
    widgetsOverlap(w1: {
        x: number;
        y: number;
        cols: number;
        rows: number;
    }, w2: {
        x: number;
        y: number;
        cols: number;
        rows: number;
    }): boolean;
    /**
     * Get maximum Y coordinate (bottom edge) of existing widgets
     * @param widgets - Array of widgets
     * @returns Maximum Y + rows
     */
    private getMaxY;
    /**
     * Validate grid position
     * @param position - Position to validate
     * @returns true if valid
     */
    validateGridPosition(position: GridPosition): boolean;
    /**
     * Suggest next position for a widget (helper for user)
     * @param existingWidgets - Existing widgets
     * @param widgetType - Type of widget to place
     * @param preset - Optional preset
     * @returns Suggested grid position
     */
    suggestNextPosition(existingWidgets: WidgetInstance[], widgetType: WidgetType, preset?: LayoutPreset): WidgetDimensions;
}
//# sourceMappingURL=LayoutHelper.d.ts.map
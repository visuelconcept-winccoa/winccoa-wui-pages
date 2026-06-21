/**
 * Icon Generator
 *
 * Utility class for generating custom SVG icons for WinCC OA dashboards.
 * Icons are saved to /data/WebUI/icons/ and can be referenced in widget headers/footers.
 *
 * IMPORTANT: Icons must be small (24x24 pixels by default) to match Siemens IX icon size.
 * Header/footer icons cannot be full-width banners - use small icons only.
 */
export interface IconConfig {
    name: string;
    type: 'simple' | 'trend' | 'gauge' | 'alert' | 'custom';
    color?: string;
    size?: number;
    customSvg?: string;
}
/**
 * SVG Icon Generator Class
 */
export declare class IconGenerator {
    private iconsPath;
    constructor(projectPath?: string);
    /**
     * Generate a simple icon SVG
     * @param config - Icon configuration
     * @returns Path to generated SVG file
     */
    generateIcon(config: IconConfig): string;
    /**
     * Create a simple geometric icon (circle/square)
     */
    private createSimpleIcon;
    /**
     * Create a trend icon (line chart with upward trend)
     */
    private createTrendIcon;
    /**
     * Create a gauge icon (semicircular meter)
     */
    private createGaugeIcon;
    /**
     * Create an alert icon (warning triangle)
     */
    private createAlertIcon;
    /**
     * Create a custom icon from SVG path data
     */
    private createCustomIcon;
    /**
     * List all available custom icons
     * @returns Array of icon paths
     */
    listCustomIcons(): string[];
    /**
     * Delete a custom icon
     * @param iconName - Icon filename (with or without .svg extension)
     */
    deleteIcon(iconName: string): boolean;
}
//# sourceMappingURL=IconGenerator.d.ts.map
/**
 * Icon List Manager
 *
 * Manages the 1,407 Siemens IX icons available for WinCC OA dashboards.
 * Provides categorization, searching, and filtering capabilities.
 */
export interface IconCategory {
    name: string;
    description: string;
    keywords: string[];
    icons: string[];
}
/**
 * Icon categories with curated icon lists
 */
export declare const ICON_CATEGORIES: IconCategory[];
/**
 * Icon List Manager Class
 */
export declare class IconList {
    private allIcons;
    private iconListPath;
    constructor(projectPath?: string);
    /**
     * Load all icons from IX_ICONS_LIST.txt
     */
    loadIcons(): void;
    /**
     * Search icons by keyword
     * @param keyword - Search term (case-insensitive)
     * @param limit - Maximum number of results
     * @returns Array of matching icon names
     */
    searchIcons(keyword: string, limit?: number): string[];
    /**
     * Get icons for a specific category
     * @param categoryName - Category name
     * @returns Array of icon names in that category
     */
    getCategory(categoryName: string): string[];
    /**
     * Get all available categories
     * @returns Array of category information
     */
    getAllCategories(): IconCategory[];
    /**
     * Check if an icon exists
     * @param iconName - Icon name to check
     * @returns True if icon exists
     */
    iconExists(iconName: string): boolean;
    /**
     * Get total number of icons
     * @returns Total icon count
     */
    getTotalCount(): number;
    /**
     * Search icons by category and keyword
     * @param category - Category name
     * @param keyword - Optional search term
     * @param limit - Maximum results
     * @returns Filtered icon names
     */
    searchByCategory(category: string, keyword?: string, limit?: number): string[];
}
//# sourceMappingURL=IconList.d.ts.map
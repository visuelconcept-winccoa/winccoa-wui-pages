/**
 * Dashboard Widget Schema Types
 *
 * Based on WinCC OA Dashboard Widget Instance JSON Schema
 * Implements the official context-based widget structure
 */
/**
 * I18n name map (language => value)
 */
export interface I18nNameMap {
    [locale: string]: string;
}
/**
 * Widget instance name (plain string or i18n map)
 */
export type WidgetName = string | I18nNameMap;
/**
 * Context types used in widget settings
 */
export type ContextType = 'group' | 'array' | 'data-point' | 'static' | string;
/**
 * Base context interface
 */
export interface BaseContext {
    context: ContextType;
    config: any;
}
/**
 * Group Context - nested configuration structure
 */
export interface GroupContext {
    context: 'group';
    config: {
        [key: string]: BaseContext | string | number | boolean | null;
    };
}
/**
 * Array Context - for arrays of contexts
 */
export interface ArrayContext {
    context: 'array';
    config: Array<GroupContext | GenericContext>;
}
/**
 * DataPoint Context - for datapoint bindings
 */
export interface DataPointContext {
    context: 'data-point';
    config: {
        dataPath: string;
        dataType: string;
        isCnsNode: boolean;
        [key: string]: any;
    };
}
/**
 * Static Context - for static literal values
 */
export interface StaticContext {
    context: 'static';
    config: string | number | boolean | object | any[] | null;
}
/**
 * Generic Context - for custom context types
 */
export interface GenericContext {
    context: string;
    config: any;
}
/**
 * Any context type
 */
export type AnyContext = GroupContext | ArrayContext | DataPointContext | StaticContext | GenericContext;
/**
 * Structured Settings - with config/general/variables
 */
export interface StructuredSettings {
    jsonFileName: string;
    config: GroupContext;
    general?: GroupContext;
    variables?: GroupContext;
}
/**
 * Raw Settings - simple attribute map
 */
export interface RawSettings {
    jsonFileName: string;
    [key: string]: any;
}
/**
 * Widget settings (structured or raw)
 */
export type WidgetSettings = StructuredSettings | RawSettings;
/**
 * Component metadata
 */
export interface ComponentMeta {
    tagname: string;
    scripts: string[];
    styles?: string[];
    jsonSchema?: string | object;
    uiSchema?: string | object;
}
/**
 * Widget permissions
 */
export interface WidgetPermissions {
    canWrite?: boolean;
}
/**
 * Complete Widget Instance (as stored in WinCC OA)
 */
export interface WidgetInstance {
    id: string;
    version: number;
    name: WidgetName;
    x: number;
    y: number;
    rows: number;
    cols: number;
    minCols?: number;
    minRows?: number;
    minItemCols?: number;
    minItemRows?: number;
    rotation?: number;
    permissions?: WidgetPermissions;
    settings: WidgetSettings;
    component: ComponentMeta;
}
/**
 * Helper to check if settings are structured
 */
export declare function isStructuredSettings(settings: WidgetSettings): settings is StructuredSettings;
/**
 * Helper to create an array context
 */
export declare function createArrayContext(items: Array<GroupContext | GenericContext>): ArrayContext;
/**
 * Helper to create a simplified group context (without wrapping static values)
 * The framework will automatically wrap simple values in static contexts
 */
export declare function createSimpleGroupContext(config: Record<string, any>): GroupContext;
//# sourceMappingURL=schema.d.ts.map
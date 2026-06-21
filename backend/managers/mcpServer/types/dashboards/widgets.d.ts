/**
 * Widget Configuration Types
 *
 * Defines configuration interfaces for all supported widget types
 */
import type { LayoutConfig } from './layout.js';
/**
 * Widget types (extensible)
 */
export type WidgetType = 'gauge' | 'label' | 'trend' | 'pie' | 'progressbar' | 'barchart' | string;
/**
 * Range settings for widgets with value ranges
 */
export interface RangeSettings {
    type: 'manual' | 'oa';
    min?: number;
    max?: number;
}
/**
 * Color configuration
 */
export interface ColorConfig {
    color: string;
    useDifferentColors: boolean;
    darkModeColor: string;
}
/**
 * Icon position types
 */
export type IconPosition = 'left' | 'right' | 'top' | 'bottom';
/**
 * Font size types
 */
export type FontSize = 'small' | 'medium' | 'large';
/**
 * Icon size types
 */
export type IconSize = 'small' | 'medium' | 'large';
/**
 * Legend position types
 */
export type LegendPosition = 'topleft' | 'topright' | 'bottomleft' | 'bottomright';
/**
 * Label position types
 */
export type LabelPosition = 'inside' | 'outside';
/**
 * Multilingual text configuration
 */
export interface MultilingualText {
    'en_US.utf8': string;
    'de_AT.utf8'?: string;
}
/**
 * Text alignment types
 */
export type TextAlignment = 'left' | 'center' | 'right';
/**
 * Widget appearance configuration (header, footer, icons, colors)
 * Stored in settings.general.config
 */
export interface WidgetAppearance {
    titleIcon?: string;
    title?: string;
    titleAlignment?: TextAlignment;
    subtitleIcon?: string;
    subtitle?: string;
    subtitleAlignment?: TextAlignment;
    backgroundColor?: string;
    borderColor?: string;
    showFullscreenButton?: boolean;
    linkTitle?: string;
    linkOpenInNewTab?: boolean;
}
/**
 * Base widget configuration (common to all widgets)
 */
export interface BaseWidgetConfig {
    type: WidgetType;
    title: string;
    layout?: LayoutConfig;
    appearance?: WidgetAppearance;
    animation?: boolean;
    font?: string;
    renderer?: 'svg' | 'canvas';
    theme?: string;
    backgroundColor?: string;
}
/**
 * Gauge chart type
 */
export type GaugeChartType = 'classic' | 'metric' | 'circle' | 'arc';
/**
 * Gauge widget configuration
 */
export interface GaugeConfig extends BaseWidgetConfig {
    type: 'gauge';
    dataPoint: string;
    rangeSettings?: RangeSettings;
    color?: string;
    format?: string;
    unit?: string;
    name?: string;
    isRelative?: boolean;
    chartType?: GaugeChartType;
    showTooltip?: boolean;
}
/**
 * Label widget configuration
 */
export interface LabelConfig extends BaseWidgetConfig {
    type: 'label';
    dataPoint: string;
    color?: string;
    icon?: string;
    iconPosition?: IconPosition;
    iconSizeFactor?: IconSize;
    format?: string;
    unit?: string;
    name?: string;
    fontSizeFactor?: FontSize;
    unitFontSizeFactor?: FontSize;
    valuePrefix?: string | null;
    valuePostfix?: string | null;
    fontColor?: ColorConfig;
}
/**
 * Trend series configuration for individual datapoints
 */
export interface TrendSeriesConfig {
    dataPoint: string;
    lineStyle?: 'solid' | 'dashed' | 'dotted';
    showCustomYAxis?: boolean;
    yAxisPosition?: 'left' | 'right';
    showArea?: boolean;
    showConfidenceBand?: boolean;
    color?: string;
    unit?: string;
    format?: string;
    name?: string;
    min?: number;
    max?: number;
}
/**
 * Trend widget configuration
 * Supports single datapoint or multiple datapoints
 */
export interface TrendConfig extends BaseWidgetConfig {
    type: 'trend';
    dataPoint?: string;
    dataPoints?: (string | TrendSeriesConfig)[];
    timeRange?: string;
    rangeSelectorDefault?: string;
    yAxisName?: string;
    yAxisUnit?: string;
    yAxisColor?: string;
    range?: {
        min: number | null;
        max: number | null;
    };
    yAxisRangeSource?: 'auto' | 'manual';
    yAxisMin?: number;
    yAxisMax?: number;
    stacked?: boolean;
    showXAxisGrid?: boolean;
    showYAxisGrid?: boolean;
    showRangePicker?: boolean;
    showTooltip?: boolean;
    zoom?: number;
    legendType?: 'scroll' | 'plain';
    legendOrientation?: 'horizontal' | 'vertical';
    legendVerticalPosition?: 'top' | 'middle' | 'bottom';
    legendHorizontalPosition?: 'left' | 'center' | 'right';
    showLegend?: boolean;
}
/**
 * Pie chart type
 */
export type PieChartType = 'pie' | 'doughnut' | 'doughnutRounded' | 'halfDoughnut';
/**
 * Pie widget configuration
 */
export interface PieConfig extends BaseWidgetConfig {
    type: 'pie';
    dataPoints: string[];
    dataPointsDescriptions: string[];
    chartType?: PieChartType;
    labelsShow?: boolean;
    labelsPosition?: LabelPosition;
    labelsDetails?: 'both' | 'value' | 'percentage';
    labelLineLength?: number;
    legendPosition?: LegendPosition;
    showTooltip?: boolean;
    colors?: string[];
    darkModeColors?: string[];
}
/**
 * Progress bar size types
 */
export type ProgressBarSize = '1.5em' | '2.25em' | '3em';
/**
 * Alert range for progress bar
 */
export interface AlertRange {
    min: number;
    max: number;
    color: string;
}
/**
 * Progress bar widget configuration
 */
export interface ProgressBarConfig extends BaseWidgetConfig {
    type: 'progressbar';
    dataPoint: string;
    color?: string;
    size?: ProgressBarSize;
    unit?: string;
    format?: string;
    min?: number;
    max?: number;
    showRange?: boolean;
    isAbsolute?: boolean;
    alertRanges?: AlertRange[];
}
/**
 * Bar chart widget configuration
 */
export interface BarChartConfig extends BaseWidgetConfig {
    type: 'barchart';
    dataPoints: string[];
    yAxisName?: string;
    yAxisUnit?: string;
    yAxisColor?: string;
    range?: {
        min: number | null;
        max: number | null;
    };
    isStacked?: boolean;
    isHorizontal?: boolean;
    showTooltip?: boolean;
    showLegend?: boolean;
    legendPosition?: LegendPosition;
}
/**
 * Union of all widget configurations
 */
export type WidgetConfig = GaugeConfig | LabelConfig | TrendConfig | PieConfig | ProgressBarConfig | BarChartConfig;
/**
 * Type guard for Gauge config
 */
export declare function isGaugeConfig(config: WidgetConfig): config is GaugeConfig;
/**
 * Type guard for Label config
 */
export declare function isLabelConfig(config: WidgetConfig): config is LabelConfig;
/**
 * Type guard for Trend config
 */
export declare function isTrendConfig(config: WidgetConfig): config is TrendConfig;
/**
 * Type guard for Pie config
 */
export declare function isPieConfig(config: WidgetConfig): config is PieConfig;
/**
 * Type guard for ProgressBar config
 */
export declare function isProgressBarConfig(config: WidgetConfig): config is ProgressBarConfig;
/**
 * Type guard for BarChart config
 */
export declare function isBarChartConfig(config: WidgetConfig): config is BarChartConfig;
/**
 * Validate trend config has either dataPoint or dataPoints
 */
export declare function validateTrendConfig(config: TrendConfig): boolean;
/**
 * Validate pie config has matching dataPoints and descriptions
 */
export declare function validatePieConfig(config: PieConfig): boolean;
/**
 * Validate bar chart config has dataPoints
 */
export declare function validateBarChartConfig(config: BarChartConfig): boolean;
//# sourceMappingURL=widgets.d.ts.map
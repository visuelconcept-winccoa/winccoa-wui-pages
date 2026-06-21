/**
 * Widget Configuration Types
 *
 * Defines configuration interfaces for all supported widget types
 */
/**
 * Type guard for Gauge config
 */
export function isGaugeConfig(config) {
    return config.type === 'gauge';
}
/**
 * Type guard for Label config
 */
export function isLabelConfig(config) {
    return config.type === 'label';
}
/**
 * Type guard for Trend config
 */
export function isTrendConfig(config) {
    return config.type === 'trend';
}
/**
 * Type guard for Pie config
 */
export function isPieConfig(config) {
    return config.type === 'pie';
}
/**
 * Type guard for ProgressBar config
 */
export function isProgressBarConfig(config) {
    return config.type === 'progressbar';
}
/**
 * Type guard for BarChart config
 */
export function isBarChartConfig(config) {
    return config.type === 'barchart';
}
/**
 * Validate trend config has either dataPoint or dataPoints
 */
export function validateTrendConfig(config) {
    return !!(config.dataPoint || (config.dataPoints && config.dataPoints.length > 0));
}
/**
 * Validate pie config has matching dataPoints and descriptions
 */
export function validatePieConfig(config) {
    return (config.dataPoints.length > 0 &&
        config.dataPoints.length === config.dataPointsDescriptions.length);
}
/**
 * Validate bar chart config has dataPoints
 */
export function validateBarChartConfig(config) {
    return config.dataPoints.length > 0;
}
//# sourceMappingURL=widgets.js.map
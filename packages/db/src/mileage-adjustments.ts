// Public entry point. Implementation is organized by responsibility.
export { MileageAdjustmentError, parseAdjustmentMetadata, adjustmentResult, buildAdjustmentFingerprint, findCommittedMileageAdjustment, adjustmentLotSpendOrderSql, readLotConsumed, recordLotConsumed, lotRepairLiveExcessGateSql, repairAdjustmentLotShortfall, tryParseMetadata } from './mileage-adjustments-lots.js';
export { postMileageAdjustment } from './mileage-adjustments-post.js';

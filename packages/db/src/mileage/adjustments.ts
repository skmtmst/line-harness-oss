// Public entry point. Implementation is organized by responsibility.
export { MileageAdjustmentError, parseAdjustmentMetadata, adjustmentResult, buildAdjustmentFingerprint, findCommittedMileageAdjustment, adjustmentLotSpendOrderSql, readLotConsumed, recordLotConsumed, lotRepairLiveExcessGateSql, repairAdjustmentLotShortfall, tryParseMetadata } from './adjustments-lots.js';
export { postMileageAdjustment } from './adjustments-post.js';

// Compatibility entry for existing consumers; implementation lives with its feature.
export { approveMileageAdjustmentRequest, cancelMileageAdjustmentRequest, confirmPendingMileageEntry, createMileageAdjustmentApprovalRequest, getMileageAdjustmentApprovalRequest, listMileageAdjustmentApprovalRequests, rejectMileageAdjustmentRequest, testMileageEarningRuleDraft, voidMileageLedgerEntry } from './mileage/approvals.js';
export type { MileageAdjustmentRequestRow, MileageRuleTestResult } from './mileage/approvals.js';

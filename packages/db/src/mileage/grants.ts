// Public entry point. Implementation is organized by responsibility.
export { resolveReferralMileageBeneficiary, mileageGrantExpiresAt, getMileageAvailableBalance, renderMileageGrantNotification, reserveMileageGrantNotification, reverseMileageGrantsForCancellation } from './grants-beneficiaries.js';
export { applyMileageRulesImmediately, applyMileageRulesForEvent } from './grants-apply.js';

// Public operations. Internal modules import their dependencies directly.
export { simulateAttribution, simulationResults } from './ec-auto-line-attribution.js';
export { autoKinds, autoLineRules, ingestBehavior, processAutoLineMock } from './ec-auto-line.js';
export { syncMemberSnapshot } from './member-snapshot.js';
export type { EcEvent, EcItem } from './member-snapshot.js';
export { ecFlexMessage } from './ec-notification-message.js';
export { markEcEventFailed, processEcEvent } from './ec-event-processing.js';

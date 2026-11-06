/** Staging-only QA preparation. Synthetic identities never grant platform administration. */
export type StagingQaRole = 'hq' | 'store' | 'viewer' | 'impersonation';
export type StagingQaJob = 'booking_waitlists' | 'restaurant_holds' | 'restaurant_menu_prices';
export type StagingQaRun = {
  id: string;
  tenantId: string;
  accountId: string;
  organizationId: string;
  storeId: string;
  status: 'active' | 'archived';
  users: Array<{ id: string; role: StagingQaRole; email: string }>;
  friendIds: string[];
};
export type StagingQaSafety = {
  environment: 'staging';
  outboundStopped: true;
  simulatedLineOnly: true;
  jobs: StagingQaJob[];
};
export type StagingQaSession = {
  id: string;
  role: StagingQaRole;
  tenantId: string;
  /** Only the existing operator session can enter impersonation, always in read mode. */
  mode?: 'read';
};
export type StagingQaCronReceipt = {
  job: StagingQaJob;
  status: 'running' | 'failed';
} | {
  job: StagingQaJob;
  status: 'completed';
  accountId: string;
  outboundStopped: true;
  completedAt: string;
};

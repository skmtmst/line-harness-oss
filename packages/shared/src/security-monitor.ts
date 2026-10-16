export type SecurityAlert = {
  id: string;
  ruleKey: string;
  summary: string;
  count: number;
  threshold: number;
  status: 'open' | 'acknowledged' | 'resolved';
  version: number;
  firstDetectedAt: string;
  lastDetectedAt: string;
  reviewedAt: string | null;
  notification: 'sent' | 'unconfigured' | 'pending';
  /** Present only in the platform console; never included in Slack messages. */
  scope?: { tenantId: string; lineAccountId: string | null };
};

export type SecurityMonitorStatus = {
  status: 'unknown' | 'failed' | 'stale' | 'running';
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  configurationValid: boolean;
};

export type SecurityAlertsResponse = {
  success: true;
  data: {
    items: SecurityAlert[];
    monitor: SecurityMonitorStatus;
    thresholds: Record<string, number>;
    configurationValid: boolean;
    windowMinutes: number;
    limit: number;
    offset: number;
    total: number;
  };
};

export type SecurityAlertReviewResponse = {
  success: true;
  data: { id: string; status: 'acknowledged' | 'resolved'; version: number };
};

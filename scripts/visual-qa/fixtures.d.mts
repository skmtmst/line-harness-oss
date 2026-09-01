type Metric = {
  value: number | null;
  state: 'available' | 'unavailable';
};

type WebinarOverview = {
  metrics: Record<string, Metric>;
};

type WebinarAudience = {
  people: number;
  bookings: number;
  definition: string;
};

type WebinarNotificationSettings = {
  overview: {
    audience: WebinarAudience;
  };
};

type WebinarActionSettings = {
  settings: Array<{
    trigger: string;
    version: number;
    action: unknown;
  }>;
  triggerDefinitions: Array<{
    trigger: string;
    availability: string;
  }>;
  availableActions: unknown[];
};

type Failure = {
  success: false;
  error: string;
};

export const WEBINAR_ACTION_SETTINGS: WebinarActionSettings;
export const WEBINAR_ACTION_SETTINGS_EMPTY: WebinarActionSettings;
export const WEBINAR_ACTION_SETTINGS_FAILURE: Failure;
export const WEBINAR_NOTIFICATION_SETTINGS: WebinarNotificationSettings;
export const WEBINAR_NOTIFICATION_SETTINGS_EMPTY: WebinarNotificationSettings;
export const WEBINAR_NOTIFICATION_SETTINGS_FAILURE: Failure;
export const WEBINAR_OVERVIEW: WebinarOverview;
export const WEBINAR_OVERVIEW_EMPTY: WebinarOverview;
export const WEBINAR_OVERVIEW_FAILURE: Failure;
export const WEBINARS: Array<{
  id: string;
  accountId: string;
  status: string;
  durationSeconds: number;
  schedule: unknown[];
}>;

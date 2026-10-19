import type {
  AccountStyle,
  IndustryStyle,
  SetupAnswer,
  StyleCard,
  StyleRange,
} from '@line-crm/shared';

export const root = '/api/dashboard/style';

export const url = (
  path: string,
  accountId: string,
  query: Record<string, string | undefined> = {},
) =>
  `${path}?${new URLSearchParams({ account_id: accountId, ...Object.fromEntries(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined)) })}`;

export const write = (method: string, body: unknown) => ({
  method,
  body: JSON.stringify(body),
});

export type Result<T> = { success: true; data: T };

export type StyleQuery = {
  style: IndustryStyle;
  range?: StyleRange;
  view?: StyleRange | 'date';
  date?: string;
  from?: string;
  to?: string;
  staff_id?: string;
  store_id?: string;
  menu_id?: string;
  holidays?: 'all' | 'exclude' | 'only';
  compare?: 'previous' | 'last_year' | 'last_week';
  selection?:
    | 'bookings'
    | 'visits'
    | 'no_show'
    | 'recall'
    | 'result_pending'
    | 'inactive_members';
};

export type StyleSelection = {
  expectedVersion: number;
  style?: AccountStyle;
  styleMode?: SetupAnswer['mode'];
  answers?: Record<string, SetupAnswer>;
  settings?: Record<string, number>;
  choices?: Record<
    string,
    { mode: 'sample' | 'existing' | 'configured'; resourceId?: string }
  >;
};

export type StarterSetItem = {
  key: string;
  kind:
    | 'template'
    | 'rich_menu'
    | 'automation'
    | 'reminder'
    | 'booking_menu'
    | 'dashboard';
  name: string;
  feature?: string;
  text?: string;
  durationMinutes?: number;
  price?: number;
  buttons?: Array<{ label: string; feature: string; actionType?: 'uri' | 'message'; actionData?: string }>;
  cards?: StyleCard[];
  offsetMinutes?: number;
  offsetDays?: number;
  sendAtTime?: string;
  triggerType?: 'calendar_booked' | 'restaurant.departed';
};

export type StyleBookingDetails = {
  id: string;
  staffId: string;
  version: number;
  meetingMode: 'online' | 'in_person' | null;
  meetingUrl: string | null;
  location: string | null;
  outcome: 'considering' | 'won' | 'lost' | null;
  outcomeRecordedAt: string | null;
  outcomeRecordedBy: string | null;
  cancellationReason: string | null;
  designation: 'designated' | 'any' | 'unspecified';
  entryPoint: string | null;
};

export type StyleClassDetails = {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  classroom_capacity: number | null;
  online_capacity: number | null;
  instructor_id: string | null;
  version: number;
  is_trial: number;
};

export type StyleMember = {
  id: string;
  line_account_id: string;
  friend_id: string;
  plan_name: string | null;
  joined_at: string;
  ended_at: string | null;
  withdrawal_reason: string | null;
  expires_at: string | null;
  remaining_uses: number | null;
  updated_by: string | null;
  version: number;
  updated_at: string;
};

export type StyleStarterSet = {
  id: string;
  style: AccountStyle;
  name: string;
  version: number;
  definition: { items: StarterSetItem[] };
  accountCount: number;
  updatedAt: string;
  updatedBy: string | null;
  autoInsert: boolean;
  updatedByName: string | null;
};

export type StarterDistributionTarget =
  | { style: AccountStyle; accountIds?: never }
  | { accountIds: string[]; style?: never };
export type StarterDistributionInput = {
  expectedVersion: number;
  target: StarterDistributionTarget;
};
export type StarterDistributionPreview = {
  token: string;
  accountCount: number;
  editedCount: number;
  accounts: Array<{
    accountId: string;
    editedCount: number;
    items: Array<{
      key: string;
      name: string;
      kind: string;
      edited: boolean;
      action: string;
    }>;
  }>;
};
export type StyleSampleMetadata = {
  isSample: boolean;
  sampleKey: string | null;
  starterSetId: string | null;
  starterSetVersion: number | null;
};

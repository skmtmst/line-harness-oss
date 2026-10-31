import type {
  AccountStyle,
  IndustryStyle,
  SetupAnswer,
  StyleCard,
  StyleRange,
  StarterCatalogSelection,
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
    | 'dashboard'
    | 'friend_add_rule'
    | 'tag_set'
    | 'scenario';
  name: string;
  /** friend_add_rule が送るごあいさつ。同じ組の template の key。 */
  templateKey?: string;
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
  /** tag_set の見本のタグの名前。入れた時点では本物のタグは作られない。 */
  tags?: Array<{ name: string }>;
  /** scenario の通数。delayMinutes は前の通（1 通目はシナリオの始まり）からの分。 */
  steps?: Array<{ delayMinutes: number; text: string }>;
};

/** 入れなかった理由。Worker が決まった値だけを返す。 */
export type StarterSkipReason = 'answer_later' | 'not_for_style' | 'auto_insert_off' | 'already_exists';

/** 初期セットの入れ直しの結果。2 回目からは inserted が空。 */
export type StarterEnsureResult = {
  catalogApplication?: import('@line-crm/shared').StarterCatalogApplyResult;
  inserted: Array<{ key: string; kind: StarterSetItem['kind'] | import('@line-crm/shared').StarterCatalogKind }>;
  skipped: Array<{ key: string; reason: StarterSkipReason }>;
  existing: number;
  starterSet: { id: string; version: number };
};

/** musubo の標準の初期セット。統括の組とは別に読む。 */
export type StyleStarterDefault = {
  style: AccountStyle;
  id: string;
  version: number;
  definition: { items: StarterSetItem[]; mode?: 'catalog'; selections?: StarterCatalogSelection[] };
};

/** 統括の組を標準へ戻す口の返事。自分の組が無い時は reset が false で何も変わらない。 */
export type StyleStarterResetResult =
  | { id: string; version: number; reset: true; previousId: string; autoInsert: boolean }
  | { id: null; version: 0; reset: false; previousId: null };

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
  definition: { items: StarterSetItem[]; mode?: 'catalog'; selections?: StarterCatalogSelection[] };
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

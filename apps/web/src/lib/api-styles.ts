import type {
  AccountStyle,
  IndustryStyle,
  SetupAnswer,
  StyleCard,
  StyleSnapshot,
} from '@line-crm/shared';
import { fetchApi, bookingApi } from './api';
import { restaurantTestApi } from './restaurant-test-api';
const root = '/api/dashboard/style';
const url = (
  path: string,
  accountId: string,
  query: Record<string, string | undefined> = {},
) =>
  `${path}?${new URLSearchParams({ account_id: accountId, ...Object.fromEntries(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined)) })}`;
const write = (method: string, body: unknown) => ({
  method,
  body: JSON.stringify(body),
});
type Result<T> = { success: true; data: T };
export type StyleQuery = {
  style: IndustryStyle;
  view?: 'today' | 'tomorrow' | 'future' | 'date';
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
  answers?: Record<string, SetupAnswer>;
  settings?: Record<string, number>;
  choices?: Record<
    string,
    { mode: 'sample' | 'existing' | 'configured'; resourceId?: string }
  >;
};
export type StarterSetItem = {
  key: string;
  kind: 'template' | 'rich_menu' | 'automation' | 'booking_menu' | 'dashboard';
  name: string;
  feature?: string;
  text?: string;
  durationMinutes?: number;
  price?: number;
  buttons?: Array<{ label: string; feature: string }>;
  cards?: StyleCard[];
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
};
export const styleApi = {
  get: (accountId: string) =>
    fetchApi<
      Result<{
        style: AccountStyle;
        styleSelected: boolean;
        version: number;
        answers: Record<string, SetupAnswer>;
        settings: Record<string, number>;
        cards: StyleCard[];
        questions: Array<{
          key: string;
          changeAt: string;
          canChangeLater: boolean;
          recommended: string | boolean;
          modes: Array<SetupAnswer['mode']>;
        }>;
      }>
    >(url(root, accountId)),
  save: (accountId: string, body: StyleSelection) =>
    fetchApi<
      Result<{
        style: AccountStyle;
        version: number;
        inserted: Array<{
          key: string;
          kind: string;
          id: string;
          isSample: boolean;
          requiresActivation: boolean;
        }>;
      }>
    >(url(root, accountId), write('PUT', body)),
  warnings: (accountId: string) =>
    fetchApi<
      Result<{
        count: number;
        items: Array<{
          feature: string;
          areaId: string;
          groupId: string;
          href: string;
          customerState: 'preparing';
        }>;
        pending: Array<{ key: string; href: string; mode: string }>;
        manual: Array<{ key: string; href: string }>;
      }>
    >(url(root + '/warnings', accountId)),
  starterSet: (accountId: string, style: AccountStyle) =>
    fetchApi<
      Result<{
        id: string;
        version: number;
        definition: { items: StarterSetItem[] };
      }>
    >(url(root + '/starter-set', accountId, { style })),
  starterItems: (accountId: string) =>
    fetchApi<
      Result<{
        items: Array<{
          target_id: string;
          kind: string;
          is_sample: number;
          status: string | null;
          draftRevision: string | null;
        }>;
      }>
    >(url(root + '/starter-items', accountId)),
  activate: (
    accountId: string,
    items: Array<{
      id: string;
      kind: 'automation' | 'booking_menu';
      expectedDraftVersionId?: string;
      expectedVersion?: number;
    }>,
  ) =>
    fetchApi<
      Result<{
        complete: boolean;
        items: Array<{
          id: string;
          success: boolean;
          status?: string;
          code?: string;
        }>;
      }>
    >(
      url(root + '/activate', accountId),
      write('POST', { confirmed: true, items }),
    ),
  resources: (accountId: string) =>
    fetchApi<
      Result<{ items: Array<{ id: string; name: string; kind: string }> }>
    >(url(root + '/resources', accountId)),
  summary: (accountId: string, query: StyleQuery) =>
    fetchApi<Result<StyleSnapshot>>(url(root + '/summary', accountId, query)),
  analytics: (accountId: string, query: StyleQuery) =>
    fetchApi<Result<StyleSnapshot & { analytics: Record<string, unknown> }>>(
      url(root + '/analytics', accountId, query),
    ),
  bookings: (accountId: string, query: StyleQuery) =>
    fetchApi<Result<StyleSnapshot>>(url(root + '/bookings', accountId, query)),
  people: (accountId: string, query: StyleQuery) =>
    fetchApi<
      Result<
        StyleSnapshot & {
          people: Array<{
            personKey: string;
            friendId: string | null;
            name: string;
            visits: number;
            lastVisit: string;
            intervalDays: number | null;
            nextBooking: string | null;
            recall: boolean;
          }>;
        }
      >
    >(url(root + '/people', accountId, query)),
  createAudience: (accountId: string, resultId: string, friendIds?: string[]) =>
    fetchApi<
      Result<{
        id: string;
        memberCount: number;
        unreachableCount: number;
        expiresAt: string;
      }>
    >(
      url(
        `/api/analytics/results/${encodeURIComponent(resultId)}/audiences`,
        accountId,
      ),
      write('POST', { sourceKind: 'booking', friendIds }),
    ),
  saveCards: (accountId: string, expectedVersion: number, cards: StyleCard[]) =>
    fetchApi<Result<{ cards: StyleCard[]; version: number }>>(
      url(root + '/cards', accountId),
      write('PUT', { expectedVersion, cards }),
    ),
  resetCards: (accountId: string, expectedVersion: number) =>
    fetchApi<Result<{ cards: StyleCard[]; version: number }>>(
      url(root + '/cards', accountId),
      write('DELETE', { expectedVersion }),
    ),
  menu: (accountId: string, id: string) =>
    fetchApi<
      Result<{
        id: string;
        name: string;
        version: number;
        meetingMode: string;
        location: string | null;
      }>
    >(url(root + '/menus/' + encodeURIComponent(id), accountId)),
  booking: (accountId: string, id: string) =>
    fetchApi<Result<StyleBookingDetails>>(
      url(root + '/bookings/' + encodeURIComponent(id), accountId),
    ),
  class: (accountId: string, id: string) =>
    fetchApi<Result<StyleClassDetails>>(
      url(root + '/classes/' + encodeURIComponent(id), accountId),
    ),
  saveRestaurantStaff: (
    accountId: string,
    id: string,
    expectedVersion: number,
    staffId: string | null,
  ) =>
    fetchApi(
      url(
        root + '/restaurant-reservations/' + encodeURIComponent(id),
        accountId,
      ),
      write('PATCH', { expectedVersion, staffId }),
    ),
  saveMenu: (
    accountId: string,
    id: string,
    body: {
      expectedVersion: number;
      meetingMode: 'online' | 'in_person' | 'customer_choice';
      location?: string | null;
    },
  ) =>
    fetchApi<Result<{ version: number }>>(
      url(root + '/menus/' + encodeURIComponent(id), accountId),
      write('PATCH', body),
    ),
  saveBooking: (
    accountId: string,
    id: string,
    body: {
      expectedVersion: number;
      meetingMode?: 'online' | 'in_person' | null;
      meetingUrl?: string | null;
      location?: string | null;
      outcome?: 'considering' | 'won' | 'lost' | null;
      cancellationReason?: string | null;
      designation?: 'designated' | 'any' | 'unspecified';
      entryPoint?: string | null;
    },
  ) =>
    fetchApi<Result<{ id: string; version: number }>>(
      url(root + '/bookings/' + encodeURIComponent(id), accountId),
      write('PATCH', body),
    ),
  registerMeet: (body: {
    externalEventId: string;
    friendId: string;
    title: string;
    startsAt: string;
    endsAt: string;
    meetUrl: string;
    bookingId?: string;
    bookingVersion?: number;
  }) =>
    fetchApi<
      Result<{
        id: string;
        reminders: Array<{
          kind: 'day_before' | 'hour_before';
          scheduledAt: string;
        }>;
      }>
    >('/api/meet-consultations', write('POST', body)),
  cancelMeet: (externalEventId: string) =>
    fetchApi('/api/meet-consultations/' + encodeURIComponent(externalEventId), {
      method: 'DELETE',
    }),
  saveMeetResult: (
    accountId: string,
    id: string,
    body: {
      expectedUpdatedAt: string;
      staffId?: string | null;
      attendance?: 'visited' | 'late' | 'no_show' | null;
      outcome?: 'considering' | 'won' | 'lost' | null;
    },
  ) =>
    fetchApi<Result<{ id: string; updatedAt: string }>>(
      url(root + '/meet/' + encodeURIComponent(id), accountId),
      write('PATCH', body),
    ),
  saveClass: (
    accountId: string,
    id: string,
    body: {
      expectedVersion: number;
      classroomCapacity?: number | null;
      onlineCapacity?: number | null;
      instructorId?: string | null;
    },
  ) =>
    fetchApi<Result<{ id: string; version: number }>>(
      url(root + '/classes/' + encodeURIComponent(id), accountId),
      write('PATCH', body),
    ),
  saveTrial: (
    accountId: string,
    id: string,
    expectedVersion: number,
    isTrial: boolean,
  ) =>
    fetchApi(
      url(root + '/events/' + encodeURIComponent(id), accountId),
      write('PATCH', { expectedVersion, isTrial }),
    ),
  saveParticipation: (
    accountId: string,
    id: string,
    participationMode: 'classroom' | 'online',
  ) =>
    fetchApi(
      url(root + '/event-bookings/' + encodeURIComponent(id), accountId),
      write('PATCH', { participationMode }),
    ),
  saveWaitlistParticipation: (
    accountId: string,
    id: string,
    expectedVersion: number,
    participationMode: 'classroom' | 'online',
  ) =>
    fetchApi(
      url(root + '/event-waitlist/' + encodeURIComponent(id), accountId),
      write('PATCH', { expectedVersion, participationMode }),
    ),
  members: (accountId: string) =>
    fetchApi<Result<StyleMember[]>>(url(root + '/members', accountId)),
  saveMember: (
    accountId: string,
    friendId: string,
    body: {
      expectedVersion: number;
      joinedAt: string;
      endedAt?: string | null;
      withdrawalReason?: string | null;
      expiresAt?: string | null;
      planName?: string | null;
      remainingUses?: number | null;
    },
  ) =>
    fetchApi<Result<{ version: number }>>(
      url(root + '/members/' + encodeURIComponent(friendId), accountId),
      write('PUT', body),
    ),
  saveHoliday: (accountId: string, date: string, name: string) =>
    fetchApi(
      url(root + '/holidays/' + encodeURIComponent(date), accountId),
      write('PUT', { name }),
    ),
  saveTarget: (
    accountId: string,
    metric: 'bookings' | 'visits' | 'estimatedRevenue' | 'conversionRate',
    period: string,
    value: number,
  ) =>
    fetchApi(
      url(root + '/targets', accountId),
      write('PUT', { metric, period, value }),
    ),
  analyticsSettings: (accountId: string) =>
    fetchApi<
      Result<{
        holidays: Array<{ date: string; name: string }>;
        targets: Array<{ metric: string; period: string; value: number }>;
        pageViews: number;
      }>
    >(url(root + '/analytics-settings', accountId)),
  closeHours: (
    accountId: string,
    body: {
      date: string;
      target: 'store' | 'staff';
      staffId?: string;
      allDay: boolean;
      startTime?: string;
      endTime?: string;
      reason?: string;
    },
  ) => fetchApi(url(root + '/closures', accountId), write('POST', body)),
  // Existing restaurant closures include preview, table selection and affected reservations.
  closeRestaurant: restaurantTestApi.createClosure,
  previewRestaurantClosure: restaurantTestApi.previewClosure,
  existingExceptions: bookingApi.listExceptions,
  readiness: (liffId: string, idToken: string, feature: string) =>
    fetchApi<
      Result<{
        feature: string;
        ready: boolean;
        state: 'ready' | 'preparing';
        message: string | null;
        href: string;
      }>
    >(
      `/api/liff/booking/style-readiness?${new URLSearchParams({ liffId, feature })}`,
      { headers: { Authorization: `Bearer ${idToken}` } },
    ),
  recordPageView: (
    liffId: string,
    idToken: string,
    body: { menuId?: string; entryPoint?: string },
  ) =>
    fetchApi(
      `/api/liff/booking/page-views?liffId=${encodeURIComponent(liffId)}`,
      {
        ...write('POST', body),
        headers: { Authorization: `Bearer ${idToken}` },
      },
    ),
};
export const hqStyleApi = {
  listStarterSets: () =>
    fetchApi<Result<StyleStarterSet[]>>('/api/hq/style-starter-sets'),
  saveStarterSet: (
    style: AccountStyle,
    body: {
      expectedVersion: number;
      name: string;
      definition: { items: StarterSetItem[] };
    },
  ) =>
    fetchApi<Result<{ id: string; version: number }>>(
      '/api/hq/style-starter-sets/' + encodeURIComponent(style),
      write('PUT', body),
    ),
  attention: () =>
    fetchApi<
      Result<{
        asOf: string;
        items: Array<{
          accountId: string;
          name: string;
          counts: Record<string, number>;
          details: Record<string, Array<{ id: string; href: string }>>;
        }>;
      }>
    >('/api/hq/style-attention'),
};

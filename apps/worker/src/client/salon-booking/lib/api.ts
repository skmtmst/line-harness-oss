// Salon booking API client. Uses caller context provided by main.ts.

import type { SalonBookingContext } from './context.js';

export interface MenuItem {
  id: string;
  location_id: string | null;
  menu_id: string | null;
  name: string;
  category_label: string | null;
  description: string | null;
  duration_minutes: number;
  buffer_after_minutes: number;
  base_price: number;
  sort_order: number;
}

export interface LocationItem {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  access: string | null;
}

export interface StaffItem {
  id: string;
  display_name: string;
  role: string | null;
  profile_image_url: string | null;
  bio: string | null;
  is_designation_optional: number;
  price: number;
  duration_minutes: number;
}

export interface AvailabilityResponse {
  by_staff: Array<{
    staff_id: string;
    display_name: string;
    slots: Array<{ date: string; start: string; end: string }>;
  }>;
}

export interface BookingHistoryItem {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  customer_note?: string | null;
  customer_name: string | null;
  customer_kana: string | null;
  customer_phone: string | null;
  price_at_booking: number;
  consent_title: string | null;
  consent_body: string | null;
  consent_version: number | null;
  consent_agreed_at: string | null;
  menu_name: string;
  staff_name: string;
  location_name: string | null;
  profile_image_url: string | null;
}

export interface ConsentSetting {
  title: string;
  body: string;
  version: number;
  is_required: number;
  is_active: number;
}

function authHeaders(ctx: SalonBookingContext, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${ctx.idToken}`, ...extra };
}

function withLiff(path: string, ctx: SalonBookingContext): string {
  const u = new URL(path, window.location.origin);
  u.searchParams.set('liffId', ctx.liffId);
  return u.pathname + u.search;
}

async function get<T>(path: string, ctx: SalonBookingContext): Promise<T> {
  const res = await fetch(withLiff(path, ctx), { headers: authHeaders(ctx) });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function post<T>(
  path: string,
  body: unknown,
  ctx: SalonBookingContext,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(withLiff(path, ctx), {
    method: 'POST',
    headers: authHeaders(ctx, { 'Content-Type': 'application/json', ...headers }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* keep raw */ }
    const err = new Error(`API ${res.status}`) as Error & { status: number; body: unknown };
    err.status = res.status;
    err.body = parsed ?? text;
    throw err;
  }
  return res.json();
}

export function createApi(ctx: SalonBookingContext) {
  return {
    locations: () =>
      get<{ locations: LocationItem[] }>('/api/liff/booking/locations', ctx),
    menus: () => get<{ menus: MenuItem[] }>('/api/liff/booking/menus', ctx),
    staffOf: (menuId: string) =>
      get<{ staff: StaffItem[] }>(`/api/liff/booking/menus/${menuId}/staff`, ctx),
    availability: (
      locationId: string,
      menuId: string,
      staffId: string | undefined,
      from: string,
      to: string,
    ) => {
      const qs = new URLSearchParams({ location_id: locationId, menu_id: menuId, from, to });
      if (staffId) qs.set('staff_id', staffId);
      return get<AvailabilityResponse>(`/api/liff/booking/availability?${qs}`, ctx);
    },
    createRequest: (
      body: {
        location_id: string;
        menu_id: string;
        staff_id: string;
        starts_at: string;
        customer_name: string;
        customer_kana: string;
        customer_phone: string;
        customer_note?: string;
        consent_agreed: boolean;
        consent_version: number;
      },
      idempotencyKey: string,
    ) =>
      post<{ booking_id: string; status: string }>(
        '/api/liff/booking/requests',
        body,
        ctx,
        { 'Idempotency-Key': idempotencyKey },
      ),
    me: () =>
      get<{ upcoming: BookingHistoryItem[]; past: BookingHistoryItem[] }>(
        '/api/liff/booking/me',
        ctx,
      ),
    consent: () =>
      get<{ consent: ConsentSetting }>('/api/liff/booking/consent', ctx),
    cancel: (bookingId: string) =>
      post<{ status: string }>(`/api/liff/booking/me/${bookingId}/cancel`, {}, ctx),
  };
}

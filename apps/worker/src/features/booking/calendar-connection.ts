import { GoogleCalendarClient } from '../../services/google-calendar.js';
import { getGoogleServiceAccountToken, type GoogleServiceAccountCredentials } from '../../services/google-service-account.js';
import { BookingExternalCircuits } from './booking-external-circuits.js';
export interface StaffCalendarConnection {
  id: string;
  calendar_id: string;
  auth_type: string;
  access_token: string | null;
}


/**
 * 消す対象の予定があるのに、削除できる接続が無い (解除ずみ・無効化)。
 * 「消す物が無い」とは別物として扱い、台帳を成功にせず回復待ちに残す。
 */
export class CalendarConnectionMissingError extends Error {
  constructor() {
    super('calendar_connection_missing');
    this.name = 'calendar_connection_missing';
  }
}


export async function getStaffCalendarConnection(
  db: D1Database,
  lineAccountId: string,
  staffId: string,
): Promise<StaffCalendarConnection | null> {
  return db
    .prepare(
      `SELECT id, calendar_id, auth_type, access_token
         FROM google_calendar_connections
        WHERE line_account_id = ? AND staff_id = ? AND is_active = 1
        LIMIT 1`,
    )
    .bind(lineAccountId, staffId)
    .first<StaffCalendarConnection>();
}


export async function clientForConnection(
  connection: StaffCalendarConnection,
  credentials: GoogleServiceAccountCredentials,
  execution?:{db:D1Database;accountId:string},
): Promise<GoogleCalendarClient> {
  const accessToken = connection.auth_type === 'service_account'
    ? await getGoogleServiceAccountToken(credentials)
    : connection.access_token;
  if (!accessToken) throw new Error('google_calendar_access_token_missing');
  return new GoogleCalendarClient({ calendarId: connection.calendar_id, accessToken,
    ...(execution?{external:{circuits:new BookingExternalCircuits(execution.db),scope:{accountId:execution.accountId,storeId:execution.accountId,destination:'google_calendar',connectionId:connection.id}}}:{}) });
}


export async function verifyStaffCalendarConnection(
  connection: StaffCalendarConnection,
  credentials: GoogleServiceAccountCredentials,
  execution?: {db:D1Database;accountId:string},
): Promise<void> {
  const client = await clientForConnection(connection, credentials, execution);
  const now = new Date();
  await client.getFreeBusy(now.toISOString(), new Date(now.getTime() + 60_000).toISOString());
}

import { logger } from '@line-crm/shared/server';
import type { Env } from '../../worker-env.js';
import type { Hono } from 'hono';
import { inputError, inputJsonBoundary } from '../../lib/input-errors.js';
import { createBookingCustomer, getBookingCustomer, searchBookingCustomers } from '@line-crm/db';
import { requireRole } from '../../middleware/role-guard.js';
import { completeIdempotencyResponse, findIdempotencyResponse, reserveIdempotencyResponse } from '../../features/booking/booking-idempotency/index.js';
import { BOOKING_CUSTOMER_IDEMPOTENCY_TTL_MINUTES } from '../../features/booking/booking-types/index.js';
import { resolveAccountIdAdmin } from './identity.js';

export function registerCustomers(booking: Hono<Env>): void {
// ================================================================
// Admin endpoints (/api/booking/admin/*)
// authMiddleware enforces staff/owner auth at index.ts level.
// All endpoints require ?account_id= query.
// ================================================================

// ---- Booking customers (LINE未連携の電話客) ----

booking.get('/api/booking/admin/customers', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  try {
    const customers = await searchBookingCustomers(c.env.DB, {
      lineAccountId: accountId,
      query: c.req.query('q'),
      encryptionKey: c.env.LINE_CREDENTIAL_ENCRYPTION_KEY,
    });
    return c.json({ customers });
  } catch (error) {
    logger.error("routes_booking_failed");
    return c.json({ error: 'customer_data_unavailable' }, 503);
  }
});

booking.get('/api/booking/admin/customers/:id', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  try {
    const customer = await getBookingCustomer(
      c.env.DB,
      c.req.param('id'),
      accountId,
      c.env.LINE_CREDENTIAL_ENCRYPTION_KEY,
    );
    return customer
      ? c.json({ customer })
      : c.json({ error: 'booking_customer_not_found' }, 404);
  } catch (error) {
    logger.error("routes_booking_failed");
    return c.json({ error: 'customer_data_unavailable' }, 503);
  }
});

booking.post(
  '/api/booking/admin/customers',
  requireRole('owner', 'admin', 'staff'),
  inputJsonBoundary({"display_name":["string"],"phone":["string"],"pet_name":["null","string"],"email":["null","string"]}), async (c) => {
    const accountId = await resolveAccountIdAdmin(c);
    if (!accountId) return inputError(c, { error: 'missing_account_id' }, 400, ["account_id"]);
    /*
     * R559: 応答消失後の再送で同じ電話客を2件作らない。呼び出し側が
     * 確定操作ごとに付ける一意キーで作成済み応答を返す。検証で落ちた
     * 要求は保存しないので、入力を直して同じキーで送り直せる。キーの無い
     * 従来の呼び出しは従来どおり毎回作成する。migration 無しで済ませるため、LIFF用の
     * 冪等表を借り、subject には friend ではなく staff id を入れる。
     * 照合は (key, account, staff) の範囲に閉じ、別アカウントの行は
     * 別物として扱う（=tenant 越しの id 漏れ防止）。
     */
    const idemKey = c.req.header('Idempotency-Key')?.trim() || null;
    const staffSubject = c.get('staff')?.id ?? 'admin';
    /*
     * 冪等表の主キーは key 単独のため、素のキーでは別アカウントの確保と
     * 衝突する。照合は (key, account, staff) に閉じると決めているので、
     * 保存キー自体にアカウントと口を埋め込み、アカウント越しの衝突を無くす。
     * 名前空間化前の完了行（24時間窓）は読むだけ残し、取りこぼしで
     * 作り直さない。migration は要らない（同じ表・同じ列）。
     */
    const idemScope = {
      key: idemKey ? `${accountId}:admin-customer:${idemKey}` : '',
      lineAccountId: accountId,
      friendId: staffSubject,
      now: new Date(),
    };
    if (idemKey) {
      const cached = await findIdempotencyResponse(c.env.DB, idemScope);
      if (cached && cached.status !== 202) {
        return c.json(cached.body as Record<string, unknown>, cached.status as 201);
      }
      if (cached) return c.json({ error: 'request_in_progress' }, 409);
      const legacy = await findIdempotencyResponse(c.env.DB, { ...idemScope, key: idemKey });
      if (legacy && legacy.status !== 202) {
        return c.json(legacy.body as Record<string, unknown>, legacy.status as 201);
      }
    }
    const body = await c.req.json<{
      display_name?: string;
      phone?: string;
      pet_name?: string | null;
      email?: string | null;
    }>();
    if (!body.display_name || !body.phone) {
      return inputError(c, { error: 'missing_customer_fields' }, 400, ["display_name","phone"]);
    }
    /*
     * R559残差: 同じキーで同時に届いた2件がどちらも未保存と判断し、
     * 別の顧客を2件作っていた。完了後の保存だけでは同時到着に負けるので、
     * 代理予約と同じく先に202の仮応答を1行だけ確保し、確保できた
     * 呼び出しだけが作成へ進む。検証落ちは確保前に返すので、入力を
     * 直して同じキーで送り直せるのは従来どおり。
     */
    if (idemKey) {
      const reserved = await reserveIdempotencyResponse(c.env.DB, {
        ...idemScope,
        body: { error: 'request_in_progress' },
        ttlMinutes: BOOKING_CUSTOMER_IDEMPOTENCY_TTL_MINUTES,
      });
      if (!reserved) {
        const raced = await findIdempotencyResponse(c.env.DB, idemScope);
        if (raced && raced.status !== 202) {
          return c.json(raced.body as Record<string, unknown>, raced.status as 201);
        }
        return c.json({ error: raced ? 'request_in_progress' : 'idempotency_key_conflict' }, 409);
      }
    }
    const customerId = crypto.randomUUID();
    try {
      const customer = await createBookingCustomer(c.env.DB, {
        id: customerId,
        lineAccountId: accountId,
        displayName: body.display_name,
        phone: body.phone,
        petName: body.pet_name,
        email: body.email,
        encryptionKey: c.env.LINE_CREDENTIAL_ENCRYPTION_KEY,
      });
      // R559: 同じキーの再送には作り直さずこの応答を返す。24時間の窓。
      if (idemKey) {
        await completeIdempotencyResponse(c.env.DB, {
          ...idemScope,
          status: 201,
          body: { customer },
        });
      }
      return c.json({ customer }, 201);
    } catch (error) {
      /*
       * R559再残差: 顧客INSERTの成功後に完了書き込みだけ落ちると、
       * 仮応答を消すだけでは再送が同じ顧客を作り直して2件になる。
       * 作られた顧客を読み直し、完了行を修復してから503を返す。
       * 再送は修復済みの作成済み顧客へ届く。作られていないときだけ
       * 仮応答を消す（完了行・別呼び出しの行は触らない）。修復自体が
       * 失敗したときは仮応答を残し、再送を409で止める（作り直さない）。
       */
      if (idemKey) {
        let rescued: {
          id: string; line_account_id: string; friend_id: string | null;
          display_name: string; phone_last4: string; pet_name: string | null;
          created_at: string; updated_at: string;
        } | null = null;
        /*
         * 救出の読み直し自体が落ちたときは「無い」と分からない。
         * null と例外を混ぜると、作られた顧客がいるのに仮応答を消して
         * 再送で作り直してしまう。不在が確実なときだけ消す。
         */
        let rescueSettled = false;
        try {
          rescued = await c.env.DB
            .prepare(
              `SELECT id, line_account_id, friend_id, display_name,
                      phone_last4, pet_name, created_at, updated_at
                 FROM booking_customers WHERE id = ? AND line_account_id = ?`,
            )
            .bind(customerId, accountId)
            .first<{
              id: string; line_account_id: string; friend_id: string | null;
              display_name: string; phone_last4: string; pet_name: string | null;
              created_at: string; updated_at: string;
            }>();
          rescueSettled = true;
        } catch {
          rescueSettled = false;
        }
        if (rescued) {
          try {
            await completeIdempotencyResponse(c.env.DB, {
              ...idemScope,
              status: 201,
              body: {
                customer: {
                  ...rescued,
                  is_line_linked: rescued.friend_id !== null,
                },
              },
            });
          } catch {
            // 修復できず仮応答が残る。再送は409で止まり、作り直さない。
          }
        } else if (rescueSettled) {
          try {
            await c.env.DB
              .prepare(
                `DELETE FROM booking_idempotency_keys
                  WHERE key = ? AND line_account_id = ? AND friend_id = ?
                    AND response_status = 202`,
              )
              .bind(idemScope.key, idemScope.lineAccountId, idemScope.friendId)
              .run();
          } catch {
            // 消せなくても後の分岐で503を返す。残った仮応答はTTLで消える。
          }
        }
      }
      const code = error instanceof Error ? error.message : '';
      if (code.startsWith('booking_customer_') && code.endsWith('_invalid')) {
        return inputError(c, { error: code }, 422, [code.slice('booking_customer_'.length, -'_invalid'.length)]);
      }
      logger.error("routes_booking_failed");
      return c.json({ error: 'customer_data_unavailable' }, 503);
    }
  },
);
}

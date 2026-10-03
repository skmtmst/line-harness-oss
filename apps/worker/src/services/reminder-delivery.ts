/**
 * リマインダ配信処理 — cronトリガーで定期実行
 *
 * ゴール日時から決まる配信時刻が現在時刻以前で、まだ配信されていない通を送る。
 * 配信時刻の決め方は2つある（153）。
 *   'time'      … ゴールの○日前の●時
 *   'countdown' … ゴールから何分ずらすか
 * どちらで動くかはリマインダごとに決まっていて、途中で変わらない。
 */

import {
  claimReminderDeliveryRun,
  completeReminderDeliveryRunStatement,
  getFriendReminderSendGate,
  getFriendReminderStatus,
  getPendingReminderDeliveries,
  completeReminderIfDone,
  failReminderDeliveryRun,
  getFriendById,
  getLineAccountById,
  getReminderDeliveryRunSentPayload,
  getTemplateById,
  getTemplateVersion,
  holdExpiredLineRetryRuns,
  isOperationCapabilityStopped,
  parseTemplateVersionSnapshot,
  releaseClaimedReminderRun,
  saveReminderDeliveryRunSentPayload,
  skipReminderDeliveryRun,
  verifyClaimedRunBeforeSend,
  listLineAccountsWithTenantStatus,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { isStoppedTenantStatus } from './tenant-runtime-status.js';
import { addJitter, sleep } from './stealth.js';
import { getSendPermissionForAccount, type SendPermission, type SendPermissionCache } from './send-entitlements.js';
import { buildMessage } from './line-message.js';
import { expandVariables, resolveMetadata } from './step-delivery.js';
import { resolveSendInterpolationExtra } from './interpolation-context.js';
import { resolveReminderSendAt } from '@line-crm/shared';
import {
  classifyExternalDeliveryError,
  externalDeliveryRetryAt,
  type SafeExternalDeliveryError,
} from './external-delivery-retry.js';
import type { ReminderDeliveryRunRow, ReminderStepRow } from '@line-crm/db';
import type { Message } from '@line-crm/line-sdk';
import { featureJobCanRun } from './feature-enforcement.js';
import {
  assertFinalMeetSendRight,
  isMeetConsultationSendable,
  isMeetSendCandidateCurrent,
  readMeetSendCandidate,
  type MeetSendCandidate,
} from './meet-consultation-reminders.js';

const LEASE_MINUTES = 5;

type PushClient = Pick<LineClient, 'pushMessageWithRequestId'>;

export interface ReminderDeliveryOptions {
  now?: Date;
  /** 試験用。課金の状態による配信可否を差し替える。 */
  sendPermission?: (db: D1Database, accountId: string | null, cache?: SendPermissionCache) => Promise<SendPermission>;
  pause?: (milliseconds: number) => Promise<void>;
  resolveClient?: (accountId: string | null, fallback: PushClient) => Promise<PushClient>;
  /**
   * 送信権の取得後にだけ走る試験用の割り込み口。本番では未指定 (待たない)。
   * この後の再検証がシーム中の取消を拾うため、検証後注入テストで使う。
   */
  beforePush?: (run: { id: string; friendReminderId: string }) => Promise<void>;
}

export interface ReminderDeliveryResult {
  succeeded: number;
  skipped: number;
  retrying: number;
  failed: number;
  /** 緊急停止で claim せず残した登録数（復旧後に届く）。 */
  held: number;
}

/** 本番配信と下書き試験が同じテンプレート・変数展開を通る共通口。 */
/*
 * F10: リマインダの差し込み「予約日時・Google Meet URL」。
 * 個別相談の確定予定（meet_consultations）から、その人への値を引く。
 * 直近の確定予定が先。確定が1つも無ければ空文字（残さない）。
 * 取消・完了は確定ではないので空扱い。F6・Meet送信版・lease・
 * 日時変更/取消ガードには触らない。読むだけ。
 */
export const RESERVATION_DATETIME_PATTERN = /\{\{\s*reservation_datetime\s*\}\}/;
export const MEET_URL_PATTERN = /\{\{\s*meet_url\s*\}\}/;

export function contentNeedsBookingPlaceholders(content: string): boolean {
  return RESERVATION_DATETIME_PATTERN.test(content) || MEET_URL_PATTERN.test(content);
}

export interface BookingInterpolation {
  reservationDatetime: string;
  meetUrl: string;
}

/** 開始日時を「10月10日（木）10:00」の形にする（Meet通知と同じ形）。 */
export function formatBookingDatetime(startsAt: string): string {
  const start = new Date(startsAt);
  const jst = new Date(start.getTime() + 9 * 60 * 60 * 1000);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const iso = jst.toISOString();
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const time = iso.slice(11, 16);
  return `${month}月${day}日（${weekdays[jst.getUTCDay()]}）${time}`;
}

export interface BookingConsultationRow {
  starts_at: string;
  meet_url: string | null;
}

/*
 * F10補修: 送る側と公開前検査で同じ行選びを使う。
 * 直近の確定予定が先。無効な日時は飛ばす。確定が無ければ null。
 */
export function pickBookingConsultation(
  rows: BookingConsultationRow[],
  nowMs: number,
): BookingConsultationRow | null {
  const valid = rows.filter((row) => Number.isFinite(Date.parse(row.starts_at)));
  const upcoming = valid
    .filter((row) => Date.parse(row.starts_at) >= nowMs)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const past = valid
    .filter((row) => Date.parse(row.starts_at) < nowMs)
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  return upcoming[0] ?? past[0] ?? null;
}

export async function resolveBookingInterpolation(
  db: D1Database,
  friendId: string,
  now: Date = new Date(),
): Promise<BookingInterpolation> {
  const empty = { reservationDatetime: '', meetUrl: '' };
  const rows = await db.prepare(
    `SELECT starts_at, meet_url FROM meet_consultations
      WHERE friend_id = ? AND status = 'confirmed'`,
  ).bind(friendId).all<BookingConsultationRow>();
  const picked = pickBookingConsultation(rows.results ?? [], now.getTime());
  if (!picked) return empty;
  return {
    reservationDatetime: formatBookingDatetime(picked.starts_at),
    meetUrl: picked.meet_url ?? '',
  };
}

export function substituteBookingPlaceholders(
  content: string,
  values: BookingInterpolation,
): string {
  return content
    .replace(/\{\{\s*reservation_datetime\s*\}\}/g, values.reservationDatetime)
    .replace(/\{\{\s*meet_url\s*\}\}/g, values.meetUrl);
}

export async function buildReminderStepMessage(
  db: D1Database,
  step: ReminderStepRow,
  friend: NonNullable<Awaited<ReturnType<typeof getFriendById>>>,
  deliveredAt: Date,
  // 下書き試験から呼ぶときは 'test_send' を渡す。台帳の送信種別が
  // 本番配信とテスト送信で分かれる。
  sourceKind: 'reminder' | 'test_send' = 'reminder',
  // R346: 登録時のテンプレート版の写し {"テンプレートID": 公開版番号}。
  // 無いときは今までどおり最新の版を読む（下書き試験・古い登録）。
  options?: { pinnedTemplateVersions?: Record<string, number> | null },
): Promise<{
  message: Message;
  messageType: string;
  messageContent: string;
  templateId: string | null;
  templateVersion: number | null;
}> {
  let messageType = step.message_type;
  let messageContent = step.message_content;
  let templateVersion: number | null = null;
  if (step.template_id) {
    // R346: 登録時の版があるときはその版で送る。新しい版にするのは
    // 登録し直した時だけ。版履歴に無いときは今の版へ落ちる。
    const pinned = options?.pinnedTemplateVersions?.[step.template_id];
    if (pinned != null) {
      const version = await getTemplateVersion(db, step.template_id, pinned);
      if (version) {
        messageType = version.message_type;
        messageContent = version.message_content;
        templateVersion = version.version_number;
      }
    }
    if (templateVersion == null) {
      const template = await getTemplateById(db, step.template_id);
      if (template) {
        messageType = template.message_type;
        messageContent = template.message_content;
        const live = Number(template.published_version);
        templateVersion = Number.isFinite(live) && live > 0 ? live : null;
      }
    }
  }
  const resolvedMeta = await resolveMetadata(db, friend);
  // F10: 予約日時・Meet URL は送る側で置き換える。共通展開より先に潰すので、
  // 利用者が入れた値に同じ文字があっても二重に展開しない。
  const bookingContent = contentNeedsBookingPlaceholders(messageContent)
    ? substituteBookingPlaceholders(
      messageContent,
      await resolveBookingInterpolation(db, friend.id, deliveredAt),
    )
    : messageContent;
  const extra = await resolveSendInterpolationExtra(
    db, friend.id, bookingContent, { kind: sourceKind, id: step.id },
  );
  const expanded = expandVariables(
    bookingContent,
    { ...friend, metadata: resolvedMeta },
    undefined,
    messageType,
    { ...extra, deliveredAt },
  );
  return {
    message: buildMessage(messageType, expanded),
    messageType,
    messageContent: expanded,
    templateId: step.template_id,
    templateVersion,
  };
}

/**
 * R345: 1通の送信内容を決める。初回は作って実行行へ残し、
 * 同じ再試行キーの再送は残した本文をそのまま使う。
 * 受理ずみ（409）の再試行も初回と同じ要求になるため、履歴は初回の内容を表す。
 * まだ送っていない通は今までどおり最新の差し込みで作る。
 */
async function resolveReminderRunMessage(
  db: D1Database,
  run: ReminderDeliveryRunRow,
  step: ReminderStepRow,
  friend: NonNullable<Awaited<ReturnType<typeof getFriendById>>>,
  sendAt: Date,
  pinnedTemplateVersions: Record<string, number> | null,
  ownedLeases: string[],
  nowIso: string,
): Promise<{
  message: Message;
  messageType: string;
  messageContent: string;
  templateId: string | null;
}> {
  const saved = await getReminderDeliveryRunSentPayload(db, run.id);
  if (saved) {
    return {
      message: buildMessage(saved.messageType, saved.messageContent),
      messageType: saved.messageType,
      messageContent: saved.messageContent,
      templateId: saved.templateId,
    };
  }
  const fresh = await buildReminderStepMessage(db, step, friend, sendAt, 'reminder', {
    pinnedTemplateVersions,
  });
  // 先に残した処理があるときはそちらを使う（同じ実行の二重保存をしない）。
  const persisted = await saveReminderDeliveryRunSentPayload(db, {
    id: run.id,
    messageType: fresh.messageType,
    messageContent: fresh.messageContent,
    templateId: fresh.templateId,
    templateVersion: fresh.templateVersion,
    now: nowIso,
    expectedLeaseExpiresAt: ownedLeases,
  });
  if (persisted) {
    return {
      message: buildMessage(persisted.messageType, persisted.messageContent),
      messageType: persisted.messageType,
      messageContent: persisted.messageContent,
      templateId: persisted.templateId,
    };
  }
  return fresh;
}

/** Provider本文や秘密値を管理画面へ出さず、運用者が次の行動を選べる言葉へ直す。 */
export function classifyReminderDeliveryError(error: unknown): SafeExternalDeliveryError {
  return classifyExternalDeliveryError(error);
}

async function defaultResolveClient(
  db: D1Database,
  accountId: string | null,
  _fallback: PushClient,
): Promise<PushClient> {
  // 所属不明の友だちを「既定アカウント」で送ると、別店舗名義の誤送信になる。
  // 古いデータは履歴へ残すが、送信元アカウントを推測しない。
  if (!accountId) throw new Error('REMINDER_LINE_ACCOUNT_NOT_FOUND');
  const account = await getLineAccountById(db, accountId);
  if (!account) throw new Error('REMINDER_LINE_ACCOUNT_NOT_FOUND');
  return new LineClient(account.channel_access_token);
}

export async function processReminderDeliveries(
  db: D1Database,
  lineClient: LineClient,
  options: ReminderDeliveryOptions = {},
): Promise<ReminderDeliveryResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MINUTES * 60_000).toISOString();

  // R344: 再試行キーの期限を過ぎた結果不明は自動で送らない。
  // 要確認として残し、人が確かめて手動で送る。
  await holdExpiredLineRetryRuns(db, { now: nowIso });

  const pending = await getPendingReminderDeliveries(db);
  const accountsWithStatus = await listLineAccountsWithTenantStatus(db);
  const tenantStatusByAccount = new Map(
    accountsWithStatus.map((account) => [account.id, account.tenant_status]),
  );
  // アカウントの稼働状態（X-1）。止めているアカウント宛の通は
  // 「送らなかった」記録にして積まない。
  const activeByAccount = new Map(
    accountsWithStatus.map((account) => [account.id, Boolean(account.is_active)]),
  );
  const result: ReminderDeliveryResult = { succeeded: 0, skipped: 0, retrying: 0, failed: 0, held: 0 };
  const sendPermissions: SendPermissionCache = new Map();

  /*
   * 配信時刻が来た通だけに絞る。
   *
   * 時刻の決め方は2つあり（153）、どちらもゴール日時を起点にする。
   *   'time'      … ゴールの○日前の●時（日本時間の暦で数える）
   *   'countdown' … ゴールから何分ずらすか
   * 判定に使う「いま」と、本文の {{date}} に使う「届く日時」を分けているのは、
   * cron が遅れて動いても本文の日付がずれないようにするため。
   */
  // 未来の通もqueuedとして先に台帳へ置く。実行結果画面の「配信予定」と
  // 「次の配信」を、送信時刻になる前から実値で確認できるようにする。
  // claim側の scheduled_at <= now 条件が、時刻前の外部送信を止める。
  enrollmentLoop: for (let i = 0; i < pending.length; i++) {
    const enrollment = pending[i];
    if (i > 0) {
      await (options.pause ?? sleep)(addJitter(50, 200));
    }

    const friend = await getFriendById(db, enrollment.friend_id);
    const friendAccountId = friend
      ? (friend as unknown as Record<string, string | null>).line_account_id ?? null
      : null;
    const accountId = enrollment.line_account_id ?? friendAccountId;
    if (accountId && isStoppedTenantStatus(tenantStatusByAccount.get(accountId))) {
      // Materialize terminal skipped runs for steps that are already due. This
      // keeps them unsent and prevents restore from becoming an overdue blast.
      for (const step of enrollment.steps) {
        const sendAt = resolveReminderSendAt(
          new Date(enrollment.target_date),
          {
            offsetDays: step.offset_days,
            sendAtTime: step.send_at_time,
            offsetMinutes: step.offset_minutes,
          },
          enrollment.delivery_mode === 'time' ? 'time' : 'countdown',
        );
        if (sendAt.getTime() > now.getTime()) continue;
        const run = await claimReminderDeliveryRun(db, {
          lineAccountId: accountId,
          reminderId: enrollment.reminder_id,
          friendReminderId: enrollment.id,
          friendId: enrollment.friend_id,
          reminderStepId: step.id,
          scheduledAt: sendAt.toISOString(),
          now: nowIso,
          leaseExpiresAt,
        });
        if (!run) continue;
        await skipReminderDeliveryRun(db, {
          id: run.id,
          code: 'tenant_suspended',
          message: '契約先の利用停止中に配信時刻を過ぎたため送信しませんでした。',
          now: nowIso,
          expectedLeaseExpiresAt: run.lease_expires_at ? [run.lease_expires_at] : [],
        });
        result.skipped++;
      }
      continue;
    }
    /*
     * アカウント停止中（X-1、v6-33 §10-1）。期限の来た通は skipped の
     * 実行行として残すので、再開しても自動では送り直さない。
     */
    if (accountId && activeByAccount.get(accountId) === false) {
      for (const step of enrollment.steps) {
        const sendAt = resolveReminderSendAt(
          new Date(enrollment.target_date),
          {
            offsetDays: step.offset_days,
            sendAtTime: step.send_at_time,
            offsetMinutes: step.offset_minutes,
          },
          enrollment.delivery_mode === 'time' ? 'time' : 'countdown',
        );
        if (sendAt.getTime() > now.getTime()) continue;
        const run = await claimReminderDeliveryRun(db, {
          lineAccountId: accountId,
          reminderId: enrollment.reminder_id,
          friendReminderId: enrollment.id,
          friendId: enrollment.friend_id,
          reminderStepId: step.id,
          scheduledAt: sendAt.toISOString(),
          now: nowIso,
          leaseExpiresAt,
        });
        if (!run) continue;
        await skipReminderDeliveryRun(db, {
          id: run.id,
          code: 'account_inactive',
          message: 'アカウントの送受信を止めている間に配信時刻を過ぎたため送信しませんでした。',
          now: nowIso,
          expectedLeaseExpiresAt: run.lease_expires_at ? [run.lease_expires_at] : [],
        });
        result.skipped++;
      }
      continue;
    }
    // 機能オフ中はclaimせずactiveのまま残す。再オンで再開する。
    if (accountId && !await featureJobCanRun(db, { accountId, featureId: 'reminders', job: 'reminder deliveries' })) {
      result.skipped += enrollment.steps.length;
      continue;
    }
    // 緊急停止 (#1050): reminder_dispatch が止まっている統括は claim せず
    // active のまま残す。実行行を積まないので復旧でそのまま届く。
    // アカウント未割当の行はグローバル停止 (*) だけに従う。
    if (await isOperationCapabilityStopped(db, accountId, 'reminder_dispatch')) {
      result.held += 1;
      continue;
    }

    // 課金の状態（トライアル終了・解約）で配信が止まっている統括は送らない。
    // 予約は触らず、次の cron でまた確かめる。プランを選べば続きから届く。
    const permission = await (options.sendPermission ?? getSendPermissionForAccount)(db, accountId, sendPermissions);
    if (!permission.allowed) {
      result.skipped += enrollment.steps.length;
      continue;
    }

    for (const step of enrollment.steps) {
      // claim の直前にも停止を確かめる。登録ごとの判定の後で止まった分は、
      // 実行行を新しく積まずにこの登録の残り全部を保留へ回す。
      if (await isOperationCapabilityStopped(db, accountId, 'reminder_dispatch')) {
        result.held += 1;
        continue enrollmentLoop;
      }
      // R339: 候補読込後の日時変更を見落とさない。実行行を作る前に
      // 登録の現在値を読み直し、ずれた起点では古い予定を作らない。
      // 次の tick で読み直すためここでは何も積まない。
      const gate = await getFriendReminderSendGate(db, enrollment.id);
      if (!gate || gate.status !== 'active' || gate.targetDate !== enrollment.target_date) continue;
      const sendAt = resolveReminderSendAt(
        new Date(gate.targetDate),
        {
          offsetDays: step.offset_days,
          sendAtTime: step.send_at_time,
          offsetMinutes: step.offset_minutes,
        },
        enrollment.delivery_mode === 'time' ? 'time' : 'countdown',
      );
      const run = await claimReminderDeliveryRun(db, {
        lineAccountId: accountId,
        reminderId: enrollment.reminder_id,
        friendReminderId: enrollment.id,
        friendId: enrollment.friend_id,
        reminderStepId: step.id,
        scheduledAt: sendAt.toISOString(),
        now: nowIso,
        leaseExpiresAt,
        expectedTargetDate: gate.targetDate,
      });
      // 別cronが送信中、再試行時刻前、または既に終端状態なら何もしない。
      if (!run) continue;
      // R340: この貸出で付けた期限だけを以後の書込に使う。期限切れで
      // 別処理へ移った後の書込は 0 件になり、上書きしない。
      const claimLease = run.lease_expires_at;
      const ownedLeases = (claimLease ? [claimLease] : []).concat([leaseExpiresAt]);

      // 取消と cron の競合対策: claimed 済みでも送る直前に登録を確認する。
      // 取消後に残った実行行は送らず止める (取消漏れの送信を防ぐ)。
      // 登録ごと飛ばす (内側の通ループではなく)。末尾の完了化は取消済みの
      // 登録へ触れない。
      if ((await getFriendReminderStatus(db, enrollment.id)) !== 'active') {
        await db.prepare(
          `UPDATE reminder_delivery_runs
              SET status = 'cancelled', completed_at = ?, lease_expires_at = NULL,
                  next_retry_at = NULL, updated_at = ?
            WHERE id = ? AND status = 'claimed' AND lease_expires_at = ?`,
        ).bind(nowIso, nowIso, run.id, claimLease).run();
        result.skipped++;
        continue enrollmentLoop;
      }

      // Meet個別相談のV6行は、結び付き予約の版・日時・本人・状態が
      // 一致するときだけ送る。古い版の予定はここで止める (版なし旧行は通す)。
      // 取消後に残った実行行は送らず止める。
      // 本文解決の前に送信候補の写しを読み、最終送信権と突き合わせる。
      let meetCandidate: MeetSendCandidate | null = null;
      if (enrollment.source_kind === 'meet' && enrollment.source_id) {
        if (!(await isMeetConsultationSendable(db, enrollment.source_id))) {
          await db.prepare(
            `UPDATE reminder_delivery_runs
                SET status = 'cancelled', completed_at = ?, lease_expires_at = NULL,
                    next_retry_at = NULL, updated_at = ?
              WHERE id = ? AND status = 'claimed' AND lease_expires_at = ?`,
          ).bind(nowIso, nowIso, run.id, claimLease).run();
          result.skipped++;
          continue enrollmentLoop;
        }
        meetCandidate = await readMeetSendCandidate(db, enrollment.source_id);
        if (!meetCandidate) {
          await db.prepare(
            `UPDATE reminder_delivery_runs
                SET status = 'cancelled', completed_at = ?, lease_expires_at = NULL,
                    next_retry_at = NULL, updated_at = ?
              WHERE id = ? AND status = 'claimed' AND lease_expires_at = ?`,
          ).bind(nowIso, nowIso, run.id, claimLease).run();
          result.skipped++;
          continue enrollmentLoop;
        }
      }

      if (!friend) {
        await skipReminderDeliveryRun(db, {
          id: run.id,
          code: 'friend_not_found',
          message: '友だち情報が見つからないため送信しませんでした。',
          now: nowIso,
          expectedLeaseExpiresAt: claimLease ? [claimLease] : [],
        });
        result.skipped++;
        continue;
      }
      if (!friend.is_following) {
        await skipReminderDeliveryRun(db, {
          id: run.id,
          code: 'friend_not_following',
          message: 'ブロックまたは友だち解除のため送信しませんでした。',
          now: nowIso,
          expectedLeaseExpiresAt: claimLease ? [claimLease] : [],
        });
        result.skipped++;
        continue;
      }

      try {
        const deliveryClient = await (options.resolveClient
          ? options.resolveClient(accountId, lineClient)
          : defaultResolveClient(db, accountId, lineClient));
        // R346: この登録が使うテンプレート版。無い登録は今までどおり最新の版。
        const pinnedTemplateVersions = parseTemplateVersionSnapshot(
          enrollment.template_version_snapshot,
        );
        const built = await resolveReminderRunMessage(
          db, run, step, friend, sendAt, pinnedTemplateVersions, ownedLeases, nowIso,
        );
        // 取消と送信の競合対策: push の直前に送る権利を1文で確かめる。
        // この後も beforePush・再検証・関係確認・停止確認のawaitがあり、
        // その間の更新は後の確認で拾う。push呼出しとの間にはawaitを挟まない。
        // 外部送信は巻き戻せないため、権利取得と取消確定の順序は DB の1文で
        // 直列化し、確定後の送信は成功にできない (後段で検出・記録する)。
        if (!await verifyClaimedRunBeforeSend(db, {
          id: run.id,
          friendReminderId: enrollment.id,
          now: nowIso,
          leaseExpiresAt,
          expectedLeaseExpiresAt: claimLease ? [claimLease] : [],
          expectedTargetDate: gate.targetDate,
        })) {
          result.skipped++;
          continue;
        }
        await options.beforePush?.({ id: run.id, friendReminderId: enrollment.id });
        // シーム (試験割り込み) の後に取り直す。シーム中の取消をここで拾う。
        // 本番で beforePush は無い (2つの検証の間に他の処理は挟まない)。
        if (!await verifyClaimedRunBeforeSend(db, {
          id: run.id,
          friendReminderId: enrollment.id,
          now: nowIso,
          leaseExpiresAt,
          expectedLeaseExpiresAt: ownedLeases,
          expectedTargetDate: gate.targetDate,
        })) {
          result.skipped++;
          continue;
        }
        // Meet個別相談のV6行は、認証・本文の解決awaitの後の早期選別でも
        // 送信候補の写しと結び付き関係を確かめる。最終判断は停止確認の後の
        // 最終送信権UPDATEで行う。古ければ実行行だけ取り消す
        // (勝者の新版通知には触れない)。
        if (
          enrollment.source_kind === 'meet' &&
          enrollment.source_id &&
          !(await isMeetSendCandidateCurrent(db, enrollment.source_id, meetCandidate))
        ) {
          await db.prepare(
            `UPDATE reminder_delivery_runs
                SET status = 'cancelled', completed_at = ?, lease_expires_at = NULL,
                    next_retry_at = NULL, updated_at = ?
              WHERE id = ? AND status = 'claimed' AND lease_expires_at = ?`,
          ).bind(nowIso, nowIso, run.id, claimLease).run();
          result.skipped++;
          continue enrollmentLoop;
        }
        // 外部送信の直前にも緊急停止を確かめる (#1050)。claim 後に停止へ
        // 切り替わった分は claim をキューへ戻し、失敗・skipped にはしない
        // (停止を理由に消さない。復旧後に届く)。
        if (await isOperationCapabilityStopped(db, accountId, 'reminder_dispatch')) {
          await releaseClaimedReminderRun(db, { id: run.id, now: nowIso, expectedLeaseExpiresAt: ownedLeases });
          result.held += 1;
          continue enrollmentLoop;
        }
        // 最終送信権の確定：待機を全て終えた後、送信権の行と候補の
        // 相談ID・予約ID・予約版・本人・対象日・run・leaseを同じUPDATE文で
        // 結び直す。この後はpush呼出しまでawaitを置かない (呼出し自体の
        // 間の取消は残差として記載)。既存の日時・lease保護はUPDATE内に維持。
        if (enrollment.source_kind === 'meet' && enrollment.source_id) {
          const finalRight = await assertFinalMeetSendRight(db, {
            runId: run.id,
            friendReminderId: enrollment.id,
            expectedTargetDate: gate.targetDate,
            ownedLeases,
            candidate: meetCandidate,
            leaseExpiresAt,
            nowIso,
          });
          if (finalRight !== 'ok') {
            // stale は旧候補のため実行行を取り消す。stolen
            // (貸出が別処理へ移った) は行に触らず見送る。
            if (finalRight === 'stale') {
              const leaseList = ownedLeases.map(() => '?').join(',');
              await db.prepare(
                `UPDATE reminder_delivery_runs
                    SET status = 'cancelled', completed_at = ?, lease_expires_at = NULL,
                        next_retry_at = NULL, updated_at = ?
                  WHERE id = ? AND status = 'claimed' AND lease_expires_at IN (${leaseList})`,
              ).bind(nowIso, nowIso, run.id, ...ownedLeases).run();
            }
            result.skipped++;
            continue enrollmentLoop;
          }
        }
        const response = await deliveryClient.pushMessageWithRequestId(
          friend.line_user_id,
          [built.message],
          run.line_retry_key,
        );

        const deliveredId = crypto.randomUUID();
        const logId = crypto.randomUUID();
        const completed = await db.batch([
          db.prepare(
            `INSERT OR IGNORE INTO friend_reminder_deliveries
               (id, friend_reminder_id, reminder_step_id, delivered_at)
             VALUES (?, ?, ?, ?)`,
          ).bind(deliveredId, enrollment.id, step.id, nowIso),
          db.prepare(
            `INSERT INTO messages_log
               (id, friend_id, direction, message_type, content,
                template_id_at_send, delivery_type, source, line_account_id, created_at)
             VALUES (?, ?, 'outgoing', ?, ?, ?, 'push', 'reminder', ?, ?)`,
          ).bind(
            logId,
            friend.id,
            built.messageType,
            built.messageContent,
            built.templateId,
            accountId,
            nowIso,
          ),
          completeReminderDeliveryRunStatement(db, {
            id: run.id,
            friendReminderId: enrollment.id,
            lineRequestId: response.requestId,
            messageLogId: logId,
            now: nowIso,
            expectedLeaseExpiresAt: ownedLeases,
          }),
        ]);
        result.succeeded++;
        // push と確定の間に取消が確定すると成功にできない (0 件)。
        // 外部送信の有無が曖昧なため送り直さず、運用の追跡用に記録する。
        if (Number(completed[2]?.meta?.changes ?? 0) !== 1) {
          console.error(JSON.stringify({
            event: 'reminder_delivery_completed_after_cancel',
            reminderId: enrollment.reminder_id,
            friendReminderId: enrollment.id,
            runId: run.id,
            messageLogId: logId,
          }));
        }
      } catch (error) {
        const safe = classifyReminderDeliveryError(error);
        const retryAt = externalDeliveryRetryAt(
          error,
          run.retry_cycle_attempt_count,
          now,
          safe.retryable,
        )?.toISOString() ?? null;
        const exhausted = safe.retryable && !retryAt;
        // R340: 持ち主が移っているときは書けず false になる。
        // 新しい持ち主が結果を記録するため、ここでは数えない。
        const recorded = await failReminderDeliveryRun(db, {
          id: run.id,
          code: exhausted ? 'retry_exhausted' : safe.code,
          message: exhausted
            ? '自動再試行の上限に達しました。LINE連携を確認し、必要なら手動で再試行してください。'
            : safe.message,
          retryAt,
          now: nowIso,
          expectedLeaseExpiresAt: ownedLeases,
        });
        if (!recorded) continue;
        if (retryAt) result.retrying++;
        else result.failed++;
        console.error(JSON.stringify({
          event: 'reminder_delivery_failed',
          reminderId: enrollment.reminder_id,
          friendReminderId: enrollment.id,
          runId: run.id,
          code: exhausted ? 'retry_exhausted' : safe.code,
          retryAt,
        }));
      }
    }

    await completeReminderIfDone(db, enrollment.id, enrollment.reminder_id);
  }

  return result;
}

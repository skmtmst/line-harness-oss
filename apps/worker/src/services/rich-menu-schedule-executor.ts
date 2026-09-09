import {
  RICH_MENU_SCHEDULE_MAX_ATTEMPTS,
  acquirePublishLease,
  cancelRichMenuSchedule,
  claimRichMenuSchedule,
  claimRichMenuScheduleRestore,
  classifyRichMenuScheduleError,
  clearRichMenuAssignmentsForGroup,
  clearSchedulePublications,
  detectSnapshotPageDrift,
  getDueRichMenuScheduleRestores,
  getDueRichMenuSchedules,
  getRichMenuScheduleById,
  getSchedulePublications,
  getScheduleRestoreDefaultPin,
  getStalePublishingSchedules,
  getStaleRestoringSchedules,
  listRichMenuSchedulesByGroup,
  markRichMenuGroupPublished,
  markRichMenuGroupUnpublished,
  nextRichMenuScheduleRetryAt,
  pinScheduleRestoreDefault,
  reclaimStalePublishingSchedule,
  reclaimStaleRestoringSchedule,
  recordRichMenuSchedulePermanentFailure,
  recordRichMenuScheduleRestoreSuccess,
  recordRichMenuScheduleRestoreTransientFailure,
  recordRichMenuScheduleSuccess,
  recordRichMenuScheduleTransientFailure,
  recordSchedulePublications,
  releasePublishLease,
  renewPublishLease,
  renewScheduleLease,
  setPageRichMenuId,
  type PublishLeaseFence,
  type RestoreDefaultPin,
  type RichMenuScheduleRow,
  type RichMenuGroupWithPages,
} from '@line-crm/db';
import {
  deletableAfterCompensation,
  type DefaultRestoreOutcome,
} from '../lib/rich-menu-publisher.js';

// E-08 (#621): 保存済み公開予約を時刻到来時に実行する。
// 読むcronが無かったため時刻を過ぎても公開されなかった問題を直す。
// 二重実行は claim の UPDATE 条件 (status + account_id) で防ぐ。
// staleになったpublishing/restoringは所有runのlease期限で回収し永久停止させない。
// 案A(共有publisher段階化): create/upload → DB journal確定 → alias/default切替 →
// 旧メニュー削除。journal確定前の失敗はまだliveでない新メニューだけ消し、
// 既存alias/defaultを変えない。切替途中失敗は保存した切替前LINE状態へ補償する。
// journalを残したまま新メニューを消さない(再試行が消えたIDへ切替えて壊すため)。
// publish lockはowner token+期限付きleaseで、旧holderはrenew失敗後に
// live切替もDB確定もしない。手動公開も同じ取得関数を使う。
// 「前のメニューへ戻す」は実行開始直前・切替前の実LINE defaultを365へ固定し、
// 終了時は固定値へ戻す。captured対象が消えていたら解除せず恒久失敗に残す。

export type ScheduleLineAccount = {
  id: string;
  channel_access_token: string | null;
  is_active?: number | null;
  archived_at?: string | null;
};

export type ScheduleStaff = {
  id: string;
  role: 'owner' | 'admin' | 'staff';
  is_active: number;
  access_level?: string | null;
};

/** 新規作成したLINEメニュー1枚。切替前の旧IDも付けて運ぶ。 */
export type ScheduleShell = {
  pageId: string;
  orderIndex: number;
  newRichMenuId: string;
  oldLineRichMenuId: string | null;
};

/** 切替前のLINE状態。切替失敗の補償でここへ戻す。 */
export type SchedulePreSwitchState = {
  oldIds: Array<{ pageId: string; orderIndex: number; lineRichMenuId: string | null }>;
  previousDefaultId: string | null;
};

/** 切替失敗の補償結果。default 復元の可否を飲み込まずに返す。 */
export type ScheduleSwitchCompensation = {
  /** aliasを旧へ戻せなかったページ。新メニューを消してはいけない。 */
  unrestoredPageIds: Set<string>;
  /** default 復元の結果。'failed' なら指したままの新メニューを消さない。 */
  defaultRestore: DefaultRestoreOutcome;
};

/** 1回のtickで積む付帯結果。default復元の未完了を表へ出すために使う。 */
type ExecutionStats = { defaultRestoreIncomplete: number };

/**
 * lease の期限に使う実時間。
 *
 * cron の tick 時刻 (`options.now`) は「どの予約が来たか」を決めるためのもので、
 * 処理が何分かかったかは表さない。入口で作った時刻を renew に使い回すと、
 * 延ばしているつもりで期限が前に進まず、長い公開の途中で別の実行に
 * 回収される。lease はここから取った**そのときの**時刻で刻む。
 */
type LeaseClock = () => string;

export type RichMenuScheduleExecutorDeps = {
  getGroupWithPages: (db: D1Database, groupId: string) => Promise<RichMenuGroupWithPages | null>;
  getLineAccount: (
    db: D1Database,
    accountId: string,
  ) => Promise<ScheduleLineAccount | null>;
  getRequestingStaff: (
    db: D1Database,
    staffId: string,
  ) => Promise<ScheduleStaff | null>;
  isStaffAllowedForAccount: (
    db: D1Database,
    staffId: string,
    accountId: string,
  ) => Promise<boolean>;
  /**
   * 第一段: 予約スナップショットからLINEへ新規作成だけ行う。
   * alias/defaultは触らない。失敗時は作った分を消して投げる。
   * 本番は createRichMenuShells を呼ぶ。テストはモックで件数を数える。
   */
  createLineShells: (
    snapshot: unknown,
    schedule: RichMenuScheduleRow,
    /** 長いLINE処理の途中で担当を確かめる合図。失権していたら投げる。 */
    heartbeat: () => Promise<void>,
  ) => Promise<ScheduleShell[]>;
  /**
   * 明示の戻し先がある期間復元用: 戻し先groupの現内容から新規作成だけ行う。
   * alias/defaultは触らない。失敗時は作った分を消して投げる。
   */
  createRestoreShells: (
    restoreGroup: RichMenuGroupWithPages,
    schedule: RichMenuScheduleRow,
    heartbeat: () => Promise<void>,
  ) => Promise<ScheduleShell[]>;
  /** 切替直前の実LINE defaultを読む。固定(pin)の材料にする。 */
  readCurrentDefaultId: (schedule: RichMenuScheduleRow) => Promise<string | null>;
  /**
   * 第二段: alias切替+default設定/解除。失敗時は投げるだけで補償しない。
   * 呼び出し側が journal を消してから compensateSwitchToPrevious で戻す。
   */
  switchLiveTo: (input: {
    schedule: RichMenuScheduleRow;
    groupId: string;
    setDefault: boolean;
    shells: ScheduleShell[];
    heartbeat: () => Promise<void>;
  }) => Promise<void>;
  /**
   * 切替失敗の補償: aliasを旧へ戻し、defaultを切替前へ戻す。
   * 決して投げない。戻せなかった pageId と default 復元の結果を返す。
   * default を戻し切れていない新メニューは呼び出し側が消さない。
   */
  compensateSwitchToPrevious: (input: {
    schedule: RichMenuScheduleRow;
    groupId: string;
    prev: SchedulePreSwitchState;
    newIds: string[];
  }) => Promise<ScheduleSwitchCompensation>;
  /**
   * 作った分・旧分の削除。404許容で決して投げない(後片付け用)。
   * 本番は deleteRichMenuShells を呼ぶ。
   */
  deleteLineShells: (schedule: RichMenuScheduleRow, lineRichMenuIds: string[]) => Promise<void>;
  /**
   * 固定した切替前defaultへ戻す。すでに固定値なら何もしない。
   * 固定メニューがLINEから消えていたら no_restore_target を投げ、
   * 勝手に解除せず恒久失敗に残す。
   */
  restoreCapturedDefault: (schedule: RichMenuScheduleRow, lineId: string) => Promise<void>;
  /**
   * no_default の明示解除。このgroupのものが現在defaultのときだけ外す。
   * 別メニューのdefaultまで壊さない。何もなければ成功扱い。
   */
  clearAccountDefault: (schedule: RichMenuScheduleRow) => Promise<void>;
  /**
   * 期限切れメニューを指す個別割当をLINE側で外す (既定へ戻す)。
   * D1行の削除より先に呼ぶ。解除済み・対象なしは何もしない。
   * 戻り値は解除した人数。
   */
  unlinkIndividualLinks: (schedule: RichMenuScheduleRow) => Promise<number>;
};

export type RichMenuScheduleProcessResult = {
  processed: number;
  succeeded: number;
  restored: number;
  retried: number;
  failed: number;
  skipped: number;
  reclaimed: number;
  /**
   * 切替失敗の補償で「切替前のdefaultへ戻し切れなかった」回数。
   * 0 でなければLINEの全体defaultが宙に浮いている可能性があり、
   * 指したままの新メニューは消さずに残してある(要対応)。
   */
  defaultRestoreIncomplete: number;
};

function parseSnapshot(snapshot: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(snapshot) };
  } catch {
    return { ok: false, error: 'definition_snapshot is not JSON' };
  }
}

function snapshotHasPublishablePages(snapshot: unknown): boolean {
  if (typeof snapshot !== 'object' || snapshot === null) return false;
  const pages = (snapshot as { pages?: unknown }).pages;
  return Array.isArray(pages) && pages.length > 0;
}

function toJournalPages(shells: ScheduleShell[]): Array<{ pageId: string; lineRichMenuId: string }> {
  return shells.map((shell) => ({
    pageId: shell.pageId,
    lineRichMenuId: shell.newRichMenuId,
  }));
}

/** leaseを取れなかった・失ったときの一時失敗。'try again'入りで再試行分類になる。 */
function publishLeaseTakenError(groupId: string): Error {
  return new Error(`publish_lease_taken: group ${groupId} is publishing, try again`);
}

async function checkAccountAndStaff(
  db: D1Database,
  schedule: RichMenuScheduleRow,
  deps: RichMenuScheduleExecutorDeps,
): Promise<string | null> {
  const account = await deps.getLineAccount(db, schedule.account_id);
  if (!account) return 'line account not found';
  if (account.archived_at) return 'account_archived: line account is archived';
  if (account.is_active === 0) return 'account_inactive: line account is stopped';
  if (!account.channel_access_token) {
    return 'LINE credential missing, try again';
  }
  // 予約者の現在状態を再確認。env-ownerはDB行が無いため通す。
  if (schedule.requested_by_staff_id !== 'env-owner') {
    const staff = await deps.getRequestingStaff(db, schedule.requested_by_staff_id);
    if (!staff || staff.is_active !== 1) return 'staff_inactive: requester is disabled';
    if (staff.role !== 'owner' && staff.role !== 'admin') {
      return 'staff_forbidden: requester lost owner/admin role';
    }
    if (staff.access_level === 'read_only') return 'staff_forbidden: requester is read-only';
    const allowed = await deps.isStaffAllowedForAccount(db, staff.id, schedule.account_id);
    if (!allowed) return 'staff_forbidden: requester lost account visibility';
  }
  return null;
}

type FailRecorder = (error: unknown) => Promise<'retried' | 'failed' | 'skipped'>;

function makeFailRecorder(
  db: D1Database,
  schedule: RichMenuScheduleRow,
  runId: string,
  now: Date,
  attemptCount: number,
  recordTransient: (db: D1Database, id: string, accountId: string, runId: string, code: string, retryAt: string) => Promise<boolean>,
  recordPermanent: (db: D1Database, id: string, accountId: string, runId: string, code: string) => Promise<boolean>,
  lease?: { groupId: string; fence: PublishLeaseFence },
): FailRecorder {
  return async (error: unknown) => {
    try {
      // leaseを持っていたら開ける。所有者と世代が一致するときだけ開くので、
      // 回収に負けた旧holderが新しい所有者のleaseを消すことはない。
      // 開けずに帰ると停止時の残留lockになり、再試行と手動公開を塞ぐ。
      if (lease) {
        await releasePublishLease(db, lease.groupId, lease.fence);
      }
    } catch {
      // 解放の失敗は元の失敗を隠さない。期限切れで回収される。
    }
    const classified = classifyRichMenuScheduleError(error);
    if (classified.retryable && attemptCount < RICH_MENU_SCHEDULE_MAX_ATTEMPTS) {
      const recorded = await recordTransient(
        db,
        schedule.id,
        schedule.account_id,
        runId,
        classified.code,
        nextRichMenuScheduleRetryAt(now, attemptCount),
      );
      return recorded ? 'retried' : 'skipped';
    }
    const recorded = await recordPermanent(db, schedule.id, schedule.account_id, runId, classified.code);
    return recorded ? 'failed' : 'skipped';
  };
}

/**
 * 切替前defaultの固定(pin)。初回の切替前だけ書き、再試行は保存値を再利用する。
 * 予約時ではなく実行時に読むため、期間中の管理画面外の変更に影響されない。
 */
async function ensureRestoreDefaultPin(
  db: D1Database,
  schedule: RichMenuScheduleRow,
  deps: RichMenuScheduleExecutorDeps,
): Promise<RestoreDefaultPin | null> {
  const existing = await getScheduleRestoreDefaultPin(db, schedule.id, schedule.account_id);
  if (existing) return existing;
  const currentDefault = await deps.readCurrentDefaultId(schedule);
  const pin: RestoreDefaultPin = currentDefault
    ? { state: 'captured', lineId: currentDefault }
    : { state: 'no_default', lineId: null };
  const pinned = await pinScheduleRestoreDefault(db, schedule.id, schedule.account_id, pin);
  if (!pinned) {
    // 同時実行の狭間で先に固定された。保存値を読み直して使う。
    return getScheduleRestoreDefaultPin(db, schedule.id, schedule.account_id);
  }
  return pin;
}

/**
 * 段階公開の本体。create/upload → pin → journal確定 → 切替 → DB反映 →
 * 旧削除 → 成功記録。開始公開と明示戻し先の復元で共用する。
 * journal確定前の失敗はまだliveでない新メニューだけ消す。
 * 切替失敗は journal を消してから旧LINE状態へ補償し、新メニューを片付ける。
 * journalを残したまま新メニューを消す順番は禁止(再試行が消えたIDへ切替える)。
 */
async function runPhasedPublish(input: {
  db: D1Database;
  schedule: RichMenuScheduleRow;
  now: Date;
  deps: RichMenuScheduleExecutorDeps;
  runId: string;
  kind: 'publish' | 'restore';
  /** 切替対象のgroup。leaseとaliasの持ち主。 */
  targetGroupId: string;
  /** defaultに設定するか(そのgroupのisDefaultForAll相当)。 */
  setDefault: boolean;
  /** 第一段: 新規作成だけ行う。合図を受け取り、工程ごとに担当を確かめる。 */
  createShells: (heartbeat: () => Promise<void>) => Promise<ScheduleShell[]>;
  /** 切替対象の現在page(旧IDとorderIndexの材料)。DB反映前のため旧値のまま。 */
  loadTargetPages: () => Promise<Array<{ id: string; orderIndex: number; lineRichMenuId: string | null }>>;
  /** DB反映: journalのIDをpageへ書き、group状態を進める。札で書込みを守る。 */
  reflect: (shells: ScheduleShell[], fence: PublishLeaseFence) => Promise<void>;
  /** 確定。札(世代)を書込み条件に入れ、負けた旧holderは確定できない。 */
  recordSuccess: (fence: PublishLeaseFence) => Promise<boolean>;
  fail: FailRecorder;
  stats: ExecutionStats;
  /** lease期限に使う実時間。 */
  leaseClock: LeaseClock;
}): Promise<'succeeded' | 'retried' | 'failed' | 'skipped'> {
  const { db, schedule, now, deps, runId, kind, targetGroupId, leaseClock } = input;

  const generation = await acquirePublishLease(db, targetGroupId, runId, leaseClock());
  if (generation === null) return input.fail(publishLeaseTakenError(targetGroupId));
  const fence: PublishLeaseFence = { owner: runId, generation };

  /**
   * 所有の確認と期限の延長。外部工程(LINE呼び出し)とDB書込みの直前に必ず通す。
   *
   * 期限は**そのときの実現在時刻**から延ばす。入口の時刻を使い回すと期限が
   * 前に進まず、長い公開の途中で回収される。予約行の lease も一緒に延ばす
   * (group だけ延ばしても予約行を取られたら所有権を失う)。
   * false は「回収されて別のrunが所有者になった」の合図で、旧holderは
   * ここから先の切替・確定・後片付けをしない(新所有者に任せる)。
   */
  const holdsLease = async (): Promise<boolean> => {
    const leaseNow = leaseClock();
    // group と予約行の両方を延ばせたときだけ続ける。片方でも取られていたら
    // 手を引く。予約行をBが回収したあとにAが副作用を続けないため、
    // renewScheduleLease の戻り値も必ず見る。
    const group = await renewPublishLease(db, targetGroupId, fence, leaseNow);
    const row = await renewScheduleLease(db, schedule.id, schedule.account_id, runId, leaseNow);
    return group && row;
  };

  /** 外部呼び出しの直前に担当を確かめる合図。失権していたら投げて止める。 */
  const heartbeat = async (): Promise<void> => {
    if (!(await holdsLease())) throw publishLeaseTakenError(targetGroupId);
  };

  /**
   * ここから先の失敗は、自分が取ったleaseを札付きで開けてから記録する。
   * 開けずに帰ると期限(10分)まで再試行と手動公開を塞ぐ。
   * 札が合わなければ何も起きない(回収した新しい所有者のleaseは消さない)。
   */
  const fail: FailRecorder = async (error) => {
    try {
      await releasePublishLease(db, targetGroupId, fence);
    } catch {
      // 解放の失敗は元の失敗を隠さない。期限切れで回収される。
    }
    return input.fail(error);
  };

  const loadPrev = async (): Promise<SchedulePreSwitchState> => {
    const pages = await input.loadTargetPages();
    const pin = await getScheduleRestoreDefaultPin(db, schedule.id, schedule.account_id);
    return {
      oldIds: pages.map((page) => ({
        pageId: page.id,
        orderIndex: page.orderIndex,
        lineRichMenuId: page.lineRichMenuId,
      })),
      previousDefaultId: pin?.state === 'captured' ? (pin.lineId ?? null) : null,
    };
  };

  try {
    let journal = await getSchedulePublications(db, schedule.id, kind);
    if (journal.length === 0) {
      // journal未確定の新規実行: 作って→固定して→journalへ残す。
      // LINEへ作る前に所有を確かめる(旧holderがメニューを作り散らさない)。
      if (!(await holdsLease())) return fail(publishLeaseTakenError(targetGroupId));
      const created = await input.createShells(heartbeat);
      // ここから先で失敗したら、まだliveでない新メニューを必ず片付ける。
      // pinの失敗で作りっぱなしにすると、LINE側に参照されないメニューが残る。
      try {
        // pinはjournalより先に固定する。journalあり・pinなしの再開は
        // 切替後の値で固定し直す危険があるため、この順番を守る。
        // 実LINE defaultの読み取りも外部工程なので所有を確かめてから行う。
        if (!(await holdsLease())) throw publishLeaseTakenError(targetGroupId);
        await ensureRestoreDefaultPin(db, schedule, deps);
        // journalは「このrunがLINEへ作った」の確定。書く前に所有を確かめる。
        if (!(await holdsLease())) throw publishLeaseTakenError(targetGroupId);
        await recordSchedulePublications(db, schedule.id, kind, runId, toJournalPages(created));
      } catch (error) {
        // まだliveでない新メニューだけ消す。alias/defaultは触っていない。
        // ここの片付けはleaseを確かめない。自分が作った分の始末なので、
        // 所有を失っていても残すより消すほうが安全(誰も参照していない)。
        try {
          await deps.deleteLineShells(schedule, created.map((shell) => shell.newRichMenuId));
        } catch {
          // 片付けの失敗は元の失敗を隠さない。残留は無害(参照されない)。
        }
        throw error;
      }
      journal = await getSchedulePublications(db, schedule.id, kind);
    }

    // journal確定済み(journal再開を含む): 作り直さず切替えへ進む。
    // journalのIDへ切替えるため、外部成功後DB記録前の停止でも二重作成しない。
    const targetPages = await input.loadTargetPages();
    const byPageId = new Map(targetPages.map((page) => [page.id, page]));
    const shells: ScheduleShell[] = [];
    for (const entry of journal) {
      const current = byPageId.get(entry.page_id);
      if (!current) {
        return fail(
          new Error(`snapshot drift: journal page ${entry.page_id} was deleted, restore target lost`),
        );
      }
      shells.push({
        pageId: entry.page_id,
        orderIndex: current.orderIndex,
        newRichMenuId: entry.line_richmenu_id,
        oldLineRichMenuId: current.lineRichMenuId,
      });
    }

    // 反映前の旧メニューIDをここで控える。反映後にDBを読み直すと新IDに
    // 変わっていて、旧メニューが1つも消えずLINE側に残り続ける。
    const oldIdsBeforeReflect = shells
      .map((shell) => shell.oldLineRichMenuId)
      .filter((id): id is string => !!id)
      // journalの新IDと重なるものは消さない(同ID再利用の安全弁)。
      .filter((id) => !shells.some((shell) => shell.newRichMenuId === id));

    // 外部工程の直前にleaseを延ばす。失っていたら旧holderとして手を引く。
    if (!(await holdsLease())) return fail(publishLeaseTakenError(targetGroupId));

    try {
      await deps.switchLiveTo({
        schedule, groupId: targetGroupId, setDefault: input.setDefault, shells, heartbeat,
      });
    } catch (error) {
      // 切替途中失敗の補償。journalを先に消してから旧へ戻し、新メニューを片付ける。
      // journalを消せなければ補償自体をやめ、journalありの再開に任せる
      // (journalを残して新メニューを消すと再試行が壊れる)。
      try {
        await clearSchedulePublications(db, schedule.id, kind);
      } catch {
        throw error;
      }
      // 補償はleaseを確かめずに必ず行う。自分が変えたlive状態の巻き戻しで、
      // ここで手を引くと切替途中のまま放置される(所有者が代わっても直せない)。
      const prev = await loadPrev();
      const compensation = await deps.compensateSwitchToPrevious({
        schedule,
        groupId: targetGroupId,
        prev,
        newIds: shells.map((shell) => shell.newRichMenuId),
      });
      // defaultを戻し切れていない新メニューは消さない。消すと全友だちの
      // トーク画面からメニューが消える(リンク切れ)。
      await deps.deleteLineShells(
        schedule,
        deletableAfterCompensation(shells, compensation.unrestoredPageIds, compensation.defaultRestore),
      );
      if (compensation.defaultRestore.state === 'failed') {
        input.stats.defaultRestoreIncomplete += 1;
        // 結果と失敗理由の両方へ出す。運用者が「defaultが戻っていない」と
        // 分かるようにし、残した新メニューを手で片付けられるようにする。
        throw new Error(
          `default_restore_incomplete(${compensation.defaultRestore.retainedId ?? 'unknown'}): ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
      throw error;
    }

    // 切替が終わり、旧メニューはaliasから外れた。まだleaseを持っている
    // うちにLINE側の旧メニューを消す。反映(DB)の後に回すと、page行が新IDへ
    // 変わっていて旧IDを引けず、LINE側に参照されないメニューが残り続ける。
    if (oldIdsBeforeReflect.length > 0) {
      if (!(await holdsLease())) return fail(publishLeaseTakenError(targetGroupId));
      await deps.deleteLineShells(schedule, oldIdsBeforeReflect);
    }

    // DB反映の直前にもう一度所有を確認する。
    // 失っていたら手を引く(journalありの再開が反映を終わらせる)。
    if (!(await holdsLease())) return fail(publishLeaseTakenError(targetGroupId));

    await input.reflect(shells, fence);
    // 反映が落ちたときは補償しない。aliasは正しく新IDを向いているので、
    // journalありの再開が反映だけやり直す。

    // 反映(公開確定)は自分のleaseを空けるため、ここから先はrenewでは守れない。
    // 確定は「自分が取ったあと誰もleaseを取っていない」を書込み条件にする
    // (先に確かめてから書くと、その隙間の回収を取りこぼす)。
    const recorded = await input.recordSuccess(fence);
    // 成功後は札付きでleaseを開ける。開けずに帰ると期限(10分)まで
    // 再試行と手動公開を塞ぐ(反映で既に空いていれば何も起きない)。
    try {
      await releasePublishLease(db, targetGroupId, fence);
    } catch {
      // 解放の失敗は成功を隠さない。期限切れで回収される。
    }
    return recorded ? 'succeeded' : 'skipped';
  } catch (error) {
    return fail(error);
  }
}

async function handleOneSchedule(
  db: D1Database,
  schedule: RichMenuScheduleRow,
  now: Date,
  deps: RichMenuScheduleExecutorDeps,
  runId: string,
  stats: ExecutionStats,
  leaseClock: LeaseClock,
): Promise<'succeeded' | 'retried' | 'failed' | 'skipped'> {
  const claimed = await claimRichMenuSchedule(
    db, schedule.id, schedule.account_id, runId, now.toISOString(), leaseClock(),
  );
  if (!claimed) return 'skipped';

  // claim直後の行を読み直す。引数のscheduleはdue取得時の古い写しのため、
  // attemptやrunの判断に使わない（stale再開の完成誤判定を防ぐ）。
  const fresh = await getRichMenuScheduleById(db, schedule.id, schedule.account_id);
  if (!fresh || fresh.status !== 'publishing' || fresh.started_run_id !== runId) {
    return 'skipped';
  }
  // ここでの失敗はまだ lease を取る前(または runPhasedPublish が自分で開ける)。
  // 札を持たない解放はしない。
  const fail = makeFailRecorder(
    db,
    schedule,
    runId,
    now,
    fresh.attempt_count,
    recordRichMenuScheduleTransientFailure,
    recordRichMenuSchedulePermanentFailure,
  );

  try {
    // 実行直前の安全再評価。予約時と変わっていたら出さない。
    const group = await deps.getGroupWithPages(db, schedule.group_id);
    if (!group) return fail(new Error('schedule group not found'));
    if (group.account_id !== schedule.account_id) return fail(new Error('schedule account mismatch'));
    const preconditionError = await checkAccountAndStaff(db, fresh, deps);
    if (preconditionError) return fail(new Error(preconditionError));
    const parsed = parseSnapshot(fresh.definition_snapshot);
    if (!parsed.ok) return fail(new Error(parsed.error));
    if (!snapshotHasPublishablePages(parsed.value)) return fail(new Error('definition_snapshot has no pages'));
    // 予約後の下書き編集・ページ削除のずれ。消えたpageがあれば恒久失敗。
    const drift = detectSnapshotPageDrift(
      parsed.value,
      (group.pages ?? []).map((page) => page.id),
    );
    if (drift) return fail(new Error(drift));

    const outcome = await runPhasedPublish({
      db,
      schedule,
      now,
      deps,
      runId,
      kind: 'publish',
      targetGroupId: fresh.group_id,
      setDefault: isGroupDefaultForAll(group),
      createShells: (heartbeat) => deps.createLineShells(parsed.value, fresh, heartbeat),
      loadTargetPages: async () => {
        const current = await deps.getGroupWithPages(db, fresh.group_id);
        return (current?.pages ?? []).map((page) => ({
          id: page.id,
          orderIndex: page.order_index,
          lineRichMenuId: page.line_richmenu_id,
        }));
      },
      reflect: async (shells, fence) => {
        for (const shell of shells) {
          await setPageRichMenuId(db, shell.pageId, shell.newRichMenuId, fence);
        }
        await markRichMenuGroupPublished(db, fresh.group_id, fence);
      },
      recordSuccess: (fence) =>
        recordRichMenuScheduleSuccess(
          db,
          fresh.id,
          fresh.account_id,
          runId,
          fresh.mode === 'period' ? 'published' : 'completed',
          { groupId: fresh.group_id, generation: fence.generation },
        ),
      fail,
      stats,
      leaseClock,
    });
    return outcome;
  } catch (error) {
    return fail(error);
  }
}

function isGroupDefaultForAll(group: RichMenuGroupWithPages): boolean {
  const value = (group as { is_default_for_all?: unknown }).is_default_for_all;
  return value === 1 || value === true;
}

async function handleOneRestore(
  db: D1Database,
  schedule: RichMenuScheduleRow,
  now: Date,
  deps: RichMenuScheduleExecutorDeps,
  runId: string,
  stats: ExecutionStats,
  leaseClock: LeaseClock,
): Promise<'restored' | 'retried' | 'failed' | 'skipped'> {
  const claimed = await claimRichMenuScheduleRestore(
    db, schedule.id, schedule.account_id, runId, now.toISOString(), leaseClock(),
  );
  if (!claimed) return 'skipped';

  const fresh = await getRichMenuScheduleById(db, schedule.id, schedule.account_id);
  if (!fresh || fresh.status !== 'restoring' || fresh.ended_run_id !== runId) {
    return 'skipped';
  }

  // 期限切れメニューの個別割当をLINE側で外してからD1行を消す。
  // 解除は404許容でidempotentのため、再試行の重ね掛けも安全。
  const unlinkAndClearAssignments = async (): Promise<void> => {
    await deps.unlinkIndividualLinks(fresh);
    await clearRichMenuAssignmentsForGroup(db, fresh.group_id);
  };

  try {
    const preconditionError = await checkAccountAndStaff(db, fresh, deps);
    if (preconditionError) {
      return makeFailRecorder(
        db, schedule, runId, now, fresh.attempt_count,
        recordRichMenuScheduleRestoreTransientFailure,
        recordRichMenuSchedulePermanentFailure,
      )(new Error(preconditionError));
    }
    const scheduledGroup = await deps.getGroupWithPages(db, fresh.group_id);
    if (!scheduledGroup || scheduledGroup.account_id !== fresh.account_id) {
      return makeFailRecorder(
        db, schedule, runId, now, fresh.attempt_count,
        recordRichMenuScheduleRestoreTransientFailure,
        recordRichMenuSchedulePermanentFailure,
      )(new Error('schedule group not found'));
    }

    // 明示の戻し先がある場合は、そのgroupを段階公開で戻す。
    // 戻し先が消える・非公開化は恒久失敗(要対応)に残し、勝手に解除しない。
    if (fresh.restore_group_id) {
      return handleExplicitRestore(db, fresh, now, deps, runId, unlinkAndClearAssignments, stats, leaseClock);
    }
    return handlePinnedRestore(db, fresh, now, deps, runId, unlinkAndClearAssignments, leaseClock);
  } catch (error) {
    return makeFailRecorder(
      db, schedule, runId, now, fresh.attempt_count,
      recordRichMenuScheduleRestoreTransientFailure,
      recordRichMenuSchedulePermanentFailure,
    )(error);
  }
}

/**
 * 明示の戻し先への復元。戻し先groupの現内容を段階公開で出し直す。
 * 戻し先の消失・非公開化は恒久失敗(要対応)で残す。
 */
async function handleExplicitRestore(
  db: D1Database,
  fresh: RichMenuScheduleRow,
  now: Date,
  deps: RichMenuScheduleExecutorDeps,
  runId: string,
  unlinkAndClearAssignments: () => Promise<void>,
  stats: ExecutionStats,
  leaseClock: LeaseClock,
): Promise<'restored' | 'retried' | 'failed' | 'skipped'> {
  const restoreGroupId = fresh.restore_group_id as string;
  // lease は runPhasedPublish が取って自分で開ける。ここでの失敗記録は札なし。
  const fail = makeFailRecorder(
    db, fresh, runId, now, fresh.attempt_count,
    recordRichMenuScheduleRestoreTransientFailure,
    recordRichMenuSchedulePermanentFailure,
  );
  try {
    const restore = await deps.getGroupWithPages(db, restoreGroupId);
    if (!restore || restore.account_id !== fresh.account_id || restore.status !== 'published') {
      return fail(new Error('restoreGroupId must be a published menu'));
    }
    const outcome = await runPhasedPublish({
      db,
      schedule: fresh,
      now,
      deps,
      runId,
      kind: 'restore',
      targetGroupId: restoreGroupId,
      setDefault: isGroupDefaultForAll(restore),
      createShells: (heartbeat) => deps.createRestoreShells(restore, fresh, heartbeat),
      loadTargetPages: async () => {
        const current = await deps.getGroupWithPages(db, restoreGroupId);
        return (current?.pages ?? []).map((page) => ({
          id: page.id,
          orderIndex: page.order_index,
          lineRichMenuId: page.line_richmenu_id,
        }));
      },
      reflect: async (shells, fence) => {
        // 期限切れgroupは戻し先とは別のgroup。こちらにも同じ契約でleaseを取り、
        // 札付きで畳む。leaseなしで畳むと、その期限切れgroupを触っている
        // 別の実行(手動公開・別予約)のownerと期限を消してしまう。
        if (restoreGroupId !== fresh.group_id) {
          const expiringGeneration = await acquirePublishLease(
            db, fresh.group_id, runId, leaseClock(),
          );
          if (expiringGeneration === null) throw publishLeaseTakenError(fresh.group_id);
          const expiringFence: PublishLeaseFence = { owner: runId, generation: expiringGeneration };
          try {
            // 個別割当の解除はLINEを呼ぶ外部工程。直前に実時刻で延ばす。
            if (!(await renewPublishLease(db, fresh.group_id, expiringFence, leaseClock()))) {
              throw publishLeaseTakenError(fresh.group_id);
            }
            await unlinkAndClearAssignments();
            if (!(await renewPublishLease(db, fresh.group_id, expiringFence, leaseClock()))) {
              throw publishLeaseTakenError(fresh.group_id);
            }
            if (!(await markRichMenuGroupUnpublished(db, fresh.group_id, expiringFence))) {
              throw publishLeaseTakenError(fresh.group_id);
            }
          } finally {
            try {
              // 畳めていれば mark 側で空いている。取れなかった経路のための後始末。
              await releasePublishLease(db, fresh.group_id, expiringFence);
            } catch {
              // 解放の失敗は元の結果を隠さない。期限切れで回収される。
            }
          }
        } else {
          // 戻し先が同じgroup。runPhasedPublish が持っている札で足りる。
          await unlinkAndClearAssignments();
        }
        for (const shell of shells) {
          await setPageRichMenuId(db, shell.pageId, shell.newRichMenuId, fence);
        }
        await markRichMenuGroupPublished(db, restoreGroupId, fence);
      },
      recordSuccess: (fence) =>
        recordRichMenuScheduleRestoreSuccess(db, fresh.id, fresh.account_id, runId, {
          groupId: restoreGroupId,
          generation: fence.generation,
        }),
      fail,
      stats,
      leaseClock,
    });
    return outcome === 'succeeded' ? 'restored' : outcome;
  } catch (error) {
    return fail(error);
  }
}

/**
 * 固定した切替前defaultへの復元(365)。
 * capturedは固定メニューへ戻し、消えていたら解除せず恒久失敗に残す。
 * no_defaultだけ明示解除する。両者を混ぜない。
 */
async function handlePinnedRestore(
  db: D1Database,
  fresh: RichMenuScheduleRow,
  now: Date,
  deps: RichMenuScheduleExecutorDeps,
  runId: string,
  unlinkAndClearAssignments: () => Promise<void>,
  leaseClock: LeaseClock,
): Promise<'restored' | 'retried' | 'failed' | 'skipped'> {
  // lease を取る前の失敗は札なしで記録する。取ったあとは fenced に差し替える。
  let lease: { groupId: string; fence: PublishLeaseFence } | undefined;
  const fail: FailRecorder = (error) =>
    makeFailRecorder(
      db, fresh, runId, now, fresh.attempt_count,
      recordRichMenuScheduleRestoreTransientFailure,
      recordRichMenuSchedulePermanentFailure,
      lease,
    )(error);
  try {
    const pin: RestoreDefaultPin | null =
      fresh.restore_default_state === 'captured' || fresh.restore_default_state === 'no_default'
        ? { state: fresh.restore_default_state, lineId: fresh.restore_default_line_id }
        : await getScheduleRestoreDefaultPin(db, fresh.id, fresh.account_id);
    if (!pin) {
      return fail(new Error('no_default_pin: restore default was never pinned, needs attention'));
    }
    const generation = await acquirePublishLease(db, fresh.group_id, runId, leaseClock());
    if (generation === null) return fail(publishLeaseTakenError(fresh.group_id));
    const fence: PublishLeaseFence = { owner: runId, generation };
    lease = { groupId: fresh.group_id, fence };

    /** 外部工程・DB書込みの直前に、実現在時刻で期限を延ばして所有を確かめる。 */
    const holdsLease = async (): Promise<boolean> => {
      const leaseNow = leaseClock();
      // group と予約行の両方を延ばせたときだけ続ける。
      const group = await renewPublishLease(db, fresh.group_id, fence, leaseNow);
      const row = await renewScheduleLease(db, fresh.id, fresh.account_id, runId, leaseNow);
      return group && row;
    };

    if (!(await holdsLease())) return fail(publishLeaseTakenError(fresh.group_id));
    if (pin.state === 'captured') {
      if (!pin.lineId) {
        return fail(new Error('no_default_pin: pinned default id is missing, needs attention'));
      }
      // 固定メニューが消えていたら解除せず恒久失敗。公開中の表示を壊さない。
      await deps.restoreCapturedDefault(fresh, pin.lineId);
    } else {
      await deps.clearAccountDefault(fresh);
    }
    // 個別割当の解除もLINEを呼ぶ外部工程。leaseを持っているうちに済ませる。
    if (!(await holdsLease())) return fail(publishLeaseTakenError(fresh.group_id));
    await unlinkAndClearAssignments();

    if (!(await holdsLease())) return fail(publishLeaseTakenError(fresh.group_id));
    if (!(await markRichMenuGroupUnpublished(db, fresh.group_id, fence))) {
      return fail(publishLeaseTakenError(fresh.group_id));
    }

    // 未公開化は自分のleaseを空けるため、ここから先はrenewでは守れない。
    // 確定は「自分が取ったあと誰もleaseを取っていない」を書込み条件にする。
    const recorded = await recordRichMenuScheduleRestoreSuccess(db, fresh.id, fresh.account_id, runId, {
      groupId: fresh.group_id,
      generation,
    });
    try {
      await releasePublishLease(db, fresh.group_id, fence);
    } catch {
      // 解放の失敗は成功を隠さない。期限切れで回収される。
    }
    return recorded ? 'restored' : 'skipped';
  } catch (error) {
    return fail(error);
  }
}

async function reclaimStaleClaims(
  db: D1Database,
  leaseNowIso: string,
  limit: number,
): Promise<number> {
  // lease期限(UTCのISO8601)で回収する。形式違いの文字列比較はしない。
  // 比べる時刻は claim / renew が刻んだのと同じ実時間の時計から取る。
  const nowIso = leaseNowIso;
  let reclaimed = 0;
  const publishing = await getStalePublishingSchedules(db, nowIso, limit);
  for (const row of publishing) {
    const ok = await reclaimStalePublishingSchedule(db, row.id, row.account_id, nowIso);
    if (ok) reclaimed += 1;
  }
  const restoring = await getStaleRestoringSchedules(db, nowIso, limit);
  for (const row of restoring) {
    const ok = await reclaimStaleRestoringSchedule(db, row.id, row.account_id, nowIso);
    if (ok) reclaimed += 1;
  }
  return reclaimed;
}

export async function processDueRichMenuSchedules(
  db: D1Database,
  deps: RichMenuScheduleExecutorDeps,
  options: {
    now?: Date;
    limit?: number;
    runIdPrefix?: string;
    /**
     * lease の期限に使う実時間。既定は本物の時計。
     * `now` (cron の tick 時刻) は「どの予約が来たか」を決めるためのもので、
     * 処理にかかった実時間は表さないため分けている。
     * 試験は進められる時計を渡して経過を作る。
     */
    clock?: () => Date;
  } = {},
): Promise<RichMenuScheduleProcessResult> {
  const now = options.now ?? new Date();
  const clock = options.clock ?? (() => new Date());
  const leaseClock: LeaseClock = () => clock().toISOString();
  const limit = options.limit ?? 20;
  const result: RichMenuScheduleProcessResult = {
    processed: 0,
    succeeded: 0,
    restored: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    reclaimed: 0,
    defaultRestoreIncomplete: 0,
  };
  const stats: ExecutionStats = { defaultRestoreIncomplete: 0 };

  // staleなclaimを先に戻して永久停止させない。回収後に通常のdue取得へ含める。
  try {
    result.reclaimed = await reclaimStaleClaims(db, leaseClock(), limit);
  } catch (error) {
    console.error('rich-menu schedule reclaim error:', error);
  }

  const due = await getDueRichMenuSchedules(db, now.toISOString(), limit);
  for (const schedule of due) {
    result.processed += 1;
    const runId = `${options.runIdPrefix ?? 'rms'}-${schedule.id}-${Date.now()}`;
    const outcome = await handleOneSchedule(db, schedule, now, deps, runId, stats, leaseClock);
    if (outcome === 'succeeded') result.succeeded += 1;
    else if (outcome === 'retried') result.retried += 1;
    else if (outcome === 'failed') result.failed += 1;
    else result.skipped += 1;
  }

  const restores = await getDueRichMenuScheduleRestores(db, now.toISOString(), limit);
  for (const schedule of restores) {
    result.processed += 1;
    const runId = `${options.runIdPrefix ?? 'rms'}-${schedule.id}-restore-${Date.now()}`;
    const outcome = await handleOneRestore(db, schedule, now, deps, runId, stats, leaseClock);
    if (outcome === 'restored') result.restored += 1;
    else if (outcome === 'retried') result.retried += 1;
    else if (outcome === 'failed') result.failed += 1;
    else result.skipped += 1;
  }

  result.defaultRestoreIncomplete = stats.defaultRestoreIncomplete;
  return result;
}

export { listRichMenuSchedulesByGroup, cancelRichMenuSchedule };

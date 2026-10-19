// ============================================================
// 友だち追加時の配信の振り分け（設計 V2 4-6）
// ============================================================

/**
 * 「はじめての人」をどう見分けるか。
 *
 * 設計の絵は「初回フォロー日が未記録」を既定にしているが、**この環境では
 * 使えない**。マイグレーション 065 が既存の行すべてに初回フォロー日を
 * 埋めたため、未記録の人がもう居ない。既定は `unfollow_count_zero`。
 */
export type FriendAddFirstTimeCriterion =
  | "unfollow_count_zero"
  | "first_followed_at_missing";

/** ①のシナリオをいつ流すか。 */
export type FriendAddTiming =
  /** すぐに配信（1通目が遅延0なら reply で即時に出す） */
  | "immediate"
  /** シナリオの設定どおり（1通目のタイミング指定に従う） */
  | "scenario";

/** ②で何を配信するか。 */
export type FriendAddReturningMode =
  /** 何も送らない */
  | "none"
  /** 別のシナリオを配信する */
  | "other"
  /** はじめての人と同じものを配信する */
  | "same";

/** ②をどこから流すか。 */
export type FriendAddStartPosition =
  /** 最初から */
  | "beginning"
  /** 前回読んだところから（friend_scenarios.current_step_order を引き継ぐ） */
  | "resume";

/**
 * 振り分けと同時に実行すること。
 *
 * **`row` はシナリオのアクションと同じ形。** タグ・友だち情報欄・対応マーク・
 * シナリオ操作・共通情報が、シナリオ側とまったく同じ設定と実行で動く。
 * 以前は `tag` に1つのタグIDを持つだけで、付けることしかできず、
 * フォルダ指定も外すこともできなかった。**同じことを2か所で実装すると、
 * 片方だけ育って必ずずれる**（今夜、一斉配信とシナリオのメッセージ組み立てで
 * 実際に起きた）。
 *
 * `mile` はシナリオ側に無い。友だち追加のときだけ付けたい、という
 * 使い方があるので残す。
 *
 * `tag` は古い形。**読むときに `row` へ直す。**新しく作られることはないが、
 * 既に保存されている設定があるので、消さずに読めるようにしておく。
 */
export type FriendAddAction =
  /** 古い形。読むときに row へ直す。 */
  | { kind: "tag"; tagId: string }
  | { kind: "mile"; amount: number }
  /** シナリオのアクションと同じ。`actionType` と `config` はそちらの定義。 */
  | { kind: "row"; actionType: FriendAddRowActionType; config: unknown };

/** `row` で使えるアクションの種類。シナリオ側と同じ並び。 */
export type FriendAddRowActionType =
  | "tag"
  | "friend_field"
  | "support_mark"
  | "scenario"
  | "common_var";

/** ①または②の設定。 */
export interface FriendAddBranch {
  /** 配信するシナリオ。null は「決めていない」。 */
  scenarioId: string | null;
  actions: FriendAddAction[];
}

/** 画面1枚ぶんの設定。`account_settings.friend_add_routing` に JSON で入る。 */
export interface FriendAddRouting {
  /** ① はじめて友だち追加した人 */
  firstTime: FriendAddBranch & { timing: FriendAddTiming };
  /** ② 以前からの友だち・ブロックを解除した人 */
  returning: FriendAddBranch & {
    mode: FriendAddReturningMode;
    startPosition: FriendAddStartPosition;
  };
  /** ③ 判定の基準 */
  criteria: { firstTime: FriendAddFirstTimeCriterion };
}

export type FriendAddRoutingVersionStatus = "draft" | "published" | "retired";

export type FriendAddRoutingTestStatus = "succeeded" | "failed";

/** 画面が下書き・試験・公開を同じ言葉で扱うための版情報。 */
export interface FriendAddRoutingVersion {
  accountId: string;
  versionId: string;
  versionNumber: number;
  status: FriendAddRoutingVersionStatus;
  routing: FriendAddRouting;
  lastTestStatus: FriendAddRoutingTestStatus | null;
  lastTestedAt: string | null;
  publishedAt: string | null;
}

export interface FriendAddRoutingValidationCheck {
  key: "first_time" | "returning" | "actions" | "duplicate_prevention";
  label: string;
  status: "passed" | "warning" | "failed";
  detail: string;
}

export interface FriendAddRoutingValidation {
  canPublish: boolean;
  /** 公開前に確認できた、選択中LINEアカウントの現在の有効友だち数。 */
  estimatedAudienceCount: number | null;
  checks: FriendAddRoutingValidationCheck[];
  /** 初回と再追加は同じ判定器の排他的な2分岐なので、重複候補は通常0件。 */
  conflicts: Array<{ code: string; message: string }>;
  lastTestStatus: FriendAddRoutingTestStatus | null;
}

export interface FriendAddRoutingDraftTestResult {
  versionId: string;
  displayName: string | null;
  kind: "first_time" | "returning";
  scenarioId: string | null;
  scenarioName: string | null;
  suppressed: boolean;
  actionCount: number;
  /** dry-runなので、登録・配信・タグ付け等の状態変更は常にfalse。 */
  stateChanged: false;
}

export interface FriendAddRoutingPublishResult {
  accountId: string;
  versionId: string;
  versionNumber: number;
  publishedAt: string;
  estimatedAudienceCount: number | null;
  duplicatePrevention: "webhook_event";
  /** 実行結果画面が接続済みのときだけ導線を返す。未接続を404のリンクにしない。 */
  monitoringPath: "/friend-add-settings/runs" | null;
  monitoringUnavailableReason: string | null;
}

/**
 * 既定値。**設定が無いアカウントはここに落ちる。**
 *
 * `returning.mode` を `same` にしてあるのは、**いまの挙動を変えないため**。
 * 設定を入れる前は「相手によらず friend_add シナリオが全部動く」ので、
 * 既定を `none` にすると、設定していないアカウントで配信が止まる。
 */
export const FRIEND_ADD_ROUTING_DEFAULT: FriendAddRouting = {
  firstTime: { scenarioId: null, timing: "immediate", actions: [] },
  returning: {
    scenarioId: null,
    mode: "same",
    startPosition: "beginning",
    actions: [],
  },
  criteria: { firstTime: "unfollow_count_zero" },
};

/** の友だち追加履歴。Pencil共通デザインはこの契約だけを見て描画する。 */
export type FriendAddEventKind = "first_time" | "returning";

export type FriendAddEventAttributionStatus = "captured" | "unavailable";

export type FriendAddEventRoutingStatus = "pending" | "completed" | "failed" | "suppressed" | "partial_failed";

export interface FriendAddEventItem {
  id: string;
  friendId: string;
  displayName: string | null;
  pictureUrl: string | null;
  kind: FriendAddEventKind;
  /** LINEの参考値。正確な初回・再追加判定には使わない。 */
  isUnblockedHint: boolean | null;
  attributionStatus: FriendAddEventAttributionStatus;
  refCode: string | null;
  entryRouteId: string | null;
  entryRouteName: string | null;
  routingStatus: FriendAddEventRoutingStatus;
  occurredAt: string;
  processedAt: string | null;
}

export interface FriendAddEventSummary {
  total: number;
  firstTime: number;
  returning: number;
  captured: number;
  unavailable: number;
  pending: number;
  failed: number;
}

export interface FriendAddEventList {
  items: FriendAddEventItem[];
  summary: FriendAddEventSummary;
  nextCursor: string | null;
}

/** 見た目から独立した画面状態。の共通スケルトン・空表示・エラー表示へ対応する。 */
export type FriendAddEventViewState =
  | { status: "loading" }
  | { status: "empty"; summary: FriendAddEventSummary }
  | { status: "ready"; data: FriendAddEventList }
  | { status: "error"; message: string };

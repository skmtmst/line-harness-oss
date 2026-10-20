import type { FormSubmission, FormDestinationWriteStatus } from '../form-submission-types.js';

// =============================================================================
// Forms — Survey / questionnaire system (L社 回答フォーム equivalent)
// =============================================================================

export interface Form {
  id: string;
  name: string;
  description: string | null;
  fields: string; // JSON string of FormField[]（layout から作り直す互換用）
  /** 回答フォームの中身。FormLayout の JSON。NULL なら fields だけのフォーム */
  layout: string | null;
  on_submit_tag_id: string | null;
  on_submit_scenario_id: string | null;
  on_submit_message_type: 'text' | 'flex' | null;
  on_submit_message_content: string | null; // supports template variables: {{name}}, {{auth_url:CHANNEL_ID}}, etc.
  on_submit_webhook_url: string | null;
  on_submit_webhook_headers: string | null;
  on_submit_webhook_fail_message: string | null;
  save_to_metadata: number;
  is_active: number;
  status: 'active' | 'archived';
  archived_at: string | null;
  revision: number;
  /** 編集の版(#723 / migration 379)。updateForm だけが増やす。 */
  content_revision: number;
  /** お客さまへ出している不変版。NULL は一度も公開していない下書き。 */
  current_published_version_id: string | null;
  /** フォルダ所属(N-175 / migration 395)。NULL は未分類。 */
  folder_id: string | null;
  /** 管理画面の取得時だけ入る、現在公開版の元になった編集版。 */
  published_content_revision?: number | null;
  submit_count: number;
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface FriendFormSubmission extends FormSubmission {
  form_name: string;
  form_fields: string;
}

export interface FormUsedByAccount {
  id: string;
  name: string;
  country: string | null;
  displayOrder: number;
  count: number;
}

export interface FormWithStats extends Form {
  last_submitted_at: string | null;
  used_by_accounts: FormUsedByAccount[];
  account_scope_review_required: boolean;
  /**
   * P（一覧の数）：日本時間の1日から数えた今月の回答完了数・開いた人数・完了率。
   * 試しは入れない。開いた人数が 0 のとき完了率は null（「—」と出す）。
   */
  monthly_submit_count: number;
  monthly_open_count: number;
  monthly_completion_rate: number | null;
  /**
   * ★V8 一覧の「後処理の未完」の札：後処理が失敗したか、進行中のまま
   * 止まった回答の数。工程ごとの未完は回答1件ごとの組み立てが要るので、
   * 一覧では「止まった予約を持つ回答の数」で近似する(再実行の可否は
   * 回答一覧が行ごとに正確に判定する)。回答の保存前に止まった予約は
   * 数えない(回答一覧に行が無く、運用者が手を出せないため)。
   */
  pending_post_action_count: number;
}

export interface FormAccountScope {
  /** 復元用一覧だけアーカイブを取得する。既定は通常一覧。 */
  status?: 'active' | 'archived';
  lineAccountIds?: string[];
  includeUnassigned?: boolean;
  /** N-175 (#805): 指定フォルダだけに絞る。 */
  folderId?: string;
  /** N-175 (#805): 未分類(f.folder_id IS NULL)だけに絞る。 */
  unfiledOnly?: boolean;
}

export interface PublishedFormVersion {
  id: string;
  form_id: string;
  version_number: number;
  source_content_revision: number;
  published_at: string;
}

export type PublishFormVersionResult =
  | { kind: 'published'; version: PublishedFormVersion; replayed: boolean; form: Form }
  | { kind: 'not_found' }
  | { kind: 'conflict'; form: Form };

/**
 * バージョン1行の中身(N-168)。
 *
 * 失敗した後処理の再実行は、回答が作られた当時の版の定義
 * (fields/layout/後処理の指定)をそのまま使う。回答が持つ
 * `form_version_id` からここで引き直す。
 */
export interface FormVersionContent {
  id: string;
  form_id: string;
  name: string;
  description: string | null;
  fields: string;
  layout: string | null;
  on_submit_tag_id: string | null;
  on_submit_scenario_id: string | null;
  on_submit_message_type: 'text' | 'flex' | null;
  on_submit_message_content: string | null;
  on_submit_webhook_url: string | null;
  on_submit_webhook_headers: string | null;
  on_submit_webhook_fail_message: string | null;
  save_to_metadata: number;
}

export type FormDeleteReference = {
  kind: 'webinar' | 'rich_menu';
  name: string | null;
  href: string | null;
  state: 'available' | 'unavailable';
};

export type FormDeleteImpact = {
  form: {
    id: string;
    name: string;
    isActive: boolean;
    status: 'active' | 'archived';
  };
  submissionCount: number;
  openCount: number;
  references: FormDeleteReference[];
  referenceCount: number;
  answerUrl: string | null;
  revision: number;
  /** 編集の版(#723)。受付停止など updateForm を通る操作がこれを送る。 */
  contentRevision: number;
  checkedAt: string;
  canDelete: boolean;
  canArchive: boolean;
  recommendedAction: 'delete' | 'archive' | 'none';
  blockers: Array<'published' | 'has_submissions' | 'has_opens' | 'in_use' | 'already_archived'>;
};

export type FormImpactRow = Pick<Form,
  'id' | 'name' | 'is_active' | 'status' | 'revision' | 'content_revision' | 'current_published_version_id'
>;
export type FormImpactReferenceRow = {
  kind: FormDeleteReference['kind'];
  name: string | null;
  href: string | null;
};

export interface CreateFormInput {
  name: string;
  description?: string | null;
  fields: string; // JSON string
  layout?: string | null;
  onSubmitTagId?: string | null;
  onSubmitScenarioId?: string | null;
  onSubmitMessageType?: 'text' | 'flex' | null;
  onSubmitMessageContent?: string | null;
  onSubmitWebhookUrl?: string | null;
  onSubmitWebhookHeaders?: string | null;
  onSubmitWebhookFailMessage?: string | null;
  saveToMetadata?: boolean;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImageUrl?: string | null;
  /** 新規作成画面から作る空レコードは公開しない。未指定は既存互換で公開中。 */
  isActive?: boolean;
  /** 明示したLINE公式アカウントだけで利用する。 */
  lineAccountIds?: string[];
}

export interface UpdateFormInput {
  folderId?: string | null;
  name?: string;
  description?: string | null;
  fields?: string;
  layout?: string | null;
  onSubmitTagId?: string | null;
  onSubmitScenarioId?: string | null;
  onSubmitMessageType?: 'text' | 'flex' | null;
  onSubmitMessageContent?: string | null;
  onSubmitWebhookUrl?: string | null;
  onSubmitWebhookHeaders?: string | null;
  onSubmitWebhookFailMessage?: string | null;
  saveToMetadata?: boolean;
  isActive?: boolean;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImageUrl?: string | null;
}

/**
 * 編集保存の結果。**競合と「見つからない」を分ける。**
 *
 * 呼び出し口が 409 と 404 を撃ち分けられないと、運用者に「ほかの人が先に
 * 保存した」のか「フォームが消えた」のかが届かない。
 */
export type UpdateFormResult =
  | { kind: 'updated'; form: Form }
  | { kind: 'not_found' }
  | { kind: 'conflict'; form: Form };

/**
 * フォームの編集保存(#723)。
 *
 * **確認した編集の版(`expectedContentRevision`)と一致するときだけ書く。**
 * 一致しなければ1行も更新せず `conflict` を返す。以前はここが
 * `WHERE id = ?` だけで、2人が同時に編集すると後から保存した人の内容で
 * 黙って上書きされ、先の人の変更は何の断りもなく消えていた。
 *
 * 守るのは `content_revision` で、`revision` ではない。`revision` は
 * migration 259 のトリガが来訪や回答で増やす「削除影響の確認版」なので、
 * 編集の楽観ロックに使うと誰も編集していないのに 409 になる(migration 379)。
 *
 * 送られなかった項目は**いま DB にある値**で埋める。版を条件に入れたので、
 * 読んだあと書くまでのあいだに誰かが書いていれば1行も更新されない。
 * つまりこの読み直し＋書き戻しは、版の確認とセットで初めて安全になる。
 */
export interface FormLatestEdit {staffId:string;staffName:string;savedAt:string}

export interface FormSubmissionPage {
  items: Array<FormSubmission & { friend_name: string | null }>;
  total: number;
  page: number;
  limit: number;
}

export interface CreateFormSubmissionInput {
  formId: string;
  formVersionId?: string | null;
  friendId?: string | null;
  data: string; // JSON string
  /** P（試し回答）：true は公開前の試し。集計に入れず、後処理もしない。 */
  isTest?: boolean;
  /** Privately uploaded files claimed atomically with this answer. */
  fileIds?: string[];
}

export interface FormDestinationWriteResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

export interface FormDateFieldAnalytics {
  key: string;
  label: string;
  answered: number;
  uniqueFriends: number;
  minDate: string | null;
  maxDate: string | null;
}

export interface FormRatingFieldAnalytics {
  key: string;
  label: string;
  answered: number;
  average: number | null;
}

export interface FormSubmissionAnalytics {
  startedUnique: number;
  submitted: number;
  completionRate: number | null;
  destinationWrites: Record<FormDestinationWriteStatus, number>;
  dateAnsweredUniqueFriends: number;
  dateFields: FormDateFieldAnalytics[];
  ratingFields: FormRatingFieldAnalytics[];
}

export interface FormSubmitClaimScope {
  tenantId: string;
  lineAccountId: string;
  formId: string;
  friendId: string;
  key: string;
}

export interface CreateFormSubmitClaimInput extends FormSubmitClaimScope {
  requestHash: string;
  /**
   * 確保する回答行の id。予約時に採番して予約行へ書き込み、回答の保存と
   * 再開時の読み返しを同じ id で行う(二重保存を防ぐ)。
   */
  submissionId: string;
  owner: string;
  expiresAt: string;
}

// ── Webhook 配達の durable outbox ────────────────────────────────────────
// 外部 Webhook は呼んでから結果を残すまでに落ちると再開時に呼び直しに
// なる。呼ぶ前に安定した event_id で意図行を作り、配達の結果ごと残す。
// 呼び直しも同じ event_id を送るので、受け側は重複を除ける。

export type FormSubmitOutboxStatus = 'pending' | 'delivered' | 'failed';

export interface FormSubmitOutboxEvent {
  tenant_id: string;
  line_account_id: string;
  form_id: string;
  friend_id: string;
  idempotency_key: string;
  kind: string;
  event_id: string;
  status: FormSubmitOutboxStatus;
  payload: string | null;
  created_at: string;
  updated_at: string;
}

// ── 試し合言葉（P：公開前の試し） ─────────────────────────────────────
//
// 公開前の下書きを、お客さま画面で試すための合言葉。生の値は保存せず、
// SHA-256 の16進だけを残す。試しで開く・答えるたびに期限を見る。
// 試しの行（is_test=1）は集計・一覧・書き戻しのどこにも出さない。

export interface FormTestToken {
  id: string;
  form_id: string;
  token_hash: string;
  created_by_staff_id: string | null;
  expires_at: string;
  created_at: string;
}

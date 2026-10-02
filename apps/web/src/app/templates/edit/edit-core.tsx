/*
 * テンプレートの作る・編集の共有ロジック。★V7 の edit/page.tsx と
 * ★V8 の edit-v8.tsx が同じ正本を見るための共有モジュール。
 * （page.tsx は Next.js の決まりで自由な export を持てない）
 */
import Link from 'next/link'
import { api, ApiError, describeSaveFailure } from '@/lib/api'
import { validateFlexContent } from '@line-crm/shared'
import type { TemplateDetailData } from '../template-detail-data'
import type { TemplateReferences } from '@/components/templates/message-template-editor'

export interface ReferenceLoaders {
  friendFields: (accountId: string) => ReturnType<typeof api.friendFields.list>
  commonVars: (accountId: string) => ReturnType<typeof api.commonVars.list>
}

export async function loadTemplateReferences(
  accountId: string,
  loaders: ReferenceLoaders = {
    friendFields: (id) => api.friendFields.list(id, undefined, { suppressFeatureDisabledEvent: true }),
    commonVars: (id) => api.commonVars.list(id, undefined, { suppressFeatureDisabledEvent: true }),
  },
): Promise<TemplateReferences> {
  /*
    友だち情報・共通情報は任意機能。機能オフの403でテンプレート編集そのものを
    止めないよう、その失敗だけ「候補なし」として扱う。
  */
  const emptyOnDisabled = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'FEATURE_DISABLED') {
      return { success: true as const, data: [] }
    }
    throw error
  }
  const [fieldResponse, varResponse] = await Promise.all([
    loaders.friendFields(accountId).catch(emptyOnDisabled),
    loaders.commonVars(accountId).catch(emptyOnDisabled),
  ])
  if (!fieldResponse.success || !varResponse.success) {
    throw new Error('差し込み項目を読み込めませんでした')
  }
  return {
    friendFields: fieldResponse.data.filter((field) => field.canInsertText !== false),
    commonVars: varResponse.data,
  }
}

/**
 * 編集画面が見ている LINE 公式アカウントの組み合わせ。
 *
 * 「上のバーで選んでいるもの」と「開いているテンプレートの所属」は別物。
 * この2つを1つの変数で扱うと、切り替えた瞬間に取り違える。
 */
export interface TemplateAccountBinding {
  templateId: string | null
  /**
   * **いま画面にある中身が、その `templateId` のものとして確定しているか。**
   *
   * `ready` 以外は、所属アカウントも本文も、この id のものだと言えない。
   * URL の id を A から B へ替えた直後がまさにそれで、画面には A の本文が
   * 残ったまま送り先だけ B になっている。
   */
  templateStatus: TemplateLoadStatus
  templateAccountId: string | null
  selectedAccountId: string | null
}

export type TemplateLoadStatus = 'idle' | 'loading' | 'ready' | 'failed'

export const ACCOUNT_MISMATCH_MESSAGE =
  '別のLINE公式アカウントに切り替わっています。上のバーでこのテンプレートのアカウントへ戻すと保存できます。'

export const TEMPLATE_LOAD_FAILED_MESSAGE = '読み込めませんでした。開き直してください。'

export const TEMPLATE_LOADING_MESSAGE =
  'テンプレートを読み込んでいます。読み終わるまで保存できません。'

/**
 * 差し込み候補を読むアカウント。**既存テンプレートは所属へ固定する。**
 *
 * 上のバーで A から B へ替えても、A のテンプレートを開いている限り
 * 候補は A のまま。替えた先の候補を出すと、A のテンプレートへ B の
 * 項目キーを書き込める。書き込めても A の友だちにその項目は無いので、
 * 配信時に `{{field.…}}` が置き換わらないまま相手へ届く。
 *
 * 取得が終わるまでは `null`。終わる前に選択中アカウントで読むと、
 * 一瞬だけ別アカウントの候補が並び、その隙に選べてしまう。
 */
export function resolveEditorAccountId(binding: TemplateAccountBinding): string | null {
  if (!binding.templateId) return binding.selectedAccountId
  if (binding.templateStatus !== 'ready') return null
  // 所属を持たない旧データだけ、選択中アカウントの候補で編集する。
  return binding.templateAccountId ?? binding.selectedAccountId
}

/** 開いているテンプレートの所属と、上のバーの選択が食い違っているか。 */
export function templateAccountMismatch(binding: TemplateAccountBinding): boolean {
  if (!binding.templateId || binding.templateStatus !== 'ready') return false
  if (!binding.templateAccountId || !binding.selectedAccountId) return false
  return binding.templateAccountId !== binding.selectedAccountId
}

/**
 * 保存を閉じる理由。**`null` のときだけ保存の口を開ける。**
 *
 * 中身の入力（名前・本文）とは分けている。こちらは「その中身を、その
 * 送り先へ送ってよいか」の話で、押す前から決まる。押してから知らせる
 * のでは、押せてしまう瞬間があるのと同じ。
 */
export function templateSaveGuard(binding: TemplateAccountBinding): string | null {
  if (binding.templateId) {
    if (binding.templateStatus === 'failed') return TEMPLATE_LOAD_FAILED_MESSAGE
    /*
     * 取得が終わるまで閉じる。**ここが開いていると、A を読んだあと URL を
     * B へ替えた直後に、A の本文を `PUT /api/templates/B` へ送れる。**
     * 送り先だけ先に切り替わり、中身が追いつくまでの間があるため。
     */
    if (binding.templateStatus !== 'ready') return TEMPLATE_LOADING_MESSAGE
  }
  if (templateAccountMismatch(binding)) return ACCOUNT_MISMATCH_MESSAGE
  return null
}

/**
 * 差し込み候補の取り込み。**遅れて届いた古い応答は捨てる。**
 *
 * A から B へ替えると、A への問い合わせのほうが後に返ることがある。
 * 届いた順に入れると、B を編集しているのに A の候補が並ぶ。
 * 出した順番を持ち、いちばん新しい要求以外は結果を返さない。
 *
 * 捨てたときは `null`、読めなかったときは `'failed'`。
 */
export async function requestTemplateReferences(request: {
  load: (accountId: string) => Promise<TemplateReferences>
  accountId: string
  generation: number
  currentGeneration: () => number
}): Promise<TemplateReferences | 'failed' | null> {
  try {
    const references = await request.load(request.accountId)
    return request.generation === request.currentGeneration() ? references : null
  } catch {
    return request.generation === request.currentGeneration() ? 'failed' : null
  }
}

export interface TemplateSaveInput extends TemplateAccountBinding {
  name: string
  category: string
  messageType: string
  messageContent: string
  folderId: string | null
}

/**
 * 保存してよいか。**駄目な理由を返す。`null` なら保存してよい。**
 *
 * 所属と選択の食い違いをここで止める。止めないと、B の候補を挿した本文が
 * A のテンプレートとして保存される。保存する口 (`PUT /api/templates/:id`)
 * は所属アカウントを受け取らないので、サーバー側では気づけない。
 */
export function validateTemplateSave(input: TemplateSaveInput): string | null {
  const guard = templateSaveGuard(input)
  if (guard) return guard
  if (!input.templateId && !input.selectedAccountId) return '上のバーでLINE公式アカウントを選んでください'
  if (!input.name.trim()) return '名前を入力してください'
  if (!input.messageContent.trim()) return '本文を入力してください'
  /*
   * R249: カード型はバブルかカルーセルのJSONでないと保存しない。
   * 通常文のまま保存できると「作れた」と誤認する。保存口も
   * 同じ判定で断るが、ここで先に止めると往復しない。
   */
  const flexError = validateFlexContent(input.messageType, input.messageContent)
  if (flexError) return flexError
  return null
}

export interface TemplateSaveOps {
  create: typeof api.templates.create
  update: typeof api.templates.update
}

/**
 * 保存する。**断る条件に当たったら、APIを一度も呼ばない。**
 *
 * 画面側でボタンを塞ぐだけだと、状態が入れ替わる途中の押下を拾えない。
 * 送る直前に、送り先と中身が同じテンプレートのものか確かめ直す。
 */
export async function saveTemplateEdit(
  input: TemplateSaveInput,
  ops: TemplateSaveOps = { create: api.templates.create, update: api.templates.update },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const blocked = validateTemplateSave(input)
  if (blocked) return { ok: false, error: blocked }

  const payload = {
    name: input.name.trim(),
    category: input.category,
    messageType: input.messageType,
    messageContent: input.messageContent,
    folderId: input.folderId,
  }
  try {
    const res = input.templateId
      ? await ops.update(input.templateId, payload)
      : await ops.create({ accountId: input.selectedAccountId as string, ...payload })
    // ★V8「保存して公開」は保存した id をそのまま公開口へ渡すため返す。
    return res.success ? { ok: true, id: res.data.id } : { ok: false, error: res.error }
  } catch (e) {
    // WRITE-01: 権限不足・所属違い・機能オフの理由が見えるようにする。
    // 内部文（API error: 5xx 等）は画面へ出さない。
    return { ok: false, error: describeSaveFailure(e) }
  }
}

/**
 * 所属アカウントと選択中アカウントが食い違っているときの知らせ。
 *
 * 「保存できません」だけでは戻し方が分からない。どのアカウントのものか、
 * 候補は何のままかを一緒に出す。
 */
export function TemplateAccountNotice({
  binding,
  templateAccountLabel,
  selectedAccountLabel,
}: {
  binding: TemplateAccountBinding
  templateAccountLabel: string | null
  selectedAccountLabel: string | null
}) {
  if (!templateAccountMismatch(binding)) return null
  return (
    <div role="alert" className="border-hairline rounded-control border bg-canvas-sunken px-3 py-2 text-xs">
      <p className="text-danger font-semibold">{ACCOUNT_MISMATCH_MESSAGE}</p>
      <p className="text-ink-secondary mt-1">
        このテンプレートは「{templateAccountLabel ?? binding.templateAccountId}」のものです。
        いま選んでいるのは「{selectedAccountLabel ?? binding.selectedAccountId}」です。
      </p>
      <p className="text-ink-secondary mt-1">
        差し込み候補は「{templateAccountLabel ?? binding.templateAccountId}」のまま出しています。
      </p>
    </div>
  )
}

/**
 * D007/D008: 詳細口の応答の形の番人は `../template-detail-data` に1つだけ
 * （先頭で読み込んでいる）。編集と詳細の両方で同じものを使う。
 * 形が違う応答はここでは受け取らず、「読み込めませんでした」へ回す。
 */

/** 詳細口（GET /api/templates/:id）が返す利用先の形。 */
export type TemplateUsedBy = TemplateDetailData['usedBy']

/**
 * 利用先の1行分（IDEA-11）。
 *
 * 一覧のドロワーと同じ行き先へ揃える。旧形式オートメーションは
 * 開ける画面が無いので、リンクにせずその旨を添える。
 */
export function templateUsageEntries(usedBy: TemplateUsedBy): Array<{
  key: string
  href: string | null
  label: string
}> {
  return [
    ...usedBy.scenarioSteps.map((usage) => ({
      key: `scenario-${usage.stepId}`,
      href: `/scenarios/detail?id=${usage.scenarioId}`,
      label: `シナリオ「${usage.scenarioName}」${usage.stepOrder}通目`,
    })),
    ...usedBy.autoReplies.map((usage) => ({
      key: `auto-reply-${usage.id}`,
      href: `/auto-replies/edit?id=${usage.id}`,
      label: `自動応答「${usage.keyword}」の返信`,
    })),
    ...usedBy.automations.map((usage) => ({
      key: `automation-${usage.id}`,
      href: null,
      label: usage.eventType === 'inbox_favorite'
        ? '受信箱の「よく使う」'
        : `オートメーション「${usage.name}」（旧形式・画面からは開けません）`,
    })),
    ...usedBy.reminderSteps.map((usage) => ({
      key: `reminder-${usage.stepId}`,
      href: `/reminders/edit?id=${usage.reminderId}`,
      label: `リマインダ「${usage.reminderName}」`,
    })),
    // R347: 旧公開版に固定された登録も本文は今のテンプレートを読むため、
    // 変更の影響先に出す。消すのではなく版と状態を添える。
    ...(usedBy.reminderEnrollments ?? []).map((usage) => ({
      key: `reminder-enrollment-${usage.enrollmentId}`,
      href: `/reminders/detail?id=${usage.reminderId}`,
      label: `リマインダ「${usage.reminderName}」第${usage.versionNumber}版（${usage.enrollmentStatus === 'cancelled' ? '取消ずみ' : '送信待ち'}）`,
    })),
    ...usedBy.richMenuAreas.map((usage) => ({
      key: `rich-menu-${usage.areaId}`,
      href: `/rich-menus/edit?id=${usage.groupId}`,
      label: `リッチメニュー「${usage.groupName}」${usage.pageName}`,
    })),
    ...usedBy.trackedLinks.map((usage) => ({
      key: `tracked-link-${usage.id}`,
      href: `/inflow-links/detail?id=${usage.id}`,
      label: `流入リンク「${usage.name}」`,
    })),
  ]
}

/**
 * 「変更の利用先を表示する」（IDEA-11）。
 *
 * 使われているテンプレートを直すとき、保存した内容がどこへ届くかを
 * 保存の手前に出す。出さないと、自動応答やシナリオで使われている
 * 本文が予告なしに差し替わる。
 */
export function TemplateUsageNotice({ usedBy, published }: { usedBy: TemplateUsedBy; published: boolean }) {
  const entries = templateUsageEntries(usedBy)
  return (
    <section
      aria-label="このテンプレートの利用先"
      className="border-hairline rounded-control border bg-canvas-sunken p-4"
    >
      <p className="text-sm font-semibold text-ink">
        この変更が使われる場所（{entries.length}か所）
      </p>
      {entries.length === 0 ? (
        <p className="text-ink-secondary mt-1 text-xs">
          このテンプレートはまだどこからも呼ばれていません。
        </p>
      ) : (
        <>
          {/*
            R237: 保存は下書きの保存で、利用先へは公開した内容だけが届く。
            「保存するとそのまま使われる」と書くと、未公開のまま利用先が
            変わると誤解する。公開の場所（一覧の詳細パネル）も名指しする。
          */}
          <p className="text-ink-secondary mt-1 text-xs">
            {published
              ? '保存は下書きの保存です。利用先へ反映するには、一覧の詳細パネルから公開してください。内容を確認してから保存してください。'
              : 'このテンプレートはまだ公開していません。保存しただけでは利用先へ反映されません。一覧の詳細パネルから公開すると、利用先へ新しい内容が使われます。'}
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {entries.map((entry) => (
              <li key={entry.key}>
                {entry.href ? (
                  <Link href={entry.href} className="text-action underline">
                    {entry.label}
                  </Link>
                ) : (
                  <span className="text-ink-secondary">{entry.label}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/** 編集中の中身。テンプレート1件分の下書き。 */
export interface TemplateDraft {
  name: string
  category: string
  folderId: string | null
  messageType: string
  messageContent: string
}

/**
 * 画面が持つ「テンプレート1件分」の状態。
 *
 * **`requestedId` と中身を必ず一緒に動かす。** 別々の `useState` に置くと、
 * URL の id だけ先に変わり、中身が前のテンプレートのまま残る瞬間ができる。
 * その瞬間に保存すると、前のテンプレートの本文が新しい id へ入る。
 */
export interface TemplateEditorState {
  requestedId: string | null
  status: TemplateLoadStatus
  templateAccountId: string | null
  /** R237: 公開版の版番号。未公開は0。保存と公開の説明を分けるために持つ。 */
  publishedVersion: number | null
  draft: TemplateDraft
  /**
   * 詳細口が返した利用先（IDEA-11）。未取得は null。
   * 0件（どこからも呼ばれていない）と区別するため、配列と null を分ける。
   */
  usedBy: TemplateUsedBy | null
}

export function newTemplateEditorState(templateId: string | null, visual: boolean): TemplateEditorState {
  return {
    requestedId: templateId,
    status: templateId ? 'loading' : 'idle',
    templateAccountId: null,
    publishedVersion: null,
    usedBy: null,
    draft: {
      name: visual ? '定期便 初回のご案内' : '',
      // category は旧一覧との互換用に保存だけ続ける。分け方は folderId に一本化する。
      category: 'general',
      folderId: null,
      messageType: 'text',
      messageContent: visual
        ? '{{name}}さん、いつもありがとうございます。\n初回のお届け予定はこちらです。\nhttps://example.co.jp/first-delivery'
        : '',
    },
  }
}

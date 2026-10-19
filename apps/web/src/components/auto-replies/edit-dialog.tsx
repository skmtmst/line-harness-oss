'use client'

import { readLineImageContent } from './edit-dialog-model'

import { AutoReplyBasicFields } from './edit-dialog-basic'
import { detectMode,Props,ResponseMode } from './edit-dialog-model'
import { AutoReplyResponseFields } from './edit-dialog-response'
import { saveAutoReplyDialog } from './edit-dialog-save'
import { AutoReplyTriggerFields } from './edit-dialog-trigger'
export { toDraft,toVersionDraft,type AutoReplyDraft,type AutoReplyOrderHint } from './edit-dialog-model'

import { responseTypeWord } from '@/v8/auto-replies/public/auto-reply-words/index'
import Button from '@/components/shared/button'
import Disclosure from '@/components/shared/disclosure'
import LinePreview from '@/components/shared/line-preview'
import Notice from '@/components/shared/notice'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import StickyBar from '@/components/shared/sticky-bar'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { type SegmentCondition } from '@/lib/segment-condition'
import { X } from 'lucide-react'
import { useCallback,useEffect,useState } from 'react'
import {
applyMatchType,
initialMatchType,
readInlineActions,
readKeywordRules,
type HolidayRuleValue,
type InlineAction,
type KeywordRuleDraft
} from './draft-fields'
import { useActionOptions } from './inline-action-list'

/*
 * 選択肢ボタンの見た目（U076）。
 *
 * 明るい緑（#06c755）に白い小文字はコントラスト 2.26:1 で読めない。
 * 曜日チップと同じ「淡い緑＋濃い文字＋枠」に寄せ、太字と `aria-pressed` で
 * 色以外でも選択状態を伝える。未選択側も透明な枠を持たせて、
 * 選択時に寸法が動かないようにする。
 *
 * ※ className は各ボタンへ直接書く。関数へ逃がすと静的に読めない
 *   className（design-debt の未解決）として数えられる。
 */

export default function EditDialog({
  draft,
  templates,
  onClose,
  onSaved,
  page = false,
  step = 'basic',
  onStepChange,
  orderHint = null,
}: Props) {
  const [keyword, setKeyword] = useState(draft.keyword)
  /*
   * R29: 開いたときは「効いている当て方」（保存された行があれば行）を出す。
   * 行だけ古いまま選んだことにならないよう、選び直したら全行へ載せる。
   */
  const [matchType, setMatchType] = useState<'exact' | 'contains'>(() =>
    initialMatchType(draft),
  )
  const changeMatchType = (next: 'exact' | 'contains') => {
    setMatchType(next)
    setKeywordRules((current) => applyMatchType(current, next))
  }
  const [mode, setMode] = useState<ResponseMode>(detectMode(draft))
  const [templateId, setTemplateId] = useState<string | null>(draft.templateId)
  const [responseContent, setResponseContent] = useState(draft.responseContent)
  const [isActive, setIsActive] = useState(draft.isActive)
  /* #975 U059: 390pxでプレビューが保存操作を遠ざけないよう、狭い幅では折り畳む。 */
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false)
  const [activeFrom, setActiveFrom] = useState(draft.activeFrom ?? '')
  const [activeUntil, setActiveUntil] = useState(draft.activeUntil ?? '')
  const [cooldown, setCooldown] = useState(
    draft.cooldownMinutes == null ? '' : String(draft.cooldownMinutes),
  )
  const [skipWhenOperatorActive, setSkipWhenOperatorActive] = useState(
    draft.skipWhenOperatorActive ?? false,
  )
  /*
   * R28: 順番の数字は窓の中では変えず、そのまま送り返す。順番を変えるのは
   * 一覧の上下入れ替えだけ。保存時に値を落とすと並びが崩れるので残す。
   */
  const [priority] = useState(String(draft.priority ?? 0))
  const [messageKinds, setMessageKinds] = useState<string[]>(draft.messageKinds ?? [])
  const [receiveSources, setReceiveSources] = useState<Array<'line' | 'email'>>(
    draft.receiveSources?.length ? draft.receiveSources : ['line'],
  )
  const [keywordRules, setKeywordRules] = useState<KeywordRuleDraft[]>(() =>
    readKeywordRules(draft),
  )
  const [weekdays, setWeekdays] = useState<number[]>(draft.responseWeekdays ?? [])
  /*
   * R252: 最後の曜日を外そうとしたときに欄の下で出す理由。
   * 選び直したら消える（残り続けると次の操作の説明に見える）。
   */
  const [weekdayNotice, setWeekdayNotice] = useState<string | null>(null)
  const [holidayRule, setHolidayRule] = useState<HolidayRuleValue>(
    (draft.responseHolidayRule as HolidayRuleValue) ?? 'ignore',
  )
  const [oncePerFriend, setOncePerFriend] = useState(draft.oncePerFriend ?? false)
  const [respondToAll, setRespondToAll] = useState(draft.respondToAll ?? false)
  const [ruleName, setRuleName] = useState(draft.name ?? '')
  const [keywordMatchMode, setKeywordMatchMode] = useState<'any' | 'all'>(
    draft.keywordMatchMode ?? 'any',
  )
  const [folderId, setFolderId] = useState(draft.folderId ?? '')
  const [internalMemo, setInternalMemo] = useState(draft.internalMemo ?? '')
  const [replyDelaySeconds, setReplyDelaySeconds] = useState(
    draft.replyDelaySeconds == null ? '0' : String(draft.replyDelaySeconds),
  )
  const [unmatchedMode, setUnmatchedMode] = useState<'none' | 'notify_operator'>(
    draft.unmatchedAction?.type === 'notify_operator' ? 'notify_operator' : 'none',
  )
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([])
  const [foldersLoadState, setFoldersLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [foldersReloadToken, setFoldersReloadToken] = useState(0)
  const [actions, setActions] = useState<InlineAction[]>(() => readInlineActions(draft.actions))
  const [friendConditions, setFriendConditions] = useState<SegmentCondition | null>(
    (draft.friendConditions as SegmentCondition | null) ?? null,
  )
  const [friendConditionOpen, setFriendConditionOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  /*
   * m26c R551: 下書き保存の競合（409）で、先行内容との比較と読み直しの
   * 導線を出す。入力は保持し、読み直すまで消さない。
   * m26c R569: 公開中ルールの一覧編集は下書きへ保存される。稼働中は
   * 無変更なので、公開フローへ案内する。
   */
  const [conflictInfo, setConflictInfo] = useState<{
    keyword: string
    responseContent: string
  } | null>(null)
  const [draftSaved, setDraftSaved] = useState(false)
  /*
   * m26c R570: 新規作成の確認キーは窓ごとに1つ振り、窓を閉じるまで変えない。
   * 成功の応答を失って同じ窓から送り直しても同じキーになり、二重に作らない。
   */
  const [createKey] = useState(() => crypto.randomUUID())
  // アクションで選ぶもの（タグ・友だち情報・対応マーク・シナリオ・共通情報）。
  const actionOptions = useActionOptions()
  // 一覧内で開く編集窓は共通のoverlay制御へ寄せる。Escape・Tab循環・背景
  // スクロール停止・閉じたあとのフォーカス復元を同じ作法にする。保存中の
  // 閉鎖抑止は closeDisabled に渡さずここで判定する。そうしないと保存状態の
  // 切替で共通hookがcleanupされ、開いた起点への復元先を失ってしまう。
  const closeOverlay = useCallback(() => {
    if (!saving) onClose()
  }, [onClose, saving])
  const dialogRef = useOverlayFocus(!page, closeOverlay)

  useEffect(() => {
    let active = true
    setFolders([])
    setFoldersLoadState('loading')
    void api.folders.list('auto_reply')
      .then((res) => {
        if (!active) return
        if (res.success && Array.isArray(res.data)) {
          setFolders(res.data.map((f) => ({ id: f.id, name: f.name })))
          setFoldersLoadState('ready')
        } else {
          setFoldersLoadState('error')
        }
      })
      .catch(() => {
        if (active) setFoldersLoadState('error')
      })
    return () => {
      active = false
    }
  }, [foldersReloadToken])

  const flexTemplates = templates.filter((t) => t.messageType === 'flex')
  const textTemplates = templates.filter((t) => t.messageType === 'text')
  const imageTemplates = templates.filter((t) => t.messageType === 'image')

  const handleSave = () => saveAutoReplyDialog({ actions, activeFrom, activeUntil, cooldown, createKey, draft, folderId, friendConditions, holidayRule, internalMemo, isActive, keyword, keywordMatchMode, keywordRules, matchType, messageKinds, mode, oncePerFriend, onSaved, page, priority, receiveSources, replyDelaySeconds, respondToAll, responseContent, ruleName, setConflictInfo, setDraftSaved, setError, setSaving, skipWhenOperatorActive, templateId, templates, unmatchedMode, weekdays })

  const showBasic = !page || step === 'basic'
  const showTrigger = !page || step === 'trigger'
  const showResponse = !page || step === 'response'
  const conditionWords = keywordRules.filter((item) => item.keyword.trim()).map((item) => item.keyword.trim())
  const conditionSummary = respondToAll
    ? 'すべての受信メッセージ'
    : conditionWords.length > 0
      ? `「${conditionWords.join('」「')}」を${keywordMatchMode === 'all' ? 'すべて含む' : 'いずれか含む'}`
      : 'キーワード未入力'
  const timeSummary = activeFrom || activeUntil
    ? `${activeFrom || '00:00'}〜${activeUntil || '24:00'}`
    : '営業時間内・外の両方'
  const responseSummary = mode === 'silent'
    ? '返信なし・後続処理のみ'
    : mode === 'template'
      ? 'テンプレート'
      : mode === 'inline-image'
        ? '画像'
        : mode === 'inline-flex'
          ? 'リッチメッセージ'
          : 'テキスト'
  const replyDelaySummary = Number(replyDelaySeconds) > 0
    ? `${Number(replyDelaySeconds)}秒後に返信`
    : 'すぐに返信'
  const unmatchedSummary = unmatchedMode === 'notify_operator' ? '担当者へ引き継ぎ' : '何もしない'
  const receiveCount = draft.receiveSourceCounts?.reduce((sum, item) => sum + item.count, 0) ?? null
  // プレビューは保存される内容と同じものを指す。テンプレートならその中身、
  // 画像なら選択したURLを出す（U001/U002）。
  const selectedTemplate =
    mode === 'template' ? templates.find((t) => t.id === templateId) ?? null : null
  const imageContent = mode === 'inline-image' ? readLineImageContent(responseContent) : null
  const flexContentIsJson = (() => {
    if (mode !== 'inline-flex' || !responseContent.trim()) return false
    try {
      JSON.parse(responseContent)
      return true
    } catch {
      return false
    }
  })()
  const moveTo = (next: 'basic' | 'trigger' | 'response') => onStepChange?.(next)
  const stickyActions = (
    <>
      {page ? (
        <>
          <Button type="button" onClick={handleSave} disabled={saving} busy={saving} busyLabel="保存中...">下書きを保存する
          </Button>
          {step === 'basic' && <Button type="button" variant="primary" onClick={() => moveTo('trigger')}>反応条件へ</Button>}
          {step === 'trigger' && <Button type="button" variant="primary" onClick={() => moveTo('response')}>何を返すかへ</Button>}
          {step === 'response' && <Button href={`/auto-replies/publish?id=${draft.id ?? ''}`} variant="primary">競合を確認</Button>}
        </>
      ) : (
        <>
          <Button type="button" onClick={onClose}>キャンセル</Button>
          <Button type="button" variant="primary" onClick={handleSave} disabled={saving} busy={saving} busyLabel="保存中...">保存する
          </Button>
        </>
      )}
    </>
  )

  return (
    <div
      className={page ? 'space-y-4' : 'fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4'}
      data-design-node={page ? step === 'basic' ? 'K7vg2' : step === 'trigger' ? 'nzWIX' : 'ivDoe' : undefined}
      role={page ? undefined : 'presentation'}
      onMouseDown={page ? undefined : (event) => {
        if (event.target === event.currentTarget) closeOverlay()
      }}
    >
      {/*
       * 手順表示（Stepper）は edit/page.tsx が出す。
       * この窓は一覧のダイアログとページの両方で使うため、ここに置くと
       * 手順の無い一覧にも Steps の節が混入する。
       */}
      <div className={page ? 'grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_390px]' : ''}>
      <div
        ref={dialogRef}
        className={page ? 'bg-canvas rounded-card border-hairline w-full border' : 'flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-control bg-canvas shadow-float'}
        role={page ? undefined : 'dialog'}
        aria-modal={page ? undefined : true}
        aria-labelledby={page ? undefined : 'auto-reply-edit-dialog-title'}
        tabIndex={page ? undefined : -1}
      >
        <div className={`border-hairline flex items-start justify-between gap-3 border-b px-5 ${page ? 'py-3' : 'py-4'}`}>
          <div className="min-w-0">
            <h3 id={page ? undefined : 'auto-reply-edit-dialog-title'} className="text-base font-semibold">
              {page
                ? step === 'basic'
                  ? '基本設定'
                  : step === 'trigger'
                    ? 'どんなときに動くか'
                    : '何を返すか'
                : draft.id ? '自動応答編集' : '自動応答を作る'}
            </h3>
            <p className="text-ink-faint mt-1 text-xs leading-relaxed">
              {page
                ? step === 'basic'
                  ? '名前と管理方法を決めて、反応条件へ進みます。'
                  : step === 'trigger'
                    ? '受信した言葉・曜日・時間帯・相手を組み合わせます。'
                    : '返信内容と、応答した後に行う処理を設定します。'
                : '受け取ったメッセージに自動で返します。曜日や時間帯、友だちの条件で出し分けできます。'}
            </p>
          </div>
          {!page ? (
            <button
              type="button"
              onClick={closeOverlay}
              disabled={saving}
              aria-label="閉じる"
              className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken disabled:opacity-50"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          ) : null}
        </div>
        <div className={page ? 'space-y-4 p-4' : 'min-h-0 flex-1 space-y-4 overflow-y-auto p-5'}>
          {showBasic ? (
            <>
          <AutoReplyBasicFields {...{ draft, folderId, folders, foldersLoadState, internalMemo, orderHint, page, ruleName, setFolderId, setFoldersReloadToken, setInternalMemo, setRuleName }} />

          {page ? (
            <>
              <section className="rounded-card border border-hairline p-4">
                {/* 見出しを全幅で取り、操作は下段へ。横並びだと末尾1文字だけ折り返す（U053）。 */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-ink text-lg font-bold">どんなときに動くか</h2>
                    <p className="text-ink-faint mt-1 text-xs">受信した言葉・時間帯・相手で絞ります。</p>
                  </div>
                  <Button type="button" className="shrink-0 self-start" onClick={() => moveTo('trigger')}>反応条件を開く</Button>
                </div>
                <dl className="mt-4 grid gap-3">
                  <div className="rounded-control bg-canvas-sunken p-3"><dt className="text-ink-faint text-xs">受信メッセージ</dt><dd className="text-ink mt-1 text-sm font-medium">{conditionSummary}</dd></div>
                  <div className="rounded-control bg-canvas-sunken p-3"><dt className="text-ink-faint text-xs">時間帯</dt><dd className="text-ink mt-1 text-sm font-medium">{timeSummary}</dd></div>
                </dl>
              </section>
              <section className="rounded-card border border-hairline p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div><h2 className="text-ink text-lg font-bold">ひな形から作る</h2><p className="text-ink-faint mt-1 text-xs">よく使う組み合わせです。選ぶと条件と返信がまとめて入ります。</p></div>
                  <Button href="/templates" className="shrink-0 self-start">ひな形を管理</Button>
                </div>
                <div className="mt-4 divide-y divide-hairline rounded-card border border-hairline">
                  {[
                    ['営業時間外の自動返信', '毎日 21:00〜09:00 に受信', 'テキスト返信＋担当者へ通知'],
                    ['予約変更の受付', '「予約変更」「日程変更」を含む', 'テンプレート送信＋対応マーク'],
                    ['よくある質問への回答', '「営業時間」「場所」「料金」を含む', '回答テンプレート＋タグ付与'],
                  ].map(([name, when, reply]) => (
                    <div key={name} className="grid items-center gap-3 px-4 py-3 text-sm lg:grid-cols-4">
                      <strong>{name}</strong><span className="text-ink-secondary">{when}</span><span className="text-ink-secondary">{reply}</span>
                      <Button type="button" onClick={() => { setRuleName(name); moveTo('trigger') }}>このひな形を使う</Button>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : null}
            </>
          ) : null}

          {showTrigger ? (
            <>
          <AutoReplyTriggerFields {...{ activeFrom, activeUntil, changeMatchType, cooldown, draft, friendConditionOpen, friendConditions, holidayRule, keywordMatchMode, keywordRules, matchType, messageKinds, oncePerFriend, page, receiveSources, respondToAll, setActiveFrom, setActiveUntil, setCooldown, setFriendConditionOpen, setFriendConditions, setHolidayRule, setKeyword, setKeywordMatchMode, setKeywordRules, setMessageKinds, setOncePerFriend, setReceiveSources, setRespondToAll, setSkipWhenOperatorActive, setWeekdayNotice, setWeekdays, skipWhenOperatorActive, weekdayNotice, weekdays }} />
            </>
          ) : null}

          {showResponse ? (
            <>
          <AutoReplyResponseFields {...{ actionOptions, actions, cooldown, draft, flexTemplates, imageContent, imageTemplates, isActive, mode, page, replyDelaySeconds, responseContent, setActions, setCooldown, setIsActive, setMode, setReplyDelaySeconds, setResponseContent, setSkipWhenOperatorActive, setTemplateId, setUnmatchedMode, skipWhenOperatorActive, templateId, templates, textTemplates, unmatchedMode }} />
            </>
          ) : null}
          {error && <p className="text-xs text-danger">{error}</p>}
          {conflictInfo && (
            <Notice tone="warn">
              <p>ほかの担当者の保存が先に入っています。あなたの入力は消えていません。</p>
              <Disclosure size="compact" title="先に保存された内容と比べる">
                <dl className="mt-2 space-y-1 text-xs">
                  <div className="flex gap-2">
                    <dt className="text-ink-faint shrink-0">言葉</dt>
                    <dd className="text-ink font-medium">{conflictInfo.keyword || '—'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-ink-faint shrink-0">返信</dt>
                    <dd className="text-ink whitespace-pre-wrap font-medium">
                      {conflictInfo.responseContent || '—'}
                    </dd>
                  </div>
                </dl>
              </Disclosure>
              <div className="mt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => window.location.reload()}
                >
                  最新の状態を読み直す
                </Button>
              </div>
            </Notice>
          )}
          {draftSaved && draft.id && (
            <Notice
              tone="info"
              message="稼働中の定義は変えていません。下書きに保存しました。競合の確認・テストを経て公開してください。"
              action={
                <Button type="button" href={`/auto-replies/publish?id=${encodeURIComponent(draft.id)}`}>
                  公開フローへ進む
                </Button>
              }
              onClose={() => onSaved()}
            />
          )}
        </div>
        {/* ★V7: 窓の中身だけをスクロールさせ、保存の段は窓の下に固定する。 */}
        {!page && <StickyBar className="mx-5 mb-4 shrink-0" actions={stickyActions} />}
      </div>
      {page && (
        /*
         * #975 U059: 390pxでは、長いプレビューの先に保存があるように見えない
         * よう、設定確認・プレビューはワンタップで開く折り畳みにする。
         * 保存は下部追従バーにあり、スクロールなしで届く。
         * 表示制御は共通部品へ渡せないため、外側の div で xl 以上を隠す。
         */
        <div className="xl:hidden">
          <Button
            variant="secondary"
            className="w-full"
            aria-expanded={mobilePreviewOpen}
            onClick={() => setMobilePreviewOpen((current) => !current)}
          >
            {mobilePreviewOpen ? '届く形と設定の確認を閉じる' : '届く形と設定の確認を見る'}
          </Button>
        </div>
      )}
      {page && (
        <aside className={`flex flex-col gap-3 xl:sticky xl:top-4 ${mobilePreviewOpen ? '' : 'max-xl:hidden'}`}>
          <div style={step === 'basic' ? { minHeight: 298 } : undefined} className={`bg-canvas rounded-card border-hairline border p-4 ${step === 'response' ? 'order-2' : 'order-1'}`}>
            <h3 className="text-ink text-sm font-semibold">
              {step === 'trigger' ? 'この条件の判定' : step === 'response' ? '返信の設定' : '設定内容'}
            </h3>
            <dl className="divide-hairline mt-3 divide-y text-xs">
              <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">状態</dt><dd className="text-ink font-semibold">{isActive ? '有効' : '停止中'}</dd></div>
              {step === 'basic' && (
                <>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">動く順番</dt><dd className="text-ink font-semibold">{orderHint?.position != null && orderHint?.total != null ? `上から ${orderHint.position} 番目` : '一覧の「評価順」のとおり'}</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">過去28日の応答</dt><dd className="text-ink font-semibold">{draft.matchedLast28Days == null ? '—（未取得）' : `${draft.matchedLast28Days}件`}</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">同時に当たるルール</dt><dd className="text-ink font-semibold">{draft.conflictAttentionCount == null ? '—（未取得）' : draft.conflictAttentionCount === 0 ? 'なし' : `${draft.conflictAttentionCount}件`}</dd></div>
                </>
              )}
              {step === 'trigger' && (
                <>
                  <div className="py-3"><dt className="text-ink-faint">受信メッセージ</dt><dd className="text-ink mt-1 font-medium">{conditionSummary}</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">曜日・時間</dt><dd className="text-ink font-semibold">{timeSummary}</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">相手</dt><dd className="text-ink font-semibold">{friendConditions ? '条件あり' : 'すべての友だち'}</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">28日間の一致</dt><dd className="text-ink font-semibold">{draft.matchedLast28Days == null ? '—（未取得）' : `${draft.matchedLast28Days}件`}</dd></div>
                </>
              )}
              {step === 'response' && (
                <>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">返信</dt><dd className="text-ink font-semibold">{responseSummary}</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">実行すること</dt><dd className="text-ink font-semibold">{actions.length}件</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">連続返信</dt><dd className="text-ink font-semibold">{cooldown ? `${cooldown}分あける` : '制限なし'}</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">待ち時間</dt><dd className="text-ink font-semibold">{replyDelaySummary}</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">対応中のトーク</dt><dd className="text-ink font-semibold">{skipWhenOperatorActive ? '返さない' : '返す'}</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">不一致時</dt><dd className="text-ink font-semibold">{unmatchedSummary}</dd></div>
                </>
              )}
            </dl>
          </div>
          {step !== 'trigger' && (
            <div style={{ minHeight: 388 }} className={step === 'response' ? 'order-1' : 'order-2'}>
            <LinePreview>
              <div className="rounded-card bg-canvas p-4 text-sm leading-relaxed text-ink">
                {mode === 'silent'
                  ? '返信はせず、設定したアクションだけを実行します。'
                  : mode === 'template'
                    ? selectedTemplate
                      ? selectedTemplate.messageType === 'text'
                        ? selectedTemplate.messageContent
                        : `テンプレート「${selectedTemplate.name}」（${responseTypeWord(selectedTemplate.messageType).label}）を送信します。`
                      : 'テンプレートを選ぶと、ここに内容が表示されます。'
                    : mode === 'inline-image'
                      ? imageContent
                        ? (
                          <img
                            src={imageContent.previewImageUrl}
                            alt="返信画像のプレビュー"
                            className="max-h-40 w-full rounded-control object-cover"
                          />
                        )
                        : '画像を選ぶと、ここに表示されます。'
                      : mode === 'inline-flex'
                        ? responseContent.trim()
                          ? flexContentIsJson
                            ? 'カード型メッセージを送信します。'
                            : 'JSON として読めません。このままでは保存できません。'
                          : 'カードの内容（JSON）を入力すると、ここに表示されます。'
                        : responseContent || '返信内容を入力すると、ここに表示されます。'}
              </div>
              {step === 'response' && (
                <div className="rounded-card mt-3 bg-canvas p-3">
                  <p className="text-ink-faint text-micro">表示見本 — ボタン付きメッセージの見え方</p>
                  <div className="mt-2 space-y-1.5" aria-hidden="true">
                    {['予約を確認', '日程を変更', 'キャンセル'].map((label) => (
                      <p
                        key={label}
                        className="border-line-answer text-line-answer rounded-control border py-1.5 text-center text-xs font-medium"
                      >
                        {label}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </LinePreview>
            </div>
          )}
          <div className="order-3 bg-canvas rounded-card border-hairline border p-4 text-xs">
            <p className="text-ink font-semibold">{step === 'trigger' ? '過去28日の受信' : '動作の確認'}</p>
            {step === 'trigger' ? (
              <>
                <p className="text-ink mt-2 text-2xl font-bold tabular-nums">{draft.matchedLast28Days == null ? '—' : `${formatNumber(draft.matchedLast28Days)}件`}</p>
                <p className="text-ink-faint mt-1 leading-relaxed">{receiveCount == null ? '受信総数は未取得です。' : `受信 ${formatNumber(receiveCount)}件の実測集計です。`}</p>
                <p className="text-ink-faint mt-3 leading-relaxed">利用できる条件：タグ・友だち情報・シナリオ・予約・流入経路・対応状況など</p>
              </>
            ) : (
              <p className="text-ink-faint mt-2 leading-relaxed">
                保存後に「競合を確認」へ進むと、同時に当たるルールと実際に優先されるルールを確認できます。
              </p>
            )}
          </div>
        </aside>
      )}
      </div>
      {page && <StickyBar className="sticky bottom-0 z-20 col-span-full shadow-card" actions={stickyActions} />}
    </div>
  )
}

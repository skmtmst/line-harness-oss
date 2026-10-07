'use client'

/*
 * ★V8 外部連携「API 接続」タブ（Pencil `ralAc`）と、発行した直後の窓（`UkZLi`「鍵を発行しました」）。
 *
 * 今までの V8（app/webhooks/apitokens-v8.tsx）の動きを写して、外枠（題・タブ・数の帯）は
 * ほかのタブと同じ shell.tsx で一から書いた。データの口・本人確認・失敗の文は今と同じ。
 * - 鍵の発行は「API 接続の鍵を発行する」→ 発行の窓（名前・できること）→ 発行した鍵の窓（`UkZLi`）。
 * - 平文の鍵は発行・入れ替えの返事にだけ1回乗る。窓を閉じたら二度と出さない。
 * - 止めた鍵は一覧の口が返さないので、「止めている」行と「動かす」は出ない（動かす口も無い）。
 * - 発行・入れ替え・停止は統括だけ（R32）。閲覧のみの人には押せないボタンを置かず、場所だけ空ける。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, KeyRound, LayoutTemplate, MoreHorizontal, Plus, RefreshCw } from 'lucide-react'
import { api, ApiError, type IntegrationApiTokenInfo } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole } from '@/lib/staff-role'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import ActionMenu from '@/components/shared/action-menu'
import ContextMenu, { type ContextMenuItem } from '@/components/shared/context-menu'
import StepUpPrompt, { isStepUpRequired, type StepUpRequest } from '@/components/step-up-prompt'
import {
  ViewerBand,
  WEBHOOKS_DESCRIPTION,
  WebhookBand,
  WebhookTabs,
  overviewBandCells,
  useWebhookOverview,
} from './shell'
import styles from './api-tokens.module.css'

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden' | 'disabled'

/** 読み込み中の骨組みの1行（表と同じ列の幅）。 */
function SkeletonCells({ height, width }: { height: number; width: string }) {
  return (
    <>
      <span className={styles.colName}><Skeleton height={height} width={width} /></span>
      <span className={styles.colScopes}><Skeleton height={height} width={width} /></span>
      <span className={styles.colCreated}><Skeleton height={height} width={width} /></span>
      <span className={styles.colUsed}><Skeleton height={height} width={width} /></span>
      <span className={styles.colState}><Skeleton height={height} width={width} /></span>
    </>
  )
}

const SCOPES = ['tags:read', 'tags:write'] as const
const SCOPE_LABELS: Record<string, string> = {
  'tags:read': 'タグを見る',
  'tags:write': 'タグを付ける',
}

export function scopeLabel(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope
}

/** 作った日は「2026/06/02」、最後に使ったは「9/30 10:02」（絵の書き方）。読めない日時は「—」。 */
export function tokenDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}/${get('month')}/${get('day')}`
}

export function tokenUsedAt(value: string | null): string {
  if (!value) return 'まだ使っていません'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`
}

export default function WebhooksApiTokensV8() {
  usePageTitle('外部連携')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const staffRole = useStaffRole()
  const canManage = staffRole === null || staffRole === 'owner'
  const overview = useWebhookOverview()
  const { selectedAccountId } = useAccount()
  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId
  const loadGenerationRef = useRef(0)

  const [tokens, setTokens] = useState<IntegrationApiTokenInfo[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState('')
  const [scopes, setScopes] = useState<string[]>([...SCOPES])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [issued, setIssued] = useState<{ name: string; token: string; scopes: string[] } | null>(null)
  const [copied, setCopied] = useState(false)
  const [rotateTarget, setRotateTarget] = useState<IntegrationApiTokenInfo | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<IntegrationApiTokenInfo | null>(null)
  const [mutating, setMutating] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  // 右クリックされた行。まだ無ければ先頭の行（Shift+F10 の押し口）。
  const [ctxId, setCtxId] = useState<string | null>(null)
  const ctxToken = tokens.find((token) => token.id === ctxId) ?? tokens[0] ?? null

  // 行の「…」と同じ中身（右クリックでも出す）。止める口しか無いので、名前・できることを変えるは置かない。
  const revokeMenuItemsFor = (token: IntegrationApiTokenInfo): ContextMenuItem[] => [{
    id: 'revoke',
    label: '止める',
    danger: true,
    onSelect: () => {
      setDialogError('')
      setRevokeTarget(token)
    },
  }]

  const load = useCallback(async () => {
    const requestGeneration = ++loadGenerationRef.current
    const requestAccountId = selectedAccountId
    setActionError('')
    if (!requestAccountId) {
      setTokens([])
      setStatus('ready')
      return
    }
    setStatus('loading')
    setLoadError('')
    try {
      const res = await api.webhooks.apiTokens.list(requestAccountId)
      if (loadGenerationRef.current !== requestGeneration || selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        setStatus('error')
        setLoadError(res.error)
        return
      }
      // 止めた鍵は「使っている」と出さない（一覧の口は止めた鍵を返さない決まりだが、混ざっても出さない）。
      setTokens(res.data.filter((item) => !item.revokedAt))
      setStatus('ready')
    } catch (caught) {
      if (loadGenerationRef.current !== requestGeneration || selectedAccountIdRef.current !== requestAccountId) return
      if (caught instanceof ApiError && caught.code === 'FEATURE_DISABLED') {
        setTokens([])
        setStatus('disabled')
        return
      }
      if (caught instanceof ApiError && (caught.status === 403 || caught.status === 404)) {
        setTokens([])
        setStatus('forbidden')
        return
      }
      setStatus('error')
      setLoadError(describeApiFailure(caught, '読み込み'))
    }
  }, [selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  // アカウントを替えたら、前のアカウントの鍵は見せない。
  useEffect(() => {
    setIssued(null)
    setCopied(false)
  }, [selectedAccountId])

  const toggleScope = (scope: string) => {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]))
  }

  const openCreate = () => {
    setName('')
    setNameError('')
    setCreateError('')
    setScopes([...SCOPES])
    setCreateOpen(true)
  }

  const handleCreate = async (stepUpToken?: string) => {
    setCreateError('')
    setNameError('')
    const requestAccountId = selectedAccountId
    if (!requestAccountId) return
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('名前を入力してください')
      return
    }
    if (scopes.length === 0) {
      setCreateError('できることを1つ以上選んでください')
      return
    }
    setCreating(true)
    try {
      const res = await api.webhooks.apiTokens.create(requestAccountId, { name: trimmed, scopes }, stepUpToken)
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        setCreateError(res.error)
        return
      }
      setIssued({ name: res.data.name, token: res.data.token, scopes: res.data.scopes ?? scopes })
      setCopied(false)
      setCreateOpen(false)
      setName('')
      await load()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'webhook.api_token', action: 'API接続の鍵を発行する', retry: (token) => handleCreate(token) })
        return
      }
      if (selectedAccountIdRef.current !== requestAccountId) return
      setCreateError(describeApiFailure(caught, '発行', {
        forbidden: '鍵の発行は統括だけができます。必要なときは統括に頼んでください。',
      }))
    } finally {
      if (selectedAccountIdRef.current === requestAccountId) setCreating(false)
    }
  }

  const handleRotate = async (stepUpToken?: string) => {
    setDialogError('')
    const requestAccountId = selectedAccountId
    if (!requestAccountId || !rotateTarget) return
    setMutating(true)
    try {
      const res = await api.webhooks.apiTokens.rotate(rotateTarget.id, requestAccountId, stepUpToken)
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        setDialogError(res.error)
        return
      }
      setIssued({ name: res.data.name, token: res.data.token, scopes: res.data.scopes ?? rotateTarget.scopes })
      setCopied(false)
      setRotateTarget(null)
      await load()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        const target = rotateTarget
        setStepUp({
          purpose: 'webhook.api_token',
          action: `「${target?.name ?? ''}」の鍵を入れ替える`,
          retry: (token) => handleRotate(token),
        })
        return
      }
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (caught instanceof ApiError && caught.code === 'TOKEN_ROTATE_CONFLICT') {
        setRotateTarget(null)
        setActionError('ほかの操作が先にこの鍵を更新しました。一覧を読み直しました。最新の状態からもう一度お試しください')
        await load()
        return
      }
      setDialogError(describeApiFailure(caught, '入れ替え', {
        forbidden: '鍵の入れ替えは統括だけができます。必要なときは統括に頼んでください。',
      }))
    } finally {
      if (selectedAccountIdRef.current === requestAccountId) setMutating(false)
    }
  }

  const handleRevoke = async (stepUpToken?: string) => {
    setDialogError('')
    const requestAccountId = selectedAccountId
    if (!requestAccountId || !revokeTarget) return
    setMutating(true)
    try {
      const res = await api.webhooks.apiTokens.revoke(revokeTarget.id, requestAccountId, stepUpToken)
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        setDialogError(res.error)
        return
      }
      setRevokeTarget(null)
      await load()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        const target = revokeTarget
        setStepUp({
          purpose: 'webhook.api_token',
          action: `「${target?.name ?? ''}」の鍵を止める`,
          retry: (token) => handleRevoke(token),
        })
        return
      }
      if (selectedAccountIdRef.current !== requestAccountId) return
      setDialogError(describeApiFailure(caught, '停止', {
        forbidden: '鍵の停止は統括だけができます。必要なときは統括に頼んでください。',
      }))
    } finally {
      if (selectedAccountIdRef.current === requestAccountId) setMutating(false)
    }
  }

  const copyIssued = async () => {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued.token)
      setCopied(true)
    } catch {
      // 手で選んで写せるので、失敗しても文は出さない。
    }
  }

  return (
    <ListPage
      boardId="ralAc"
      headingSize="regular"
      title="外部連携"
      description={WEBHOOKS_DESCRIPTION}
      actions={canManage ? <Button href="/webhooks?tab=notify"><LayoutTemplate size={15} aria-hidden="true" />見本から作る</Button> : undefined}
      tabs={<WebhookTabs active="api-tokens" outgoingCount={overview.outgoingCount} incomingCount={overview.incomingCount} />}
      stats={<>
        {!canManage ? <ViewerBand /> : null}
        <WebhookBand
          cells={overviewBandCells({
            outgoing: overview.outgoingCount === null ? null : overview.outgoing,
            incomingCount: overview.incomingCount,
            summary: overview.summary,
          })}
        />
      </>}
      overlays={<>
        <Dialog
          open={createOpen}
          title="API 接続の鍵を発行する"
          designWidth={540}
          confirmLabel="発行する"
          confirmIcon={<KeyRound size={15} />}
          busy={creating}
          error={createError || undefined}
          onConfirm={() => void handleCreate()}
          onCancel={() => { if (!creating) setCreateOpen(false) }}
        >
          <div className={styles.createBody}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="wh-token-name">名前</label>
              <input
                id="wh-token-name"
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                placeholder="例：在庫システム"
                className={styles.input}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? 'wh-token-name-error' : undefined}
              />
              {nameError ? <p id="wh-token-name-error" className={styles.fieldError} role="alert">{nameError}</p> : null}
            </div>
            <fieldset className={styles.field}>
              <legend className={styles.label}>できること</legend>
              <div className={styles.checkRow}>
                {SCOPES.map((scope) => (
                  <Checkbox key={scope} checked={scopes.includes(scope)} onCheckedChange={() => toggleScope(scope)}>
                    {scopeLabel(scope)}
                  </Checkbox>
                ))}
              </div>
            </fieldset>
            <p className={styles.createNote}>発行した鍵は1回だけ表示されます。名前は、どの仕組みに渡した鍵かが分かるように付けます。</p>
          </div>
        </Dialog>

        {/*
          板 `UkZLi`「鍵を発行しました」。発行・入れ替えの直後に1回だけ窓で見せる（閉じると二度と見られない）。
          × と「写したので閉じる」はどちらも閉じるだけ。
        */}
        <Dialog
          open={issued !== null}
          title="鍵を発行しました"
          designWidth={540}
          designTop={220}
          designNode="UkZLi"
          onCancel={() => setIssued(null)}
          footer={(
            <div className={styles.issuedFooter}>
              <Button variant="primary" onClick={() => setIssued(null)}>
                <Check size={15} aria-hidden="true" />写したので閉じる
              </Button>
            </div>
          )}
        >
          {issued ? (
            <div className={styles.issuedBody}>
              <p className={styles.issuedNote}>この鍵は今だけ表示されます。閉じると二度と見られません。安全な場所に写してください。</p>
              <div className={styles.issuedTokenRow}>
                <code className={styles.issuedToken}>{issued.token}</code>
                <Button onClick={() => void copyIssued()}>
                  <Copy size={15} aria-hidden="true" />{copied ? '写しました' : '鍵を写す'}
                </Button>
              </div>
              <p className={styles.issuedMeta} title={issued.name}>
                {`接続の名前：${issued.name}${issued.scopes.length ? ` ・ できること：${issued.scopes.map(scopeLabel).join('・')}` : ''}`}
              </p>
            </div>
          ) : null}
        </Dialog>

        <ConfirmDialog
          open={rotateTarget !== null}
          title={`「${rotateTarget?.name ?? ''}」の鍵を入れ替えますか？`}
          description="今の鍵はすぐ使えなくなり、新しい鍵が1回だけ表示されます。外の仕組みの鍵を新しいものに書き換えるまで、つなぎ先の操作は止まります。"
          confirmLabel="入れ替える"
          busy={mutating}
          error={dialogError}
          onConfirm={() => void handleRotate()}
          onCancel={() => {
            if (mutating) return
            setRotateTarget(null)
            setDialogError('')
          }}
        />
        <ConfirmDialog
          open={revokeTarget !== null}
          title={`「${revokeTarget?.name ?? ''}」の鍵を止めますか？`}
          description="この鍵での外からの操作はすぐ止まります。すでに付けたタグは残ります。この操作は取り消せません。"
          confirmLabel="止める"
          destructive
          busy={mutating}
          error={dialogError}
          onConfirm={() => void handleRevoke()}
          onCancel={() => {
            if (mutating) return
            setRevokeTarget(null)
            setDialogError('')
          }}
        />
        {stepUp ? <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} /> : null}
      </>}
    >
      <div className={styles.body}>
        <div className={styles.createRow}>
          {canManage
            ? <Button variant="primary" onClick={openCreate}><Plus size={15} aria-hidden="true" />API 接続の鍵を発行する</Button>
            : <span className={styles.createSpace} aria-hidden="true" />}
          <span className={styles.spacer} aria-hidden="true" />
          <p className={styles.createRule}>鍵の発行・入れ替え・停止は統括だけができます</p>
        </div>

        <div className={styles.infoBand} role="note">
          <KeyRound size={16} aria-hidden="true" />
          <p>鍵は発行したときに1回だけ表示されます。外の仕組みに書き写してから閉じてください。入れ替えると、今の鍵はすぐ使えなくなります。</p>
        </div>

        {actionError ? <Notice tone="danger">{actionError}</Notice> : null}

        {status === 'loading' ? (
          <div aria-busy="true" aria-label="鍵を読み込んでいます">
            <DelayedSkeleton
              loading
              skeleton={(
                <div className={styles.table} aria-hidden="true">
                  <div className={styles.headRow}>
                    <SkeletonCells height={12} width="50%" />
                  </div>
                  {[0, 1, 2].map((row) => (
                    <div key={row} className={styles.row}>
                      <SkeletonCells height={14} width="70%" />
                    </div>
                  ))}
                </div>
              )}
            />
          </div>
        ) : null}
        {status === 'error' ? (
          <ListState
            kind="error"
            title="鍵を読み込めませんでした"
            description={loadError}
            action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
          />
        ) : null}
        {status === 'forbidden' ? (
          <ListState
            kind="forbidden"
            title="この画面を開く権限がありません"
            description="鍵の棚卸しは統括だけができます。必要なときは統括に頼んでください。"
          />
        ) : null}
        {status === 'disabled' ? (
          <ListState
            kind="empty"
            title="外部連携が止まっています"
            description="鍵の一覧は、外部連携を入れ直すと開けます。止めている間も、外から届く鍵の操作は止まっています。"
          />
        ) : null}
        {status === 'ready' && tokens.length === 0 ? (
          <ListState
            kind="empty"
            title="まだ接続がありません"
            description={canManage ? '「API 接続の鍵を発行する」から最初の鍵を発行してください。' : '鍵の発行は統括だけができます。'}
          />
        ) : null}
        {status === 'ready' && tokens.length > 0 ? (
          <>
            <ContextMenu
              label="鍵の操作"
              items={canManage && ctxToken ? revokeMenuItemsFor(ctxToken) : []}
              shouldOpen={(event) => {
                if (!canManage) return false
                const row = (event.target as HTMLElement).closest('[data-ctx-row]')
                if (!row) return false
                setCtxId(row.getAttribute('data-ctx-row'))
                return true
              }}
            >
              <div className={styles.table} role="table" aria-label="API 接続の鍵">
                <div className={styles.headRow} role="row">
                  <span role="columnheader" className={styles.colName}>名前</span>
                  <span role="columnheader" className={styles.colScopes}>できること</span>
                  <span role="columnheader" className={styles.colCreated}>作った日</span>
                  <span role="columnheader" className={styles.colUsed}>最後に使った</span>
                  <span role="columnheader" className={styles.colState}>状態</span>
                  <span role="columnheader" className={styles.colOps}><span className={styles.srOnly}>操作</span></span>
                </div>
                {tokens.map((token) => {
                  const scopeText = token.scopes.map(scopeLabel).join('・')
                  return (
                    <div key={token.id} className={styles.row} role="row" data-ctx-row={token.id}>
                      <span role="cell" className={styles.colName} title={token.name}>{token.name}</span>
                      <span role="cell" className={styles.colScopes} title={scopeText}>{scopeText}</span>
                      <span role="cell" className={styles.colCreated}>{tokenDate(token.createdAt)}</span>
                      <span role="cell" className={styles.colUsed}>{tokenUsedAt(token.lastUsedAt)}</span>
                      <span role="cell" className={styles.colState}>
                        <span className={styles.pill}><span className={styles.pillDot} aria-hidden="true" />使っている</span>
                      </span>
                      <span role="cell" className={styles.colOps}>
                        {canManage ? (
                          <span className={styles.menuBox}>
                            <Button
                              onClick={() => {
                                setDialogError('')
                                setRotateTarget(token)
                              }}
                            >
                              <RefreshCw size={15} aria-hidden="true" />入れ替える
                            </Button>
                            <Button
                              className={styles.moreButton}
                              aria-label={`「${token.name}」の操作`}
                              aria-haspopup="menu"
                              aria-expanded={menuId === token.id}
                              onClick={() => setMenuId(menuId === token.id ? null : token.id)}
                            >
                              <MoreHorizontal size={16} aria-hidden="true" />
                            </Button>
                            <ActionMenu
                              open={menuId === token.id}
                              onClose={() => setMenuId(null)}
                              ariaLabel={`「${token.name}」の操作`}
                              items={[{
                                id: 'revoke',
                                label: '止める',
                                tone: 'danger',
                                onSelect: () => {
                                  setMenuId(null)
                                  setDialogError('')
                                  setRevokeTarget(token)
                                },
                              }]}
                            />
                          </span>
                        ) : null}
                      </span>
                    </div>
                  )
                })}
              </div>
            </ContextMenu>
            <p className={styles.footNote}>行の「…」から止める。止めても、すでに付けたタグは残ります。</p>
          </>
        ) : null}
      </div>
    </ListPage>
  )
}

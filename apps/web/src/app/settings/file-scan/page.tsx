'use client'

import { useCallback, useDeferredValue, useEffect, useState } from 'react'
import { ApiError, api, type FileScanConfig, type FileScanItem } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Select from '@/components/shared/select'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import { RowActions } from '@/components/shared/row-actions'
import { ActionCell, DataTable, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'
import { TextField, TextArea } from '@/components/shared/text-field'
/** 一覧の1ページの件数。先頭50件固定だった監査 R132 の名残を残さない。 */
const PAGE_SIZE = 50

/**
 * 設定の中の「ファイルの検査」（B-2）。
 *
 * しまったファイルの一覧・消す・誤りなので戻す（理由を記録）は
 * owner / admin だけ。それ以外は入れない。
 */

type Phase = 'loading' | 'ready' | 'error' | 'forbidden'

export default function FileScanSettingsPage() {
  usePageTitle('ファイルの検査')
  const { selectedAccountId } = useAccount()
  const [phase, setPhase] = useState<Phase>('loading')
  const [items, setItems] = useState<FileScanItem[]>([])
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState('quarantined')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [page, setPage] = useState(1)
  const [actionError, setActionError] = useState('')
  const [actionDone, setActionDone] = useState('')
  const [releaseTarget, setReleaseTarget] = useState<FileScanItem | null>(null)
  const [releaseReason, setReleaseReason] = useState('')
  const [releaseBusy, setReleaseBusy] = useState(false)
  /* 監査 D017: 確認窓の中で起きた失敗は窓の中に出す。ページ最上部の帯は
   * 暗転の後ろに隠れて読めないため、ConfirmDialog の error へ渡す。 */
  const [releaseError, setReleaseError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<FileScanItem | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [config, setConfig] = useState<FileScanConfig | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [provider, setProvider] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [secretRef, setSecretRef] = useState('')
  const [configBusy, setConfigBusy] = useState(false)
  const [stopExternal, setStopExternal] = useState(false)
  const [stopError, setStopError] = useState('')

  // 外の検査の設定が保存前なら離脱の番兵を出す。
  const configDirty = configOpen && (
    (provider.trim() || null) !== (config?.externalProvider ?? null)
    || (endpoint.trim() || null) !== (config?.externalEndpointUrl ?? null)
    || (secretRef.trim() || null) !== (config?.externalSecretRef ?? null)
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty: configDirty, busy: configBusy })

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setPhase('ready')
      setItems([])
      setTotal(0)
      return
    }
    setPhase('loading')
    setActionError('')
    try {
      const [me, list, configRes] = await Promise.all([
        api.staff.me(),
        api.fileScan.list(selectedAccountId, {
          status: statusFilter,
          q: deferredQuery.trim() || undefined,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        }),
        api.fileScan.getConfig(selectedAccountId),
      ])
      if (!me.success || !list.success || !configRes.success) {
        setPhase('error')
        return
      }
      if (me.data.role !== 'owner' && me.data.role !== 'admin') {
        setPhase('forbidden')
        return
      }
      setItems(list.data.items)
      setTotal(list.data.total)
      /* 消す・戻すで今のページが空になったら1ページ目へ戻す（監査 R132）。 */
      if (list.data.items.length === 0 && page > 1) setPage(1)
      setConfig(configRes.data.config)
      setProvider(configRes.data.config?.externalProvider ?? '')
      setEndpoint(configRes.data.config?.externalEndpointUrl ?? '')
      setSecretRef(configRes.data.config?.externalSecretRef ?? '')
      setPhase('ready')
    } catch {
      setPhase('error')
    }
  }, [selectedAccountId, statusFilter, deferredQuery, page])

  useEffect(() => {
    void load()
  }, [load])

  async function release() {
    if (!selectedAccountId || !releaseTarget) return
    /* 監査 D018: 必須の理由が空なら送らず、窓の中で理由を促す。 */
    if (!releaseReason.trim()) {
      setReleaseError('理由を入力してください')
      return
    }
    setReleaseBusy(true)
    setReleaseError('')
    try {
      const res = await api.fileScan.release(releaseTarget.id, selectedAccountId, releaseReason.trim())
      if (!res.success) {
        setReleaseError('戻せませんでした。通信状態を確認して、もう一度お試しください。')
        return
      }
      setReleaseTarget(null)
      setReleaseReason('')
      setReleaseError('')
      setActionDone(`${releaseTarget.filename} を使えるように戻しました。`)
      await load()
    } catch (caught) {
      setReleaseError(caught instanceof ApiError && caught.status === 409
        ? 'しまったファイルだけ戻せます。一覧を読み直してください。'
        : '戻せませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setReleaseBusy(false)
    }
  }

  async function remove() {
    if (!selectedAccountId || !deleteTarget) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      const res = await api.fileScan.remove(deleteTarget.id, selectedAccountId)
      if (!res.success) {
        setDeleteError('消せませんでした。通信状態を確認して、もう一度お試しください。')
        return
      }
      setDeleteTarget(null)
      setDeleteError('')
      setActionDone(`${deleteTarget.filename} を消しました。`)
      await load()
    } catch (caught) {
      setDeleteError(caught instanceof ApiError && caught.status === 409
        ? 'しまった・使えないファイルだけ消せます。一覧を読み直してください。'
        : '消せませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setDeleteBusy(false)
    }
  }

  async function saveConfig() {
    if (!selectedAccountId) return
    setConfigBusy(true)
    setActionError('')
    try {
      const res = await api.fileScan.saveConfig(selectedAccountId, {
        externalProvider: provider.trim() || null,
        externalEndpointUrl: endpoint.trim() || null,
        externalSecretRef: secretRef.trim() || null,
      })
      if (!res.success) {
        setActionError('設定を保存できませんでした。')
        return
      }
      setConfigOpen(false)
      setActionDone('外の検査の設定を保存しました。')
      await load()
    } catch (caught) {
      setActionError(caught instanceof ApiError && caught.status === 400
        ? '宛先は https にし、提供元と宛先の両方を入れてください。'
        : '設定を保存できませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setConfigBusy(false)
    }
  }

  /*
   * 監査 R133: 「止める」は表示を畳むのではなく、保存済みの設定を
   * 実際に消す。空に保存すると送信は止まる（部分だけの空はAPIが弾く）。
   */
  async function stopExternalConfig() {
    if (!selectedAccountId) return
    setConfigBusy(true)
    setStopError('')
    try {
      const res = await api.fileScan.saveConfig(selectedAccountId, {
        externalProvider: null,
        externalEndpointUrl: null,
        externalSecretRef: null,
      })
      if (!res.success) {
        setStopError('設定を消せませんでした。')
        return
      }
      setStopExternal(false)
      setStopError('')
      setConfigOpen(false)
      setActionDone('外の検査サービスへの送信を止めました。内蔵の簡易検査は続きます。')
      await load()
    } catch {
      setStopError('設定を消せませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setConfigBusy(false)
    }
  }

  if (phase === 'loading') {
    return <ListState kind="loading" />
  }

  if (phase === 'error') {
    return (
      <ListState
        kind="error"
        title="ファイルの検査を読み込めませんでした"
        description="通信状態を確認して、もう一度読み込んでください。"
        onRetry={() => void load()}
      />
    )
  }

  if (phase === 'forbidden') {
    return (
      <ListState
        kind="forbidden"
        title="ファイルの検査は管理者だけが開けます"
        description="しまったファイルの確認は、owner・admin の操作です。変えたいときは管理者に頼んでください。"
      />
    )
  }

  if (!selectedAccountId) {
    return (
      <ListState
        kind="empty"
        title="LINEアカウントを選んでください"
        description="ファイルの検査はLINEアカウントごとに管理します。"
      />
    )
  }

  return (
    <div>
      <NoteBar>確かめ終わるまで、上げたファイルは配信・公開・審査に出ません。</NoteBar>

      {actionError ? <p role="alert" className="bg-danger-bg text-danger mt-4 rounded-control p-3 text-xs">{actionError}</p> : null}
      {actionDone ? <p role="status" className="bg-accent-soft text-accent-deep mt-4 rounded-control p-3 text-xs">{actionDone}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <h2 className="text-ink text-base font-bold">
          しまったファイル
          <HelpTip label="しまったファイルの意味">
            危険な中身が見つかったため、どこにも出さないようにしたファイルです。中身は画面に出ません。
          </HelpTip>
        </h2>
        <Chip tone="warn">{`${total}件`}</Chip>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {/*
            監査 R132: 51件目以降へ辿り着けなかったため、ファイル名で探す
            欄とページ送りを足す。探す言葉は件数と同じ条件で絞る。
          */}
          <TextField
            aria-label="ファイル名で探す"
            placeholder="ファイル名で探す"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1) }}
          />
          <Select
            aria-label="検査の状態"
            value={statusFilter}
            onChange={(value) => { setStatusFilter(value); setPage(1) }}
            options={[
              { value: 'quarantined', label: '状態：しまったもの' },
              { value: 'pending', label: '状態：確かめています' },
              { value: 'rejected', label: '状態：使えません' },
              { value: 'clean', label: '状態：使えます' },
            ]}
          />
        </span>
      </div>

      {items.length === 0 ? (
        <div className="mt-4">
          <ListState
            kind="empty"
            title="当てはまるファイルがありません"
            description="状態の絞り込みを変えてください。"
          />
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <DataTable>
            <colgroup>
              <col style={{ width: '32%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '28%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <thead>
              <TableHeadRow>
                <Th>ファイル</Th>
                <Th>上げた人</Th>
                <Th>見つかったもの</Th>
                <Th align="right">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {items.map((item) => (
                <Tr key={item.id}>
                  <Td>
                    <span className="block truncate" title={item.filename}>{item.filename}</span>
                  </Td>
                  <Td>
                    <span className="block truncate" title={item.uploaderLabel ?? '—'}>{item.uploaderLabel ?? '—'}</span>
                  </Td>
                  <Td>
                    <span className="block truncate" title={item.reasonLabel ?? '確認が必要です'}>{item.reasonLabel ?? '確認が必要です'}</span>
                  </Td>
                  <ActionCell>
                    {item.status === 'quarantined' ? (
                      <RowActions
                        subjectName={item.filename}
                        edit={{ label: '使えるように戻す', onClick: () => { setReleaseTarget(item); setReleaseReason(''); setReleaseError('') } }}
                        destructiveItem={{ id: 'delete', label: '消す', onSelect: () => { setDeleteTarget(item); setDeleteError('') } }}
                      />
                    ) : item.status === 'rejected' ? (
                      <RowActions
                        subjectName={item.filename}
                        destructiveItem={{ id: 'delete', label: '消す', onSelect: () => { setDeleteTarget(item); setDeleteError('') } }}
                      />
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </ActionCell>
                </Tr>
              ))}
            </tbody>
          </DataTable>
          {/* 監査 R132: 件数と表示範囲を示し、51件目以降もページで辿れる。 */}
          {total > PAGE_SIZE ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <ListRange
                total={total}
                first={(page - 1) * PAGE_SIZE + 1}
                last={Math.min(page * PAGE_SIZE, total)}
              />
              <Pagination
                page={page}
                pageCount={Math.ceil(total / PAGE_SIZE)}
                onPageChange={setPage}
              />
            </div>
          ) : null}
        </div>
      )}

      <h2 className="text-ink mt-8 text-base font-bold">外の検査</h2>
      {/*
        監査 R133: 以前は編集欄の開閉を「使う」スイッチに見せていたため、
        設定済みでもOFFに見え、OFFへ戻しても送る設定は残っていた。
        実際に送っているかは保存済みの設定から表示し、編集欄は
        「設定を編集」で開き、止める操作は設定の消去と一致させる。
      */}
      <p className="text-ink-secondary mt-1 text-xs">
        {config?.externalProvider && config?.externalEndpointUrl
          ? `使っています。送り先：${config.externalEndpointUrl}`
          : 'いまは内蔵の簡易検査だけです。外の検査サービスには送っていません。'}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <span id="file-scan-external-label" className="text-ink text-sm">外の検査サービスの設定</span>
        <HelpTip label="外の検査サービスの意味">
          内蔵の簡易検査に加えて、外の検査サービスにも送る設定です。設定がある時だけ送ります。鍵そのものはここに置かず、秘密値の仕組みにある名前だけを指します。
        </HelpTip>
        <Button type="button" onClick={() => {
          /* 開き直す時は保存済みの値へ戻す。編集中の置き去りを残さない。 */
          if (!configOpen) {
            setProvider(config?.externalProvider ?? '')
            setEndpoint(config?.externalEndpointUrl ?? '')
            setSecretRef(config?.externalSecretRef ?? '')
          }
          setConfigOpen(!configOpen)
        }}>
          {configOpen ? '設定を閉じる' : '設定を編集'}
        </Button>
        {config?.externalProvider && config?.externalEndpointUrl ? (
          <Button type="button" disabled={configBusy} onClick={() => { setStopExternal(true); setStopError('') }}>
            外の検査を止める
          </Button>
        ) : null}
      </div>
      {configOpen ? (
        <div className="mt-3 max-w-xl space-y-3">
          <div>
            <label htmlFor="file-scan-provider" className="text-ink-secondary mb-1 block text-xs font-semibold">提供元</label>
            <TextField
              id="file-scan-provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              placeholder="例：example-scan"
            />
          </div>
          <div>
            <label htmlFor="file-scan-endpoint" className="text-ink-secondary mb-1 block text-xs font-semibold">送り先（https）</label>
            <TextField
              id="file-scan-endpoint"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://example.com/scan"
            />
          </div>
          <div>
            <label htmlFor="file-scan-secret-ref" className="text-ink-secondary mb-1 block text-xs font-semibold">鍵の名前</label>
            <TextField
              id="file-scan-secret-ref"
              value={secretRef}
              onChange={(event) => setSecretRef(event.target.value)}
              placeholder="例：FILE_SCAN_API_KEY"
            />
          </div>
          <div>
            <Button type="button" variant="primary" disabled={configBusy} onClick={() => void saveConfig()}>
              {configBusy ? '保存しています…' : '外の検査の設定を保存'}
            </Button>
          </div>
        </div>
      ) : null}

      {releaseTarget ? (
        <ConfirmDialog
          open
          title="使えるように戻す"
          description={`${releaseTarget.filename} は誤りだったとして、使えるように戻します。理由は記録に残ります。`}
          confirmLabel="使えるように戻す"
          cancelLabel="やめる"
          busy={releaseBusy}
          error={releaseError || undefined}
          onCancel={() => { setReleaseTarget(null); setReleaseReason(''); setReleaseError('') }}
          onConfirm={() => void release()}
        >
          <div>
            <label htmlFor="file-scan-release-reason" className="text-ink-secondary mb-1 block text-xs font-semibold">理由（必須）</label>
            <TextArea
              id="file-scan-release-reason"
              value={releaseReason}
              onChange={(event) => { setReleaseReason(event.target.value); setReleaseError('') }}
              placeholder="例：社内の画像と確認できたため"
            />
          </div>
        </ConfirmDialog>
      ) : null}

      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        subject="外の検査の設定の変更"
        busy={configBusy}
        onCancel={() => {
          if (!configBusy) cancelLeave()
        }}
        onConfirm={() => {
          confirmLeave()
        }}
      />

      {stopExternal ? (
        <ConfirmDialog
          open
          title="外の検査を止める"
          description="外の検査サービスへの送信設定を消します。内蔵の簡易検査は続きます。もう一度使うには設定を入れ直します。"
          confirmLabel="外の検査を止める"
          cancelLabel="やめる"
          busy={configBusy}
          error={stopError || undefined}
          onCancel={() => { setStopExternal(false); setStopError('') }}
          onConfirm={() => void stopExternalConfig()}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          open
          title="ファイルを消す"
          description={`${deleteTarget.filename} を消します。中身は画面に出ません。監査の記録は残ります。`}
          confirmLabel="消す"
          cancelLabel="やめる"
          busy={deleteBusy}
          error={deleteError || undefined}
          onCancel={() => { setDeleteTarget(null); setDeleteError('') }}
          onConfirm={() => void remove()}
        />
      ) : null}
    </div>
  )
}

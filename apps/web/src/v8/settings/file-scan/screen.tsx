'use client'

/*
 * ★V8 ファイルの検査（Pencil `PfA4o`、状態は `bR6a1`）。
 *
 * 動き（権限・一覧・札の絞り込み・探す・ページ送り・使えるように戻す・消す・外の検査の設定）は
 * 今までの V8（app/settings/file-scan/file-scan-v8.tsx）と同じ。処理は同じ場所の use-file-scan.ts（写し）。
 * 行の右端は「使えるように戻す」＋「…」（中の「削除する」）。
 */
import { useState } from 'react'
import { Info, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import SearchField from '@/components/shared/search-field'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import { TextField, TextArea } from '@/components/shared/text-field'
import ListRange from '@/components/ui/list-range'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import type { FileScanItem } from '@/lib/api'
import { SbBackLink, SbSettingsScreen } from '../sb-frame/settings-screen'
import { FILE_SCAN_PAGE_SIZE, useFileScan } from './use-file-scan'
import styles from './screen.module.css'

const TITLE = 'ファイルの検査'
const DESCRIPTION = '上げたファイルに危ないものがないかを確かめます'
const BACK = <SbBackLink href="/settings" label="機能設定へ" />

/* 板の札。`使えません`・`使えます` の絞り込みは v7 の画面に残す。 */
const STATUS_CHIPS = [
  { value: 'quarantined', label: 'しまったファイル' },
  { value: 'pending', label: '確かめ中' },
  { value: 'released', label: '戻した' },
] as const

/** 見つかったものの色。画像の後ろのデータ（ほぼ無害なことが多い）は琥珀、ほかは赤。 */
function reasonTone(item: FileScanItem): 'warn' | 'danger' | 'none' {
  if (!item.reasonCode) return 'none'
  return item.reasonCode === 'trailing_data' ? 'warn' : 'danger'
}

export default function FileScanScreen() {
  const {
    selectedAccountId,
    phase,
    items,
    total,
    counts,
    statusFilter,
    query,
    page,
    setPage,
    actionError,
    actionDone,
    releaseTarget,
    setReleaseTarget,
    releaseReason,
    setReleaseReason,
    releaseBusy,
    releaseError,
    setReleaseError,
    deleteTarget,
    setDeleteTarget,
    deleteBusy,
    deleteError,
    setDeleteError,
    config,
    configOpen,
    provider,
    setProvider,
    endpoint,
    setEndpoint,
    secretRef,
    setSecretRef,
    configBusy,
    stopExternal,
    setStopExternal,
    stopError,
    setStopError,
    leaveTarget,
    confirmLeave,
    cancelLeave,
    load,
    release,
    remove,
    saveConfig,
    stopExternalConfig,
    toggleConfigOpen,
    changeQuery,
    changeStatusFilter,
  } = useFileScan()
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  const openRelease = (item: FileScanItem) => { setReleaseTarget(item); setReleaseReason(''); setReleaseError('') }
  const openDelete = (item: FileScanItem) => { setDeleteTarget(item); setDeleteError('') }

  const dialogs = (
    <>
      {releaseTarget ? (
        <ConfirmDialog
          open
          title="使えるように戻す"
          description={`${releaseTarget.filename} は誤りだったとして、使えるように戻します。理由は記録に残ります。`}
          confirmLabel="使えるように戻す"
          cancelLabel="キャンセル"
          busy={releaseBusy}
          error={releaseError || undefined}
          onCancel={() => { setReleaseTarget(null); setReleaseReason(''); setReleaseError('') }}
          onConfirm={() => void release()}
        >
          <div className={styles.field}>
            <label htmlFor="file-scan-release-reason" className={styles.fieldLabel}>理由（必須）</label>
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
        onCancel={() => { if (!configBusy) cancelLeave() }}
        onConfirm={() => { confirmLeave() }}
      />

      {stopExternal ? (
        <ConfirmDialog
          open
          title="外の検査を止める"
          description="外の検査サービスへの送信設定を消します。内蔵の簡易検査は続きます。もう一度使うには設定を入れ直します。"
          confirmLabel="外の検査を止める"
          cancelLabel="キャンセル"
          busy={configBusy}
          error={stopError || undefined}
          onCancel={() => { setStopExternal(false); setStopError('') }}
          onConfirm={() => void stopExternalConfig()}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          open
          title="ファイルを削除する"
          description={`${deleteTarget.filename} を消します。中身は画面に出ません。監査の記録は残ります。`}
          confirmLabel="削除する"
          cancelLabel="キャンセル"
          destructive
          busy={deleteBusy}
          error={deleteError || undefined}
          onCancel={() => { setDeleteTarget(null); setDeleteError('') }}
          onConfirm={() => void remove()}
        />
      ) : null}
    </>
  )

  if (phase === 'loading' || phase === 'error' || phase === 'forbidden' || !selectedAccountId) {
    return (
      <SbSettingsScreen boardId="PfA4o" title={TITLE} description={DESCRIPTION} identity={BACK}>
        {phase === 'loading' ? (
          <ListState kind="loading" />
        ) : phase === 'error' ? (
          <ListState
            kind="error"
            title="ファイルの検査を読み込めませんでした"
            description="通信状態を確認して、もう一度読み込んでください。"
            onRetry={() => void load()}
          />
        ) : phase === 'forbidden' ? (
          <ListState
            kind="forbidden"
            title="ファイルの検査は管理者だけが開けます"
            description="しまったファイルの確認は、owner・admin の操作です。変えたいときは管理者に頼んでください。"
          />
        ) : (
          <ListState kind="empty" title="LINEアカウントを選んでください" description="ファイルの検査はLINEアカウントごとに管理します。" />
        )}
        {dialogs}
      </SbSettingsScreen>
    )
  }

  const menuItems = (item: FileScanItem): ActionMenuItem[] => [
    { id: 'delete', label: '削除する', tone: 'danger', icon: <Trash2 size={14} aria-hidden="true" />, onSelect: () => openDelete(item) },
  ]
  const externalOn = Boolean(config?.externalProvider && config?.externalEndpointUrl)

  return (
    <SbSettingsScreen boardId="PfA4o" title={TITLE} description={DESCRIPTION} identity={BACK}>
      <p className={styles.infoBand}>
        <Info className={styles.bandIcon} aria-hidden="true" />
        <span>確かめ終わるまで、上げたファイルは配信・公開・審査に出せません。</span>
      </p>

      {actionError ? <p role="alert" className={styles.dangerBand}>{actionError}</p> : null}
      {actionDone ? <p role="status" className={styles.doneBand}>{actionDone}</p> : null}

      <div className={styles.toolbar}>
        <SearchField
          aria-label="ファイル名で探す"
          placeholder="ファイル名で探す"
          value={query}
          onChange={changeQuery}
          className={styles.search}
        />
        {STATUS_CHIPS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            className={styles.chip}
            aria-pressed={statusFilter === chip.value}
            onClick={() => changeStatusFilter(chip.value)}
          >
            {chip.value === 'released' ? chip.label : `${chip.label} ${counts[chip.value]}`}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        statusFilter === 'quarantined' && !query ? (
          <ListState kind="empty" title="しまったファイルはありません" description="危ないものが見つかったファイルは、ここに入ります。" />
        ) : (
          <ListState
            kind="empty"
            emptyPreset="filtered"
            title="条件に合うものはありません"
            description="札や検索を外すと、すべて出ます"
            action={query ? <Button variant="secondary" onClick={() => changeQuery('')}>条件を外す</Button> : undefined}
          />
        )
      ) : (
        <div className={styles.table} role="table" aria-label="しまったファイル">
          <div role="rowgroup">
            <div role="row" className={`${styles.row} ${styles.headRow}`}>
              <span role="columnheader">ファイル</span>
              <span role="columnheader">上げた人</span>
              <span role="columnheader">見つかったもの</span>
              <span role="columnheader"><span className={styles.srOnly}>操作</span></span>
            </div>
          </div>
          <div role="rowgroup">
            {items.map((item) => (
              <div role="row" key={item.id} className={styles.row}>
                <span role="cell" className={`${styles.cell} ${styles.name}`} title={item.filename}>
                  {item.filename}
                  {item.releasedAt ? <span className={styles.released}>戻した</span> : null}
                </span>
                <span role="cell" className={styles.cell} title={item.uploaderLabel ?? '—'}>{item.uploaderLabel ?? '—'}</span>
                <span role="cell" className={styles.cell} data-tone={reasonTone(item)} title={item.reasonLabel ?? '確認が必要です'}>
                  {item.reasonLabel ?? '確認が必要です'}
                </span>
                <span role="cell" className={styles.actions}>
                  {item.status === 'quarantined' ? (
                    <Button variant="text" onClick={() => openRelease(item)}>
                      <RotateCcw className={styles.btnIcon} aria-hidden="true" />
                      使えるように戻す
                    </Button>
                  ) : null}
                  {item.status === 'quarantined' || item.status === 'rejected' ? (
                    <span className={styles.menuBox}>
                      <IconButton
                        className={styles.more}
                        title={`${item.filename}のその他操作`}
                        aria-label={`${item.filename}のその他操作`}
                        aria-expanded={openMenuId === item.id}
                        onClick={() => setOpenMenuId((current) => (current === item.id ? null : item.id))}
                      >
                        <MoreHorizontal size={16} aria-hidden="true" />
                      </IconButton>
                      <ActionMenu
                        open={openMenuId === item.id}
                        onClose={() => setOpenMenuId(null)}
                        ariaLabel={`${item.filename}のその他操作`}
                        items={menuItems(item)}
                      />
                    </span>
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {total > FILE_SCAN_PAGE_SIZE ? (
        <div className={styles.toolbar}>
          <ListRange
            total={total}
            first={(page - 1) * FILE_SCAN_PAGE_SIZE + 1}
            last={Math.min(page * FILE_SCAN_PAGE_SIZE, total)}
          />
          <Pagination page={page} pageCount={Math.ceil(total / FILE_SCAN_PAGE_SIZE)} onPageChange={setPage} />
        </div>
      ) : null}

      <section className={styles.external} aria-label="外の検査サービス">
        <div className={styles.externalHead}>
          <div className={styles.externalText}>
            <h2 className={styles.externalTitle}>外の検査サービス</h2>
            <p className={styles.externalNote}>
              {externalOn
                ? `使っています。送り先：${config?.externalEndpointUrl}`
                : 'いまは内蔵の簡易検査だけです。外の検査サービスには送っていません。'}
            </p>
          </div>
          {externalOn ? (
            <Button variant="secondary" type="button" disabled={configBusy} onClick={() => { setStopExternal(true); setStopError('') }}>
              外の検査を止める
            </Button>
          ) : null}
          <Button variant="secondary" type="button" onClick={toggleConfigOpen}>
            <Pencil className={styles.btnIcon} aria-hidden="true" />
            {configOpen ? '設定を閉じる' : '設定を編集'}
          </Button>
        </div>
        {configOpen ? (
          <div className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="file-scan-provider" className={styles.fieldLabel}>提供元</label>
              <TextField id="file-scan-provider" value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="例：example-scan" />
            </div>
            <div className={styles.field}>
              <label htmlFor="file-scan-endpoint" className={styles.fieldLabel}>送り先（https）</label>
              <TextField id="file-scan-endpoint" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://example.com/scan" />
            </div>
            <div className={styles.field}>
              <label htmlFor="file-scan-secret-ref" className={styles.fieldLabel}>鍵の名前</label>
              <TextField id="file-scan-secret-ref" value={secretRef} onChange={(event) => setSecretRef(event.target.value)} placeholder="例：FILE_SCAN_API_KEY" />
            </div>
            <div>
              <Button type="button" variant="primary" disabled={configBusy} onClick={() => void saveConfig()} busy={configBusy} busyLabel="保存しています…">
                外の検査の設定を保存する
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      {dialogs}
    </SbSettingsScreen>
  )
}

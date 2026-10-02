'use client'

import { usePageTitle } from '@/components/shell/page-chrome'
import { useAdminTheme } from '@/lib/use-admin-theme'
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
import { FILE_SCAN_PAGE_SIZE, useFileScan } from './use-file-scan'
import { FileScanV8 } from './file-scan-v8'

/**
 * 設定の中の「ファイルの検査」（B-2）。
 *
 * しまったファイルの一覧・消す・誤りなので戻す（理由を記録）は
 * owner / admin だけ。それ以外は入れない。
 */
export default function FileScanSettingsPage() {
  usePageTitle('ファイルの検査')
  const theme = useAdminTheme()
  if (theme === 'v8') return <FileScanV8 />
  return <FileScanPageV7 />
}

function FileScanPageV7() {
  const {
    selectedAccountId,
    phase,
    items,
    total,
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
            onChange={(event) => changeQuery(event.target.value)}
          />
          <Select
            aria-label="検査の状態"
            value={statusFilter}
            onChange={(value) => changeStatusFilter(value)}
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
                        destructiveItem={{ id: 'delete', label: '削除する', onSelect: () => { setDeleteTarget(item); setDeleteError('') } }}
                      />
                    ) : item.status === 'rejected' ? (
                      <RowActions
                        subjectName={item.filename}
                        destructiveItem={{ id: 'delete', label: '削除する', onSelect: () => { setDeleteTarget(item); setDeleteError('') } }}
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
          {total > FILE_SCAN_PAGE_SIZE ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <ListRange
                total={total}
                first={(page - 1) * FILE_SCAN_PAGE_SIZE + 1}
                last={Math.min(page * FILE_SCAN_PAGE_SIZE, total)}
              />
              <Pagination
                page={page}
                pageCount={Math.ceil(total / FILE_SCAN_PAGE_SIZE)}
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
        <Button type="button" onClick={toggleConfigOpen}>
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
            <Button type="button" variant="primary" disabled={configBusy} onClick={() => void saveConfig()} busy={configBusy} busyLabel="保存しています…">外の検査の設定を保存する
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
          cancelLabel="キャンセル"
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
          busy={deleteBusy}
          error={deleteError || undefined}
          onCancel={() => { setDeleteTarget(null); setDeleteError('') }}
          onConfirm={() => void remove()}
        />
      ) : null}
    </div>
  )
}

import { useState } from 'react'
import Link from 'next/link'
import type { Scenario, DeliveryMode, Folder } from '@line-crm/shared'
import { TableHeadRow, Th } from '@/components/shared/table'
import ConfirmDialog from '@/components/shared/confirm-dialog'

type ScenarioRow = Scenario & {
  stepCount?: number
  subscriberCount?: number
  completedCount?: number
}

/**
 * 配信方式。設計の一覧は「時刻」「日付」のように短く出す。
 * relative は 028 以前の作り方で、いまは新しく作れない。
 */
const deliveryModeLabels: Record<DeliveryMode, string> = {
  relative: '経過時間（旧）',
  elapsed: '経過時間',
  absolute_time: '時刻',
}

/** 最終コンテンツを配り終えたあとどうするか（121）。 */
const ON_COMPLETE_LABELS: Record<string, string> = {
  pause: '一時停止',
  resume_previous: '1つ前を再開',
  move: '別のシナリオへ',
}

interface ScenarioListProps {
  scenarios: ScenarioRow[]
  onToggleActive: (id: string, current: boolean) => void
  /**
   * 削除を実行する。**うまくいったかを返す。**
   * 返り値を見ないと、失敗しても確認窓が閉じてしまい、消えたように見える。
   */
  onDelete: (id: string) => Promise<boolean>
  folders?: Folder[]
  onMoveFolder?: (id: string, folderId: string) => void
  /** 掴んで並べ替えたときに、見えている順で呼ばれる。 */
  onReorder?: (ids: string[]) => void
  loading?: boolean
}

/**
 * シナリオの一覧。
 *
 * 設計（V2 4-1）は表。以前は札を3列に並べていたが、シナリオが増えると
 * 縦に伸びて、購読中の人数どうしを見比べられなかった。数を並べて読む
 * 画面なので、列で揃える。
 */
export default function ScenarioList({
  scenarios,
  onToggleActive,
  onDelete,
  folders = [],
  onMoveFolder,
  onReorder,
  loading,
}: ScenarioListProps) {
  /** いま掴んでいるシナリオ。落とした先と入れ替える。 */
  const [dragId, setDragId] = useState<string | null>(null)
  /*
    削除の確認（設計の確認窓）。**ブラウザの `confirm()` を使わない。**
    `friend_scenarios` はシナリオに `ON DELETE CASCADE` で繋がっているので、
    配信中の友だちの進み具合まで消える。これを本文で読ませられないと、
    「通が消えるだけ」と思ったまま押してしまう。
  */
  const [deleteTarget, setDeleteTarget] = useState<ScenarioRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      if (!(await onDelete(deleteTarget.id))) throw new Error('delete_failed')
      setDeleteTarget(null)
    } catch {
      setDeleteError('シナリオを削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  const dropOn = (targetId: string) => {
    const from = dragId
    setDragId(null)
    if (!from || from === targetId || !onReorder) return
    const order = scenarios.map((s) => s.id)
    const fromIdx = order.indexOf(from)
    const toIdx = order.indexOf(targetId)
    if (fromIdx < 0 || toIdx < 0) return
    order.splice(toIdx, 0, ...order.splice(fromIdx, 1))
    onReorder(order)
  }

  if (scenarios.length === 0) {
    return (
      <div className="bg-canvas rounded-card border-hairline border p-12 text-center">
        <p className="text-ink-faint text-sm">
          シナリオがありません。「＋ シナリオを作成」から作ってください。
        </p>
      </div>
    )
  }

  return (
    <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <TableHeadRow>
              <Th className="w-10 px-2" aria-label="並び替え" />
              {/*
                名前の桁だけ「余ったぶんを全部取る」形にする。
                `w-full max-w-0` は表の桁でよく使う組み合わせで、
                他の桁が中身ぶんの幅を取ったあと、残りをここが受け取る。
                max-w-0 が無いと、中身の長さで桁が広がって表が横に伸びる。

                以前は 22rem で固定していたが、それだと広い画面でも
                説明が途中で切れ、狭い画面では他の桁が潰れて
                「配信方 / 式」「読了 / 済」と縦になっていた。
              */}
              <Th className="w-full max-w-0">
                シナリオ名
              </Th>
              <Th>
                配信方式
              </Th>
              <Th>
                フォルダ
              </Th>
              <Th>
                購読中
              </Th>
              <Th>
                読了済
              </Th>
              <Th>
                通数
              </Th>
              {/* 配り終えた人をどうするか。一覧で見えないと、シナリオを
                  つないだつもりが繋がっていないことに気づけない。 */}
              <Th>
                終了後
              </Th>
              <Th>
                状態
              </Th>
              <Th aria-label="操作" />
            </TableHeadRow>
          </thead>
          <tbody className="divide-hairline divide-y">
            {scenarios.map((s) => (
              <tr key={s.id} className="hover:bg-canvas-sunken">
                {/* 掴んで上下に入れ替える。よく使うものを上に置くための操作。 */}
                <td
                  className="text-ink-faint w-10 cursor-grab px-2 py-3 text-center select-none active:cursor-grabbing"
                  draggable={Boolean(onReorder)}
                  onDragStart={() => setDragId(s.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dropOn(s.id)}
                  aria-label={`${s.name} を並び替える`}
                  title="上下に動かして並び替え"
                >
                  ⠿
                </td>
                {/*
                  説明が長いと、表そのものが横に伸びて横スクロールが出る。
                  桁の幅に上限を付けて、はみ出すぶんは畳む。上限を付けずに
                  line-clamp だけ当てても、桁は中身に合わせて広がる。
                */}
                <td className="w-full max-w-0 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <Link
                        href={`/scenarios/detail?id=${s.id}`}
                        className="text-info min-w-0 truncate text-sm font-medium hover:underline"
                      >
                        {s.name}
                      </Link>
                      {/* 全アカウント共通のものは、触ると他のアカウントにも効く。
                          名前の隣に出して、開く前に分かるようにする。
                          名前が長くても、この札だけは縮めない。 */}
                      {s.lineAccountId === null && (
                        <span
                          className="bg-warning-bg text-warning rounded-pill shrink-0 px-2 py-0.5 text-[10px] font-medium whitespace-nowrap"
                          title="全アカウントに適用されるシナリオです"
                        >
                          全アカウント共通
                        </span>
                      )}
                    </div>
                    {s.description && (
                      <p className="text-ink-faint mt-0.5 truncate text-xs" title={s.description}>
                        {s.description}
                      </p>
                    )}
                  </div>
                </td>
                <td className="text-ink-secondary px-4 py-3 text-sm whitespace-nowrap">
                  {deliveryModeLabels[s.deliveryMode ?? 'relative']}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <select
                    value={s.folderId ?? ''}
                    onChange={(event) => onMoveFolder?.(s.id, event.target.value)}
                    aria-label={`${s.name}のフォルダ`}
                    disabled={!onMoveFolder}
                    className="v6-select h-9 w-36 rounded-control border border-hairline bg-canvas text-xs font-semibold text-ink"
                  >
                    <option value="">未分類</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="text-ink px-4 py-3 text-sm tabular-nums whitespace-nowrap">
                  {(s.subscriberCount ?? 0).toLocaleString('ja-JP')}
                  <span className="text-ink-faint ml-0.5 text-xs">人</span>
                  {/*
                    0人のとき、作っただけでは配信されないことに気づけない。
                    始め方への導線をその場に出す。
                  */}
                  {(s.subscriberCount ?? 0) === 0 && (
                    <Link
                      href={`/scenarios/detail?id=${s.id}`}
                      className="text-info mt-0.5 block text-xs font-normal hover:underline"
                    >
                      配信を始める方法
                    </Link>
                  )}
                </td>
                <td className="text-ink px-4 py-3 text-sm tabular-nums whitespace-nowrap">
                  {(s.completedCount ?? 0).toLocaleString('ja-JP')}
                  <span className="text-ink-faint ml-0.5 text-xs">人</span>
                </td>
                <td className="text-ink-secondary px-4 py-3 text-sm tabular-nums whitespace-nowrap">
                  {s.stepCount ?? '—'}
                  {s.stepCount !== undefined && (
                    <span className="text-ink-faint ml-0.5 text-xs">通</span>
                  )}
                </td>
                <td className="text-ink-secondary px-4 py-3 text-sm whitespace-nowrap">
                  {ON_COMPLETE_LABELS[s.onCompleteMode ?? 'pause']}
                </td>
                {/* 列が狭いと「配信可」が「配信 / 可」の2行になる。
                    札の中で折り返させない。 */}
                <td className="px-4 py-3 whitespace-nowrap">
                  <span
                    className={`rounded-pill inline-block px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                      s.isActive ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning'
                    }`}
                  >
                    {s.isActive ? '配信可' : '停止中'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    /*
                      **撮影の入口。**文言（「停止」「再開」）で探すと、言葉を
                      変えたときに撮影が黙って空振りする。Node ID を付ける。
                      止めているものだけが「再開」＝配信開始の確認へ進む。
                    */
                    data-qa-open={s.isActive ? undefined : 'RUxNf'}
                    onClick={() => {
                      onToggleActive(s.id, s.isActive)
                    }}
                    disabled={loading}
                    className="text-ink-secondary hover:bg-canvas-sunken rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40"
                  >
                    {s.isActive ? '停止' : '再開'}
                  </button>
                  <Link
                    href={`/scenarios/detail?id=${s.id}`}
                    className="text-accent mx-1 px-2.5 py-1 text-xs font-medium hover:underline"
                  >
                    編集
                  </Link>
                  <button
                    onClick={() => {
                      setDeleteError('')
                      setDeleteTarget(s)
                    }}
                    disabled={loading}
                    className="text-danger hover:bg-danger-bg rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40"
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`シナリオ「${deleteTarget?.name ?? ''}」を削除しますか？`}
        description={`${
          deleteTarget?.lineAccountId === null
            ? 'これは全アカウント共通のシナリオです。削除するとすべてのアカウントから消えます。'
            : 'このアカウントのシナリオを削除します。ほかのアカウントには影響しません。'
        }通の中身と、${
          deleteTarget?.subscriberCount === undefined
            ? '配信中の友だちの進み具合も一緒に消えます（いま何人が配信中かは数えられていません）'
            : `いま配信中の${deleteTarget.subscriberCount}人の進み具合も一緒に消えます`
        }。途中まで届いていた人には、残りが届かなくなります。すでに送ったメッセージの履歴と友だちは残ります。この操作は元に戻せません。`}
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (deleting) return
          setDeleteError('')
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}

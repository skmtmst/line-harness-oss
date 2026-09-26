import Checkbox from '@/components/shared/checkbox'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ListPlus } from 'lucide-react'
import type { Scenario, DeliveryMode, Folder } from '@line-crm/shared'
import Button from '@/components/shared/button'
import { TableHeadRow, Th } from '@/components/shared/table'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import { MoreAction } from '@/components/shared/row-actions'
import ReorderGrip from '@/components/friend-fields/reorder-grip'

type ScenarioRow = Scenario & {
  stepCount?: number
  subscriberCount?: number
  completedCount?: number
}

/**
 * 配信方式。設計の一覧は「時刻」「日付」のように短く出す。
 * relative は 028 以前の作り方で、いまは新しく作れない。
 * 一覧では名前の下の補足行に出す（列としては持たない。NEXT-25）。
 */
const deliveryModeLabels: Record<DeliveryMode, string> = {
  relative: '経過時間（旧）',
  elapsed: '経過時間',
  absolute_time: '時刻',
}

interface ScenarioListProps {
  scenarios: ScenarioRow[]
  onToggleActive: (id: string, current: boolean) => void
  /**
   * 削除の実行。
   *
   * **待てる形にしてある。** 確認窓は投げっぱなしにせず、終わるまで
   * 「処理中…」を出して二度押しを止め、投げた先が失敗したら窓の中に出す。
   * `void` を返す従来の呼び出し側もそのまま渡せる。
   */
  onDelete: (id: string) => void | Promise<void>
  folders?: Folder[]
  /** 1件だけフォルダを移す受け口。一括は `onMoveFolders` を使う。 */
  onMoveFolder?: (id: string, folderId: string) => void | Promise<void>
  /**
   * 複数件をまとめてフォルダへ移す受け口。
   *
   * 行ごとの select（幅176px）を名前列の下の短い札に畳んだ代わりに、
   * 移す操作は行の「その他」→「フォルダを移動」と、複数選択したときの
   * 一括操作へ集約した（NEXT-25）。失敗したら例外を投げてほしい。
   * 窓の中に「移動できませんでした」を出して開けたままにする。
   */
  onMoveFolders?: (ids: string[], folderId: string) => void | Promise<void>
  /** 掴んで並べ替えたときに、見えている順で呼ばれる。 */
  onReorder?: (ids: string[]) => void
  loading?: boolean
  onCreate?: () => void
}

/**
 * シナリオの一覧。
 *
 * 設計（V2 4-1）は表。以前は札を3列に並べていたが、シナリオが増えると
 * 縦に伸びて、購読中の人数どうしを見比べられなかった。数を並べて読む
 * 画面なので、列で揃える。
 *
 * **列は固定の6列だけ（NEXT-25）。** 以前はウインドウ幅 1536px を境に
 * 3列を増やしていたが、フォルダの帯を引いた表の実幅では名前列が
 * 潰れて見出しが重なり、右端の操作も切れていた。いまは
 * - 配信方式・通数・フォルダ … 名前の下の補足行
 * - 購読中・読了済 … 1列にまとめた「購読 / 読了」
 * - 終了後 … 詳細画面で見る
 * - 操作 … 「編集」＋「その他（…）」へ集約
 * に絞り、幅の条件分岐を持たない。狭い容器では名前列が縮むだけで、
 * 見出しや操作が欠けることはない。
 */
export default function ScenarioList({
  scenarios,
  onToggleActive,
  onDelete,
  folders = [],
  onMoveFolder,
  onMoveFolders,
  onReorder,
  loading,
  onCreate,
}: ScenarioListProps) {
  const router = useRouter()
  /** いま掴んでいるシナリオ。落とした先と入れ替える。 */
  const [dragId, setDragId] = useState<string | null>(null)

  /*
   * SCENARIO-17: キーボードで動かした結果を読み上げるための live 領域。
   * 「動いたか分からない」ままにしない。
   */
  const [moveNotice, setMoveNotice] = useState('')

  /** フォルダを移せるなら、選択と「その他→フォルダを移動」を出す。 */
  const canMove = Boolean(onMoveFolder || onMoveFolders)

  /*
   * 複数選択。フォルダの一括移動だけに使う。
   *
   * 選択状態はIDで持ち、一覧が読み直されたときに居なくなった行は
   * そのまま外す（アカウント切替・削除・検索で外れた行を数え続けない）。
   */
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    setSelectedIds((current) => {
      if (current.size === 0) return current
      const listed = new Set(scenarios.map((s) => s.id))
      const next = new Set([...current].filter((id) => listed.has(id)))
      return next.size === current.size ? current : next
    })
  }, [scenarios])

  const allOnPageSelected =
    scenarios.length > 0 && scenarios.every((s) => selectedIds.has(s.id))
  const selectedCount = selectedIds.size

  const toggleAllOnPage = () => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allOnPageSelected) scenarios.forEach((s) => next.delete(s.id))
      else scenarios.forEach((s) => next.add(s.id))
      return next
    })
  }
  const toggleOne = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 行の「その他」メニュー。開いている行のID。 */
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  /*
   * フォルダ移動の窓。対象は1件（行のその他）または選択した複数件。
   * `null` は閉じている。
   */
  const [moveIds, setMoveIds] = useState<string[] | null>(null)
  const [moveDraft, setMoveDraft] = useState('')
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState('')

  const openMove = (ids: string[]) => {
    if (ids.length === 0) return
    setMoveDraft('')
    setMoveError('')
    setMoveIds(ids)
  }

  const runMove = async () => {
    if (!moveIds || moveIds.length === 0 || moving) return
    setMoving(true)
    setMoveError('')
    try {
      if (onMoveFolders) {
        await onMoveFolders(moveIds, moveDraft)
      } else if (onMoveFolder) {
        for (const id of moveIds) await onMoveFolder(id, moveDraft)
      }
      // 移した行は選択から外す。絞り込み中に移すと一覧から消えるため、
      // 「選んだまま見えない」状態を残さない。
      const moved = new Set(moveIds)
      setSelectedIds((current) => new Set([...current].filter((id) => !moved.has(id))))
      setMoveIds(null)
    } catch {
      setMoveError('フォルダを移動できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setMoving(false)
    }
  }

  /*
   * **ブラウザの `confirm()` を使わない。**
   *
   * 見た目がブラウザ任せで設計の確認窓（`J6x4Q` / `H2S1T4`）と違ううえ、
   * 画像比較にも写らないので、確認の絵をそもそも撮れない。何が消えるのかを
   * 本文で読ませたいので、共通の `ConfirmDialog` へ移した。
   */
  const [deleteTarget, setDeleteTarget] = useState<ScenarioRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  /*
   * **押した時点のシナリオを窓に固定する。**
   *
   * 一覧はヘッダーでLINEアカウントを切り替えると引き直される。窓を開けた
   * まま切り替えると、窓が指しているシナリオがいまの一覧に居なくなる。
   * ここでアカウントIDを見ずに「いまの一覧に居るか」で見ているのは、
   * アカウントの切り替え以外（他の人が消した・検索で外れた）でも同じことが
   * 起きるため。窓は黙って消さず、選び直してもらう。
   */
  const targetStillListed =
    deleteTarget !== null && scenarios.some((s) => s.id === deleteTarget.id)

  /**
   * 削除を投げる。
   *
   * 処理中は受け付けない。二度押しで2回叩くと、2回目は既に消えたものを
   * 指すことになる。失敗は握りつぶさず、窓の中に運用者の言葉で出す。
   */
  const runDelete = async () => {
    if (!deleteTarget || deleting || !targetStillListed) return
    setDeleting(true)
    setDeleteError('')
    try {
      await onDelete(deleteTarget.id)
      setDeleteTarget(null)
    } catch {
      setDeleteError(
        'このシナリオを削除できませんでした。状態を読み直してから、もう一度お試しください。',
      )
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

  /*
   * SCENARIO-17: つまみにフォーカスして ↑/↓ で1つずつ動かす
   * （友だち属性の N-049 と同じ形）。ドラッグと同じく、動かすたびに
   * 見えている順で保存へ渡す。端では動かないことを読み上げるだけにし、
   * 保存は呼ばない。
   */
  const keyboardMove = (id: string, direction: -1 | 1) => {
    const order = scenarios.map((s) => s.id)
    const fromIdx = order.indexOf(id)
    const toIdx = fromIdx + direction
    const name = scenarios.find((s) => s.id === id)?.name ?? 'このシナリオ'
    if (fromIdx < 0 || !onReorder) return
    if (toIdx < 0 || toIdx >= order.length) {
      setMoveNotice(`「${name}」は${direction < 0 ? '先頭' : '末尾'}にあるため、これ以上動かせません`)
      return
    }
    order.splice(toIdx, 0, ...order.splice(fromIdx, 1))
    setMoveNotice(`「${name}」を${direction < 0 ? '上' : '下'}へ移動しました。${toIdx + 1}番目です`)
    onReorder(order)
  }

  /** 行の「その他」の中身。操作はここへ集約する（NEXT-25）。 */
  const rowMenuItems = (s: ScenarioRow): ActionMenuItem[] => {
    const items: ActionMenuItem[] = [
      {
        id: 'toggle',
        label: s.isActive ? '停止する' : '再開する',
        disabled: loading,
        onSelect: () => onToggleActive(s.id, s.isActive),
      },
    ]
    if (canMove) {
      items.push({
        id: 'move',
        label: 'フォルダを移動',
        onSelect: () => openMove([s.id]),
      })
    }
    items.push({
      id: 'delete',
      label: '削除する',
      tone: 'danger',
      dividerBefore: true,
      disabled: loading,
      onSelect: () => {
        setDeleteError('')
        setDeleteTarget(s)
      },
    })
    return items
  }

  /*
   * 窓は一覧が空になっても出したままにする。アカウントを切り替えて一覧が
   * 空になった瞬間に窓ごと消えると、押したはずの確認がどこへ行ったのか
   * 分からなくなる。中で「選び直してください」と伝えて閉じてもらう。
   */
  const confirmDialog = (
    <ConfirmDialog
      open={deleteTarget !== null}
      title={deleteTarget ? `「${deleteTarget.name}」を削除しますか？` : ''}
      description="各通の中身と、購読中の人の進み具合が一緒に消えます。すでに送ったメッセージは友だちの手元に残り、取り消せません。この操作は取り消せません。"
      confirmLabel="削除する"
      destructive
      busy={deleting}
      error={deleteError}
      onConfirm={targetStillListed ? () => void runDelete() : undefined}
      onCancel={() => {
        if (deleting) return
        setDeleteTarget(null)
        setDeleteError('')
      }}
    >
      {deleteTarget && (
        <div className="text-ink-secondary space-y-2 text-sm">
          <p>
            購読中 {(deleteTarget.subscriberCount ?? 0).toLocaleString('ja-JP')}人 ／ 通数{' '}
            {deleteTarget.stepCount === undefined
              ? '— 読み込めませんでした'
              : `${deleteTarget.stepCount}通`}
          </p>
          {deleteTarget.lineAccountId === null && (
            <p className="text-warning font-medium">
              全アカウント共通のシナリオです。すべてのアカウントから消えます。
            </p>
          )}
          {/* 回答フォームや流入経路からの参照は、この一覧では数えていない。
              「0件」と書くと、参照が無いのか数えていないのか分からなくなる。 */}
          <p className="text-ink-faint text-xs">
            回答フォーム・流入経路・計測リンクからの参照は数えられていません。消したあとに参照が外れることがあります。
          </p>
          {!targetStillListed && (
            <p className="text-warning font-medium">
              このシナリオが一覧から外れました（LINEアカウントの切り替えなど）。この窓を閉じて、いまの一覧から選び直してください。
            </p>
          )}
        </div>
      )}
    </ConfirmDialog>
  )

  /*
   * フォルダ移動の窓。1件でも複数件でも同じ形にして、
   * 「1件だけの特別な窓」と「一括だけの窓」の2種類を持たない。
   */
  const moveDialog = (
    <ConfirmDialog
      open={moveIds !== null}
      title={
        moveIds && moveIds.length === 1
          ? `「${scenarios.find((s) => s.id === moveIds[0])?.name ?? 'シナリオ'}」のフォルダを移動`
          : `${moveIds?.length ?? 0}件のシナリオのフォルダを移動`
      }
      description="移動先のフォルダを選んでください。「未分類」を選ぶとフォルダから外れます。"
      confirmLabel={moving ? '移動中…' : '移動する'}
      busy={moving}
      error={moveError}
      onConfirm={() => void runMove()}
      onCancel={() => {
        if (moving) return
        setMoveIds(null)
        setMoveError('')
      }}
    >
      <label className="block">
        <span className="text-ink-secondary mb-1 block text-xs font-medium">移動先のフォルダ</span>
        <select
          value={moveDraft}
          onChange={(event) => setMoveDraft(event.target.value)}
          disabled={moving}
          className="v6-select h-9 w-full rounded-control border border-hairline bg-canvas pl-3 text-sm font-semibold text-ink"
        >
          <option value="">未分類</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
      </label>
    </ConfirmDialog>
  )

  if (scenarios.length === 0) {
    return (
      <>
        <div className="bg-canvas rounded-card border-hairline border p-12 text-center">
          <ListPlus aria-hidden className="text-ink-faint mx-auto" size={24} />
          <p className="text-ink mt-3 text-sm font-bold">まだシナリオがありません</p>
          <p className="text-ink-faint mt-1 text-xs">1つ作ると、順番に届く配信をここで管理できます。</p>
          {onCreate ? (
            <Button
              variant="primary"
              onClick={onCreate}
              className="mt-3"
            >
              ＋ シナリオを作る
            </Button>
          ) : null}
        </div>
        {moveDialog}
        {confirmDialog}
      </>
    )
  }

  return (
    <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
      {/* SCENARIO-17: キーボードで動かした結果を読み上げる。画面には出さない。 */}
      <span className="sr-only" role="status" aria-live="polite">
        {moveNotice}
      </span>
      {/*
        複数選択の一括操作は、選んでいる間だけ表の上に出す帯。
        フォルダ移動の受け口はここと行の「その他」だけに絞る（NEXT-25）。
      */}
      {canMove && selectedCount > 0 && (
        <div className="border-hairline bg-accent-soft flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2">
          <span className="text-ink text-sm font-medium tabular-nums">
            {selectedCount}件を選択中
          </span>
          <button
            type="button"
            onClick={() => openMove([...selectedIds])}
            className="text-action text-sm font-medium hover:underline"
          >
            フォルダを移動
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-ink-faint text-xs hover:underline"
          >
            選択を解除
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        {/*
          名前だけが残り幅を受け取り、ほかの列は内容に合わせて固定する。
          `table-fixed` + `min-w-[640px]` で、フォルダの帯を引いた実幅でも
          名前列に最低 240px 残る。ウインドウ幅ではなく列の合計で決める
          （NEXT-25：1536px のメディアクエリで列を増やす方式は、
          フォルダの帯がある実幅では名前列を潰していた）。
        */}
        <table className="w-full min-w-[640px] table-fixed">
          <colgroup>
            {canMove && <col className="w-10" />}
            <col className="w-10" />
            <col />
            <col className="w-28" />
            <col className="w-24" />
            {/* 枠つき「編集」＋「…」がはみ出さない幅（#641） */}
            <col className="w-36" />
          </colgroup>
          <thead>
            <TableHeadRow>
              {canMove && (
                <Th className="w-10 px-2" aria-label="選択">
                  {/* ★V7 共通 チェックボックス（押せる範囲 24px・一部選択は「―」）。 */}
                  <Checkbox
                    checked={allOnPageSelected}
                    indeterminate={!allOnPageSelected && selectedCount > 0}
                    onCheckedChange={() => toggleAllOnPage()}
                    aria-label="このページのシナリオをすべて選択"
                  />
                </Th>
              )}
              <Th className="w-10 px-2" aria-label="並び替え" />
              <Th>
                シナリオ名
              </Th>
              <Th>
                購読 / 読了
              </Th>
              <Th>
                状態
              </Th>
              <Th aria-label="操作" align="right" />
            </TableHeadRow>
          </thead>
          <tbody className="divide-hairline divide-y">
            {scenarios.map((s) => {
              /*
               * 名前の下の補足行。配信方式・通数・フォルダを短く並べる。
               * フォルダの札は「移す操作」ではなく「いまどこに居るか」だけ。
               */
              const folderName = s.folderId
                ? folders.find((f) => f.id === s.folderId)?.name ?? 'フォルダ'
                : '未分類'
              const showFolder = folders.length > 0 || s.folderId
              const meta = [
                deliveryModeLabels[s.deliveryMode ?? 'relative'],
                s.stepCount === undefined ? '—通' : `${s.stepCount}通`,
                ...(showFolder ? [folderName] : []),
              ].join('・')
              return (
              <tr
                key={s.id}
                className="cursor-pointer hover:bg-canvas-sunken"
                tabIndex={0}
                onClick={() => router.push(`/scenarios/detail?id=${s.id}`)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    router.push(`/scenarios/detail?id=${s.id}`)
                  }
                }}
              >
                {/*
                  行を押したら詳細へ（一覧の決まり）。名前は黒文字の太字。
                  選択・並び替え・操作のセルは行の移動を起こさない。
                */}
                {canMove && (
                  <td className="w-10 px-2 py-3 text-center align-top" onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(s.id)}
                      onCheckedChange={() => toggleOne(s.id)}
                      aria-label={`${s.name}を選択`}
                    />
                  </td>
                )}
                {/*
                  掴んで上下に入れ替える。よく使うものを上に置くための操作。
                  SCENARIO-17: ドラッグはマウス専用なので、中身を
                  フォーカスできるつまみ（ReorderGrip）にして ↑/↓ でも
                  動かせるようにする。セル側の draggable はそのまま残す。
                */}
                <td
                  className="text-ink-faint w-10 cursor-grab px-2 py-3 text-center align-top select-none active:cursor-grabbing"
                  onClick={(event) => event.stopPropagation()}
                  draggable={Boolean(onReorder)}
                  onDragStart={() => setDragId(s.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dropOn(s.id)}
                  title="上下に動かして並び替え"
                >
                  <ReorderGrip
                    label={s.name}
                    disabled={!onReorder}
                    disabledReason="この一覧では並び替えられません"
                    onMove={(direction) => keyboardMove(s.id, direction)}
                  >
                    <span aria-hidden>⠿</span>
                  </ReorderGrip>
                </td>
                {/*
                  説明が長いと、表そのものが横に伸びて横スクロールが出る。
                  桁の幅に上限を付けて、はみ出すぶんは畳む。上限を付けずに
                  line-clamp だけ当てても、桁は中身に合わせて広がる。
                  名前・補足・説明はどれも1行省略で、全文は title で読める。
                */}
                <td className="px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <Link
                        href={`/scenarios/detail?id=${s.id}`}
                        title={s.name}
                        className="text-ink min-w-0 truncate text-sm font-bold hover:text-action hover:underline"
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
                    <p className="text-ink-faint mt-0.5 truncate text-xs" title={meta}>
                      {meta}
                    </p>
                    {s.description && (
                      <p className="text-ink-faint mt-0.5 truncate text-xs" title={s.description}>
                        {s.description}
                      </p>
                    )}
                  </div>
                </td>
                {/*
                  購読中と読了済は1列にまとめる（NEXT-25）。
                  1行目が「いま流れている人」、2行目が「最後まで届いた人」。
                */}
                <td
                  className="px-4 py-3 whitespace-nowrap"
                  title={`購読 ${s.subscriberCount === undefined ? '—' : s.subscriberCount.toLocaleString('ja-JP')}人 ／ 読了 ${(s.completedCount ?? 0).toLocaleString('ja-JP')}人`}
                >
                  <div className="text-ink text-sm tabular-nums">
                    {s.subscriberCount === undefined ? '—' : s.subscriberCount.toLocaleString('ja-JP')}
                    <span className="text-ink-faint ml-0.5 text-xs">人</span>
                  </div>
                  <div className="text-ink-faint text-xs tabular-nums">
                    読了 {(s.completedCount ?? 0).toLocaleString('ja-JP')}人
                  </div>
                  {/*
                    0人のとき、作っただけでは配信されないことに気づけない。
                    始め方への導線をその場に出す。
                  */}
                  {s.subscriberCount === 0 && (
                    <Link
                      href={`/scenarios/detail?id=${s.id}`}
                      title="配信を始める方法"
                      className="text-info mt-0.5 block truncate text-xs font-normal hover:underline"
                    >
                      配信を始める方法
                    </Link>
                  )}
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
                {/*
                  操作は「編集」＋「その他（…）」の2口だけ（NEXT-25）。
                  停止・再開・フォルダ移動・削除は「その他」の中へ集約して、
                  右端の列を狭く保つ。
                */}
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <div className="relative inline-flex items-center justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
                    {/* #641: 編集も「その他」と同じ枠つきボタンにそろえる（友だち追加時配信と同じ形） */}
                    <Button href={`/scenarios/detail?id=${s.id}`} variant="secondary">
                      編集
                    </Button>
                    {/*
                      **撮影の入口。**文言（「停止」「再開」）で探すと、言葉を
                      変えたときに撮影が黙って空振りする。Node ID を付ける。
                      止めている行の「その他」が、配信開始の確認（RUxNf）への
                      入口になる。押すとメニューが開き、「再開する」が確認へ進む。
                    */}
                    <MoreAction
                      label={`${s.name}のその他操作`}
                      data-qa-open={s.isActive ? undefined : 'RUxNf'}
                      aria-expanded={openMenuId === s.id}
                      disabled={loading}
                      onClick={() =>
                        setOpenMenuId((current) => (current === s.id ? null : s.id))
                      }
                    />
                    <ActionMenu
                      open={openMenuId === s.id}
                      ariaLabel={`${s.name}の操作`}
                      onClose={() => setOpenMenuId(null)}
                      items={rowMenuItems(s)}
                    />
                  </div>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {confirmDialog}
      {moveDialog}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { SupportMark } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import ConfirmDialog from '@/components/shared/confirm-dialog'

type MarkRow = SupportMark & { friendCount: number }

const PRESET_COLORS = ['#F59E0B', '#3B82F6', '#10B981', '#EF4444', '#8B5CF6', '#94A3B8']

/**
 * 対応マークの管理。
 *
 * 別画面にせず、この場で足して直せるようにしている。項目が3〜5個で
 * 済むものに作成画面を作ると、行き来の方が手間になる。
 */
export default function SupportMarkList({ accountId }: { accountId: string | null }) {
  const [items, setItems] = useState<MarkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [adding, setAdding] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<MarkRow | null>(null)
  const defaultMark = items.find((item) => item.isDefault)

  const load = useCallback(async () => {
    if (!accountId) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await api.supportMarks.list(accountId)
      if (res.success) setItems(res.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  const add = async () => {
    const trimmed = name.trim()
    if (!trimmed || !accountId) return
    setAdding(true)
    setError('')
    try {
      await api.supportMarks.create(accountId, { name: trimmed, color, displayOrder: items.length })
      setName('')
      void load()
    } catch {
      setError('追加に失敗しました')
    } finally {
      setAdding(false)
    }
  }

  const patch = async (mark: MarkRow, data: Parameters<typeof api.supportMarks.update>[2]) => {
    if (!accountId) return
    setError('')
    try {
      const res = await api.supportMarks.update(mark.id, accountId, data)
      if (!res.success) {
        setError(res.error)
        return
      }
      void load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存に失敗しました')
    }
  }

  const remove = (mark: MarkRow) => {
    setPendingDelete(mark)
  }

  const confirmRemove = async (mark: MarkRow) => {
    if (!accountId) return
    setError('')
    try {
      const res = await api.supportMarks.delete(mark.id, accountId, { force: mark.friendCount > 0 })
      if (!res.success) {
        setError(res.error)
        return
      }
      void load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '削除に失敗しました')
    }
  }

  return (
    <div>
      <p className="text-ink-secondary mb-4 text-sm">
        友だち一人ひとりの対応状況を表す印です。受信箱のトークの状態とは別に、
        友だちそのものに付きます。
      </p>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      <div className="bg-canvas rounded-card border-hairline overflow-hidden border [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
        <table className="w-full table-fixed">
          <thead>
            <tr className="bg-canvas-sunken border-hairline border-b">
              <th className="text-ink-faint w-[28%] px-4 py-3 text-left text-xs font-semibold uppercase">
                マーク名
              </th>
              {/* 列の順は設計の絵どおり。初期値が名前のすぐ隣に来る。
                  どのマークが新しい友だちに付くかは、人数より先に見る。 */}
              <th className="text-ink-faint w-[18%] px-4 py-3 text-left text-xs font-semibold uppercase">
                新規の初期値
              </th>
              <th className="text-ink-faint w-[18%] px-4 py-3 text-left text-xs font-semibold uppercase">
                いまの人数
              </th>
              <th className="text-ink-faint w-[24%] px-4 py-3 text-left text-xs font-semibold uppercase">
                自動で変わるとき
              </th>
              <th className="w-[12%] px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="text-ink-faint px-4 py-8 text-center text-sm">
                  読み込み中...
                </td>
              </tr>
            ) : (
              items.map((mark) => (
                <tr key={mark.id} className="hover:bg-canvas-sunken">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ backgroundColor: mark.color }}
                      />
                      <span className="text-ink truncate text-sm font-medium" title={mark.name}>{mark.name}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {/* 初期値は1つだけ。選ばれているものは札で出す。
                        丸だけだと、どれが初期値かを目で追う必要がある。 */}
                    {mark.isDefault ? (
                      <span className="bg-info-bg text-info rounded-pill px-2 py-0.5 text-[11px] font-medium">
                        初期値
                      </span>
                    ) : (
                      <label className="text-ink-faint inline-flex cursor-pointer items-center gap-1.5 text-xs">
                        <input
                          type="radio"
                          name="default-mark"
                          checked={false}
                          onChange={() => patch(mark, { isDefault: true })}
                          aria-label={`${mark.name}を初期値にする`}
                          className="accent-accent"
                        />
                        —
                      </label>
                    )}
                  </td>
                  <td className="text-ink-secondary px-4 py-3 text-sm tabular-nums">
                    {mark.friendCount}
                    <span className="text-ink-faint ml-0.5 text-xs">人</span>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={mark.autoOnInbound}
                      onChange={(e) => patch(mark, { autoOnInbound: e.target.checked })}
                      aria-label={`${mark.name}を受信時に自動で付ける`}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => remove(mark)}
                      disabled={mark.isDefault}
                      title={mark.isDefault ? '初期値のマークは削除できません' : undefined}
                      className="hover:bg-danger-bg text-danger rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-30"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-canvas rounded-card border-hairline mt-4 flex flex-wrap items-end gap-3 border p-4 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
        <div>
          <label htmlFor="mark-name" className="text-ink-faint mb-1 block text-xs font-semibold">
            マークの名前
          </label>
          <input
            id="mark-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add()
            }}
            placeholder="例: 折り返し待ち"
            className="border-hairline rounded-control w-48 border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <span className="text-ink-faint mb-1 block text-xs font-semibold">色</span>
          <div className="flex items-center gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`色 ${c}`}
                className={`h-7 w-7 rounded-full transition-transform ${
                  color === c ? 'ring-hairline scale-110 ring-2 ring-offset-2' : 'hover:scale-110'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <button
          onClick={add}
          disabled={adding || !name.trim()}
          className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {adding ? '追加中...' : 'マークを追加'}
        </button>
      </div>

      <p className="text-ink-faint mt-3 text-xs leading-relaxed">
        初期値のマークは削除できません。先に別のマークを初期値にしてください。
        初期値が1つも無いと、新しい友だちに何も付かなくなるためです。
      </p>

      {/*
        どこで使われているか。マークを消す・増やす前に、どこに響くかが
        分かるようにする。設計でもこの位置に置かれている。行き先を
        持たせて、その場で見に行けるようにした。
      */}
      <section className="bg-canvas rounded-card border-hairline mt-4 border p-5 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
        <p className="text-ink mb-3 text-sm font-semibold">どこで使われているか</p>
        <ul className="divide-hairline divide-y">
          {[
            { label: '受信箱の絞り込み', href: '/chats' },
            { label: '友だち一覧の列と絞り込み', href: '/friends' },
            { label: 'ダッシュボードの対応状況', href: '/' },
            { label: '配信の絞り込み条件', href: '/broadcasts' },
            { label: 'オートメーションの動作', href: '/automations' },
          ].map((row) => (
            <li key={row.label}>
              <Link
                href={row.href}
                className="text-ink-secondary hover:text-ink flex items-center justify-between gap-2 py-2.5 text-sm"
              >
                {row.label}
                <span className="text-ink-faint shrink-0 text-xs">›</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <ConfirmDialog
        open={pendingDelete !== null}
        title={`対応マーク「${pendingDelete?.name ?? ''}」を削除しますか？`}
        description={
          (pendingDelete?.friendCount ?? 0) > 0
            ? `${pendingDelete?.friendCount ?? 0} 人の対応マークは、削除後に「${defaultMark?.name ?? '初期値'}」へ変更されます。この操作は元に戻せません。`
            : 'この対応マークを削除します。この操作は元に戻せません。'
        }
        confirmLabel="削除する"
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete
          setPendingDelete(null)
          if (target) void confirmRemove(target)
        }}
      />
    </div>
  )
}

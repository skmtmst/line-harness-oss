'use client'

import React from 'react'
import ContextMenu from '../context-menu'
import DetailPanel, { useDetailPanelUrl } from '../detail-panel'

export type BroadcastRow = {
  id: string
  title: string
  status: string
  sentAt: string
}

/**
 * 一斉配信の一覧での使い方の例（V8「サクサク感」C①③）。
 * 行の右クリックで操作メニュー、行を押すと右から詳細パネル。
 * 中身は必ず呼び出し側が API の実データを渡す（ここに数は書かない）。
 */
export default function BroadcastListExample({ rows }: { rows: BroadcastRow[] }) {
  const [activeId, setActiveId] = useDetailPanelUrl('row')
  const active = rows.find((row) => row.id === activeId) ?? null
  const activeIndex = rows.findIndex((row) => row.id === activeId)

  return (
    <div>
      <table>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <ContextMenu
                  label={`${row.title}の操作`}
                  items={[
                    { id: 'open', label: '詳細を見る', onSelect: () => setActiveId(row.id) },
                    { id: 'copy', label: '複製する', onSelect: () => setActiveId(row.id) },
                  ]}
                >
                  <button type="button" onClick={() => setActiveId(row.id)}>
                    {row.title}
                  </button>
                </ContextMenu>
              </td>
              <td>{row.status}</td>
              <td>{row.sentAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <DetailPanel
        title={active?.title ?? ''}
        open={active !== null}
        onClose={() => setActiveId(null)}
        hasPrev={activeIndex > 0}
        hasNext={activeIndex >= 0 && activeIndex < rows.length - 1}
        onPrev={() => setActiveId(rows[activeIndex - 1]?.id ?? null)}
        onNext={() => setActiveId(rows[activeIndex + 1]?.id ?? null)}
      >
        <p>{active?.status}</p>
        <p>{active?.sentAt}</p>
      </DetailPanel>
    </div>
  )
}

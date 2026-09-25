'use client'

/**
 * 版の比べる（汎用）。行ごとに比べ、変わった所だけ色を付ける。
 * 消えた行は赤の地に「-」、足した行は緑の地に「+」。
 * 色だけにせず、印も必ず付ける。
 */

type DiffRow =
  | { kind: 'same'; text: string; key: string }
  | { kind: 'removed'; text: string; key: string }
  | { kind: 'added'; text: string; key: string }

/** 行単位の差分。小さい表だけに使う（版の本文想定）。 */
export function diffLines(before: string, after: string): DiffRow[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const n = a.length
  const m = b.length
  // LCS 表。版の本文は短いので素直に組む。
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j]
        ? (table[i + 1][j + 1] + 1)
        : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: 'same', text: a[i], key: `same-${i}-${j}` })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      rows.push({ kind: 'removed', text: a[i], key: `removed-${i}` })
      i += 1
    } else {
      rows.push({ kind: 'added', text: b[j], key: `added-${j}` })
      j += 1
    }
  }
  while (i < n) {
    rows.push({ kind: 'removed', text: a[i], key: `removed-${i}` })
    i += 1
  }
  while (j < m) {
    rows.push({ kind: 'added', text: b[j], key: `added-${j}` })
    j += 1
  }
  return rows
}

export default function VersionCompare({ before, after }: { before: string; after: string }) {
  const rows = diffLines(before, after)
  if (rows.length === 0) {
    return <p className="text-ink-faint text-xs">変わった所はありません。</p>
  }
  return (
    <div className="flex flex-col gap-1" role="table" aria-label="版の比べる">
      {rows.map((row) => {
        if (row.kind === 'same') {
          return (
            <p key={row.key} className="text-ink-secondary truncate px-2 py-1 text-xs" title={row.text}>
              {row.text === '' ? ' ' : row.text}
            </p>
          )
        }
        const removed = row.kind === 'removed'
        return (
          <p
            key={row.key}
            className={
              removed
                ? 'flex items-start gap-1.5 truncate rounded-card bg-danger-bg px-2 py-1 text-xs text-ink'
                : 'flex items-start gap-1.5 truncate rounded-card bg-success-bg px-2 py-1 text-xs text-ink'
            }
            title={row.text}
          >
            <span className="shrink-0 font-bold" title={removed ? '消えた行' : '足した行'}>
              {removed ? '－' : '＋'}
            </span>
            <span className="min-w-0 flex-1 truncate">{row.text === '' ? ' ' : row.text}</span>
          </p>
        )
      })}
    </div>
  )
}

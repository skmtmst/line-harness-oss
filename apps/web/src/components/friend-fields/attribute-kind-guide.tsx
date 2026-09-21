'use client'

import Link from 'next/link'

/*
 * IDEA-04（issue #1022）：分類の使い分けと重複候補。
 *
 * 4つの分類（タグ・友だち情報欄・対応マーク・保存した検索）はどれも
 * 「友だちの属性」だが、持つものが違う。初めて触る人が「いま作って
 * いるものは何で、別の分類を選ぶべき場面はどれか」を作る場所で
 * 確認できるようにする。独立した属性辞書メニューは作らない方針なので、
 * 既存の作成・編集画面に小さな開閉案内として置く。
 */

export type AttributeKind = 'tag' | 'field' | 'mark' | 'search'

type KindGuide = {
  /** 分類の呼び名（タブと同じ言葉） */
  label: string
  /** どんなものを持つ分類か */
  holds: string
  /** こちらを選ぶ場面 */
  useWhen: string
  /** 作る入口。保存した検索は専用画面が無く、友だち一覧の絞り込みから保存する */
  createHref: string
  createLabel: string
}

const KIND_GUIDE: Record<AttributeKind, KindGuide> = {
  tag: {
    label: 'タグ',
    holds: '友だちに付け外しできる印',
    useWhen: '配信の絞り込み・マイル付与・連動アクションのきっかけにしたい',
    createHref: '/tags/new',
    createLabel: 'タグを作る',
  },
  field: {
    label: '友だち情報欄',
    holds: '誕生日・会員番号など友だちごとの値',
    useWhen: '型を決めて値を保存し、テンプレートに差し込みたい',
    createHref: '/tags/fields/new',
    createLabel: '項目を追加',
  },
  mark: {
    label: '対応マーク',
    holds: '要確認・対応中など問い合わせ対応の状態',
    useWhen: '受信箱・一覧で対応の進み具合を色で管理したい',
    createHref: '/tags/marks/new',
    createLabel: 'マークを追加',
  },
  search: {
    label: '保存した検索',
    holds: '何度も使う絞り込み条件',
    useWhen: '条件を保存して一覧・配信・自動処理から呼び出したい',
    createHref: '/friends',
    createLabel: '友だち一覧で条件を作る',
  },
}

const KIND_ORDER: AttributeKind[] = ['tag', 'field', 'mark', 'search']

/**
 * 分類の使い分け案内。作成・編集画面の既存カード内に置く開閉式の説明。
 * 新しい見出し・タイトルバーは増やさず、details で畳んでおく。
 */
export function AttributeKindGuide({ current }: { current: AttributeKind }) {
  return (
    <details className="rounded-control border border-hairline bg-canvas px-3 py-2 text-xs text-ink-faint">
      <summary className="cursor-pointer font-semibold text-ink-secondary">
        分類の使い分け（いま選択中：{KIND_GUIDE[current].label}）
      </summary>
      <ul className="mt-2 space-y-2">
        {KIND_ORDER.map((kind) => {
          const guide = KIND_GUIDE[kind]
          const isCurrent = kind === current
          return (
            <li key={kind} className={isCurrent ? 'rounded-control bg-accent-soft p-2' : 'p-2'}>
              <p className="font-semibold text-ink">
                {guide.label}
                {isCurrent ? <span className="ml-1 rounded-pill bg-accent px-2 py-0.5 text-[10px] font-bold text-on-accent">この画面</span> : null}
              </p>
              <p className="mt-0.5 leading-5">{guide.holds}。{guide.useWhen}ときに選びます。</p>
              {!isCurrent ? (
                <Link href={guide.createHref} className="mt-0.5 inline-block font-semibold text-action hover:underline">
                  {guide.createLabel} →
                </Link>
              ) : null}
            </li>
          )
        })}
      </ul>
    </details>
  )
}

/*
 * 重複名の比べ方。サーバーが整理候補 `duplicate_name` を付けるときの
 * 正規化（NFKC → 前後空白除去 → 連続空白を1つ → 小文字化）と揃える。
 * 画面だけ別の比べ方をすると、「同じ名前なのに重複名にならない」
 * 逆も起きて、作る前の注意と一覧の整理候補が食い違う。
 */
export function normalizeAttributeName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ja-JP')
}

/**
 * 入力中の名前と同じ正規化名を持つ既存の定義を返す。
 * `selfId` は編集中の自分自身を外すためのもの。
 */
export function findDuplicateNames(
  existing: ReadonlyArray<{ id: string; name: string }>,
  candidateName: string,
  selfId?: string | null,
): string[] {
  const normalized = normalizeAttributeName(candidateName)
  if (!normalized) return []
  return existing
    .filter((item) => item.id !== selfId && normalizeAttributeName(item.name) === normalized)
    .map((item) => item.name)
}

/**
 * 同名の候補がすでにあることを、保存する前に知らせる注意書き。
 * 保存を止めはしない（同名を禁じるかはサーバーが決める）が、
 * 重複名が整理候補になることは先に伝える。
 */
export function DuplicateNameNote({ duplicates, kindLabel }: { duplicates: string[]; kindLabel: string }) {
  if (duplicates.length === 0) return null
  const shown = duplicates.slice(0, 3).map((name) => `「${name}」`).join('・')
  const rest = duplicates.length > 3 ? ` ほか${duplicates.length - 3}件` : ''
  return (
    <p className="mt-1.5 text-xs leading-5 text-status-warn-deep">
      同じ名前の{kindLabel}がすでにあります（{shown}{rest}）。このまま作ると一覧の重複名の整理候補に出ます。
    </p>
  )
}

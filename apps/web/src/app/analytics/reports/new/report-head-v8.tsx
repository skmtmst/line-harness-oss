'use client'
import { PageHeading } from '@/components/templates/page-frame'

import './report-v8.css'



/**
 * 定期レポート作成のV8見出し。板 `H5UoIu`（更新の競合時は `G83vi`）。
 *
 * `page.tsx` は `PageHeader` の仕組みに寄せる決まり（本文に h1 を直書き
 * しない）のため、V8 の見出しだけをここに置く。見た目は変えない。
 */
export default function ReportHeadV8({ editing }: { editing: boolean }) {
  /* ★V8 は板の頭に「← 分析へ」を置かない（オーナー 2026-10-08）。分析へは上の帯のパンくずで戻る。 */
  return <div data-page-template="create"><PageHeading
    title={editing ? '定期レポートを直す' : 'レポートを作る'}
    help="見たい数をまとめて、決まった曜日・時刻に LINE やメールで届けます。数が急に動いたときだけ知らせることもできます。"
  /></div>
}

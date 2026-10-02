'use client'

import { useState } from 'react'
import { CheckCheck, MessageSquare, Send, Tag, Users } from 'lucide-react'
import SampleScreenNotice from '@/components/ui/sample-screen-notice'
import ColorWell from '@/components/shared/color-well'
import DeleteButton from '@/components/shared/delete-button'
import OtpInput from '@/components/shared/otp-input'
import TextLink from '@/components/shared/text-link'
import DeltaChip from '@/components/shared/delta-chip'
import IconTile from '@/components/shared/icon-tile'
import ActivityItem from '@/components/shared/activity-item'
import SectionHeader from '@/components/shared/section-header'
import CheckCard from '@/components/shared/check-card'
import SegmentedControl from '@/components/shared/segmented'
import StatusBadge from '@/components/shared/status-badge'

/*
 * ★V8 で新たに生えた部品（Pencil「OTP・削除・色を選ぶ」の節）の
 * 見た目・動き照合用。固定の見本で、実際の削除・認証は行わない。
 *
 *   OTP入力     打つと次の桁へ。全部そろった見本・まちがえた見本も並べる
 *   削除ボタン  ゴミ箱のタイル → 押すと右へ ✓/× の確認が開く（Escでも戻る）
 *   色を選ぶ    macOS のカラーウェル。押すと色の格子と十六進の欄が開く
 */
export default function V8PartsPage() {
  const [code, setCode] = useState('')
  const [color, setColor] = useState('#06c755')
  const [deleted, setDeleted] = useState(false)
  const [checks, setChecks] = useState({ a: true, b: false })
  const [segment, setSegment] = useState('30d')

  return (
    <main className="mx-auto max-w-3xl space-y-10 p-8">
      <SampleScreenNotice what="V8 で新たに生えた部品" backHref="/settings" backLabel="設定へ戻る" />

      <section>
        <h2 className="text-sm font-bold text-ink">OTP入力（2段階認証の6桁）</h2>
        <div className="otp-part mt-3 w-fit">
          <p className="mb-1.5 text-label font-medium text-ink">認証コード（6桁）</p>
          <OtpInput value={code} onChange={setCode} label="認証コード" />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-8">
          <div>
            <p className="text-xs text-ink-faint">確認できた（緑の輪郭が順に灯る）</p>
            <div className="mt-2">
              <OtpInput value="483920" onChange={() => {}} success label="認証コード（確認できた見本）" />
            </div>
          </div>
          <div>
            <p className="text-xs text-ink-faint">まちがえた（横に揺れる）</p>
            <div className="mt-2">
              <OtpInput value="111111" onChange={() => {}} invalid label="認証コード（まちがえた見本）" />
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-ink">削除ボタン（2段階の小さな確認）</h2>
        <div className="mt-3 flex items-center gap-4">
          {deleted ? (
            <span className="text-xs text-ink-secondary">削除しました（見本）</span>
          ) : (
            <DeleteButton onConfirm={() => setDeleted(true)} label="この項目を削除" />
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-ink">リンク（→つき。乗せると矢印が右へ）</h2>
        <div className="mt-3 flex items-center gap-6">
          <TextLink href="/friends">受信箱を開く</TextLink>
          <TextLink href="/settings">配信設定へ</TextLink>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-ink">状態の札（送信済み・対応済み）</h2>
        <div className="mt-3 flex items-center gap-3">
          <StatusBadge tone="success">送信済み</StatusBadge>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-ink">増減の札（良い・悪い・要確認）</h2>
        <div className="mt-3 flex items-center gap-3">
          <DeltaChip tone="up">+2.6%</DeltaChip>
          <DeltaChip tone="down">−1.1pt</DeltaChip>
          <DeltaChip tone="attention">要確認</DeltaChip>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-ink">印のタイル（小・中・大）</h2>
        <div className="mt-3 flex items-end gap-4">
          <IconTile icon={MessageSquare} size="sm" />
          <IconTile icon={MessageSquare} size="md" />
          <IconTile icon={MessageSquare} size="lg" />
          <IconTile icon={Users} size="md" />
          <IconTile icon={Tag} size="md" />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-ink">動きの行（履歴が縦に繋がる）</h2>
        <div className="mt-3 max-w-md">
          <ActivityItem icon={Send} title="予約配信を送りました" note="朝のお知らせ・128人へ" time="10:42" />
          <ActivityItem icon={CheckCheck} title="全員に届きました" note="失敗 0 件" time="10:44" />
          <ActivityItem icon={Users} title="友だちが3人増えました" time="12:10" last />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-ink">段の題（補足・？・右にリンク）</h2>
        <div className="mt-3 max-w-md space-y-4">
          <SectionHeader title="最近の動き" note="この30日" href="/friends" linkLabel="すべて見る" />
          <SectionHeader
            title="今月の完了率"
            helpLabel="今月の完了率の説明"
            help="完了した配信 ÷ 予約した配信。失敗や取消は完了に含みません。"
            href="/analytics"
            linkLabel="分析で見る"
          />
          <SectionHeader title="題だけ" />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-ink">チェックのカード（選ぶと緑に）</h2>
        <div className="mt-3 max-w-md space-y-2">
          <CheckCard
            checked={checks.a}
            onChange={(v) => setChecks((c) => ({ ...c, a: v }))}
            title="友だち全員に送る"
            note="登録している全員が対象になります"
          />
          <CheckCard
            checked={checks.b}
            onChange={(v) => setChecks((c) => ({ ...c, b: v }))}
            title="タグで絞る"
            note="選んだタグの人だけに届きます"
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-ink">切り替え（3つ。白いつまみが滑る）</h2>
        <div className="mt-3">
          <SegmentedControl
            aria-label="期間"
            options={[
              { value: '7d', label: '7日' },
              { value: '30d', label: '30日' },
              { value: '90d', label: '90日' },
            ]}
            value={segment}
            onChange={setSegment}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-ink">色を選ぶ（macOS のカラーウェル）</h2>
        <div className="mt-3 flex items-center gap-4">
          <ColorWell value={color} onChange={setColor} label="アクセントカラー" />
          <span className="text-xs tabular-nums text-ink-secondary">{color}</span>
        </div>
        {/* ポップは下へ開くので、下の節が重ならないよう高さを空ける。 */}
        <div className="h-72" />
      </section>
    </main>
  )
}

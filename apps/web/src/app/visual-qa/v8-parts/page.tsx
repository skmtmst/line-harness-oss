'use client'

import { useState } from 'react'
import SampleScreenNotice from '@/components/ui/sample-screen-notice'
import ColorWell from '@/components/shared/color-well'
import DeleteButton from '@/components/shared/delete-button'
import OtpInput from '@/components/shared/otp-input'

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

  return (
    <main className="mx-auto max-w-3xl space-y-10 p-8">
      <SampleScreenNotice what="V8 で新たに生えた部品" backHref="/settings" backLabel="設定へ戻る" />

      <section>
        <h2 className="text-sm font-bold text-ink">OTP入力（2段階認証の6桁）</h2>
        <div className="mt-3">
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

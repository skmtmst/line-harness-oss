'use client'

import SampleScreenNotice from '@/components/ui/sample-screen-notice'
import TargetMissing from '@/components/shared/target-missing'

/*
 * ★V7 開き先がない（x5cgUH）の見た目照合用。固定の見本データ。
 * 実際のデータの閲覧・編集はできない（SampleScreenNotice を頭に置く）。
 *
 * 設計の書き出しと同じ並び。3つの状態を縦に積む。
 * 見出しは「何が」＋「どうなっているか」の1文。英語・id は出さない。
 */

export default function V7TargetMissingVisualQaPage() {
  return (
    <>
      <SampleScreenNotice
        what="★V7 開き先がない（TargetMissing）の表示確認"
        backHref="/"
        backLabel="トップへ戻る"
      />
      <div className="space-y-10 p-6">
        <section className="space-y-2">
          <h2 className="text-base font-bold">1. 指定されていない（URL に id が無い）</h2>
          <TargetMissing
            kind="unspecified"
            title="編集するテンプレートが指定されていません"
            description="一覧から、開きたいテンプレートを選んでください。"
            backHref="/templates"
            backLabel="テンプレートの一覧へ戻る"
          />
        </section>
        <section className="space-y-2">
          <h2 className="text-base font-bold">2. 見つからない（消された・別アカウント）</h2>
          <TargetMissing
            kind="not-found"
            title="このテンプレートは見つかりません"
            description="削除されたか、別の LINE アカウントのものです。"
            accountName="然-NEN-TEST"
            backHref="/templates"
            backLabel="テンプレートの一覧へ戻る"
          />
        </section>
        <section className="space-y-2">
          <h2 className="text-base font-bold">3. 読み込めない（通信・サーバの失敗）</h2>
          <TargetMissing
            kind="error"
            title="テンプレートを読み込めませんでした"
            description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
            onRetry={() => {}}
          />
        </section>
      </div>
    </>
  )
}

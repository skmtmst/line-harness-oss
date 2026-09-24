'use client'

/*
 * ★V7 処理の進み（xiHO8）・添付ファイルの行／ファイルを落とす場所（NQMnx）の見本。
 * 設計画像との照合用に、設計と同じ並び・同じ見本の文字で固定表示する。
 * ボタンは押しても何も起きない（noop）。
 */
import { FileText, Film, Image as ImageIcon } from 'lucide-react'
import FileDropzone, { AttachmentRow } from '@/components/shared/file-drop'
import Progress from '@/components/shared/progress'
import SampleScreenNotice from '@/components/ui/sample-screen-notice'

const noop = () => {}

function StateCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-hairline bg-canvas p-5" style={{ width: 420 }}>
      {children}
    </div>
  )
}

export default function V7ProgressFiledropVisualQaPage() {
  return (
    <>
      {/* 固定データの検証画面であることを直リンクでも判別できるようにする。 */}
      <SampleScreenNotice
        what="★V7 処理の進み・添付ファイルの見本"
        backHref="/"
        backLabel="トップへ戻る"
      />
      <div className="bg-canvas p-12">
        <h1 className="text-xl font-bold text-ink">★V7 処理の進み（Progress）</h1>
        <p className="mt-2 text-sm text-ink-secondary">
          一斉配信の送信・CSV取り込み・一括操作で「押した後いま何が起きているか」を見せる（大胆案 E #1074
          と同じ場面）。数が分かる時は数と割合、分からない時は段階の名前。棒の伸びは幅ではなく scaleX で動かす（周りが揺れない）。
        </p>
        <h2 className="mt-6 text-base font-bold text-ink">1. 状態（一斉配信の送信を例に）</h2>
        <div className="mt-4 flex flex-row flex-wrap gap-6">
          <StateCard>
            <Progress
              state="preparing"
              title="送る準備をしています"
              note="宛先を数えています。この画面を閉じても止まりません。"
            />
          </StateCard>
          <StateCard>
            <Progress
              state="active"
              title="送っています"
              percent={62}
              countText="1,240 / 2,000 人"
              remainingText="あと約2分"
              onCancel={noop}
            />
          </StateCard>
          <StateCard>
            <Progress
              state="done"
              title="2,000人に送りました"
              note="9月24日 10:32 に完了。既読は明日の朝から数えます。"
            />
          </StateCard>
          <StateCard>
            <Progress
              state="partial"
              title="1,988人に送り、12人に届きませんでした"
              percent={99.4}
              onSeeFailures={noop}
              failuresLabel="届かなかった12人を見る"
            />
          </StateCard>
        </div>

        <h1 className="mt-12 text-xl font-bold text-ink">★V7 添付ファイルの行（Attachment）・ファイルを落とす場所（Dropzone）</h1>
        <p className="mt-2 text-sm text-ink-secondary">
          受信箱の返信欄・配信の画像・登録メディアの取り込みでばらばらだった見せ方をそろえる。参考：kobra の
          Attachment・Magnetic Dropzone。引き寄せる動きは採らない（控えめに）。キーボードでも「ファイルを選ぶ」で同じことができる。
        </p>
        <h2 className="mt-6 text-base font-bold text-ink">1. 添付ファイルの行</h2>
        <div className="mt-4 flex flex-col gap-2" style={{ width: 520 }}>
          <AttachmentRow
            name="商品写真_秋.jpg"
            meta="JPEG・1.2MB"
            tone="photo"
            thumbnail={<ImageIcon aria-hidden="true" size={18} />}
            onRemove={noop}
          />
          <AttachmentRow
            name="ご案内.pdf"
            meta="PDF・340KB"
            thumbnail={<FileText aria-hidden="true" size={18} />}
            onRemove={noop}
          />
          <AttachmentRow
            name="キャンペーン動画.mp4"
            status="uploading"
            percent={64}
            thumbnail={<Film aria-hidden="true" size={18} />}
            onRemove={noop}
          />
          <AttachmentRow
            name="大きすぎる画像.png"
            status="error"
            errorText="10MBを超えています。10MB以下の画像を選んでください"
            thumbnail={<ImageIcon aria-hidden="true" size={18} />}
            onRemove={noop}
            onRetry={noop}
          />
        </div>

        <h2 className="mt-6 text-base font-bold text-ink">2. ファイルを落とす場所</h2>
        <div className="mt-4 flex flex-row flex-wrap gap-7">
          <div style={{ width: 400 }}>
            <FileDropzone title="ここに画像を落とす" hint="JPEG・PNG、10MB まで" onFiles={noop} />
          </div>
          <div style={{ width: 400 }}>
            <FileDropzone title="ここに画像を落とす" previewState="active" onFiles={noop} />
          </div>
          <div style={{ width: 400 }}>
            <FileDropzone
              title="ここに画像を落とす"
              previewState="reject"
              rejectTitle="動画は追加できません"
              rejectHint="JPEG・PNG だけ"
              onFiles={noop}
            />
          </div>
          <div style={{ width: 400 }}>
            <FileDropzone
              title="ここに画像を落とす"
              busy
              busyTitle="3件を取り込んでいます…"
              busyNote="この画面を閉じても止まりません"
              onFiles={noop}
            />
          </div>
        </div>
      </div>
    </>
  )
}

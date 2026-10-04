'use client'

// 共通部品の目視・実測用。左メニューには登録しない。
import { useState } from 'react'
import { Plus, Send, Tag } from 'lucide-react'
import RadioCard from '@/components/shared/radio-card'
import CheckCard from '@/components/shared/check-card'
import { Toast } from '@/components/shared/toast'
import HelpTip from '@/components/shared/help-tip'
import Notice from '@/components/shared/notice'
import Dialog, { DialogSteps } from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import { SkeletonRow } from '@/components/shared/skeleton'
import LinePreview, { LinePreviewCard, LinePreviewMessage } from '@/components/shared/line-preview'
import Button from '@/components/shared/button'
import styles from './parts.module.css'

const imageUrl = 'https://images.unsplash.com/photo-1764660140273-15e2883094f4?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w4NDM0ODN8MHwxfHJhbmRvbXx8fHx8fHx8fDE3OTA3NjAxNTl8&ixlib=rb-4.1.0&q=80&w=1080'

export default function V8PartsPage() {
  const [radio, setRadio] = useState('on')
  const [checks, setChecks] = useState([true, false])
  const [result, setResult] = useState('')
  const [dialogOpen, setDialogOpen] = useState(true)
  return <div className={styles.gallery} data-parts-lane="cards">
    <h1>V8 共通部品 · cards</h1>
    <p>確認用の固定データです。操作すると下に結果を表示します。</p>
    <div className={styles.samples}>
      {['fNPdg', 'r3xz1W'].map((id, index) => <section key={id}><h2>{id} · 選ぶカード</h2>
        <div data-sample={id} style={{ width: 220 }}><RadioCard name="sample-radio" value={index === 0 ? 'on' : 'off'} checked={radio === (index === 0 ? 'on' : 'off')} onChange={setRadio} title="タグで絞る" note="付いているタグで選ぶ" /></div>
      </section>)}
      {['w6uYMd', 'RRxK5'].map((id, index) => <section key={id}><h2>{id} · チェックのカード</h2>
        <div data-sample={id} style={{ width: 420 }}><CheckCard checked={checks[index]} onChange={value => setChecks(old => old.map((item, i) => i === index ? value : item))} title="ブロック中の人を除く" note="ブロック・非表示の 17人には送りません" /></div>
      </section>)}
      <section><h2>Q6cQB · 知らせ／成功</h2><div data-sample="Q6cQB"><Toast item={{ tone: 'success', message: '3人から「VIP」を外しました', actionLabel: '元に戻す', onAction: () => setResult('元に戻しました') }} /></div></section>
      <section><h2>tnWX9 · 知らせ／失敗</h2><div data-sample="tnWX9"><Toast item={{ tone: 'error', message: '保存できませんでした。入力は残っています', actionLabel: 'もう一度', onAction: () => setResult('再試行しました') }} /></div></section>
      <section><h2>f6zwfs · ふきだし</h2><div data-sample="f6zwfs" className={styles.tipSample}><HelpTip label="日時の説明">2026年9月26日（土）10:00</HelpTip></div></section>
      <section><h2>ThDed · 案内</h2><div data-sample="ThDed" style={{ width: 520 }}><Notice tone="info" message="作成しただけでは配信されません。開始条件を設定すると配信が始まります。" /></div></section>
      <section><h2>q3DPdz · ダイアログ／中</h2><div data-sample="q3DPdz">
        <Dialog open={dialogOpen} modal={false} title="担当者を招待する" description="できることと見えるものを決めます" onCancel={() => setDialogOpen(false)} onConfirm={() => setResult('招待しました')} cancelLabel="戻る" confirmLabel="招待を送る" confirmIcon={<Send size={15} />} footerLead="手順 2 / 2" steps={<DialogSteps steps={[{ label: '人', done: true, onSelect: () => setResult('手順1に戻りました') }, { label: '役割と見える範囲', current: true }]} />}>
          <div className={styles.dialogFields}><label className={styles.field}><span>役割</span><select className="appearance-none" defaultValue="配信担当"><option>配信担当</option><option>管理者</option></select></label></div>
        </Dialog>
        {!dialogOpen ? <Button onClick={() => setDialogOpen(true)}>ダイアログを開く</Button> : null}
      </div></section>
      <section><h2>hNXm7 · 空の表示</h2><div data-sample="hNXm7" style={{ width: 420 }}><ListState kind="empty" icon={<Tag size={17} />} title="まだタグがありません" description="友だちを分けるときに使います" action={<Button variant="primary" onClick={() => setResult('タグを作ります')}><Plus size={15} />タグを作る</Button>} /></div></section>
      <section><h2>jr5Nl · 骨格の行</h2><div data-sample="jr5Nl" style={{ width: 600 }}><SkeletonRow /></div></section>
      <section><h2>cfVyj · LINEの見え方</h2><div data-sample="cfVyj"><LinePreview accountName="然 - NEN -">
        <LinePreviewMessage accountName="然 - NEN -" avatar="然" time="10:00">山田 花子さん、いつもありがとうございます。定期便のお客さま限定で、秋の新商品を先行でご案内します🍂</LinePreviewMessage>
        <LinePreviewCard imageUrl={imageUrl} title="秋の新商品 3種" description="定期便なら 10%オフ・10月4日発送" price="¥3,280" time="10:00" actions={[{ label: '商品を見る', onClick: () => setResult('商品を開きます') }, { label: '定期便に追加', secondary: true, onClick: () => setResult('定期便に追加します') }]} />
      </LinePreview></div></section>
    </div>
    <output aria-live="polite">{result}</output>
  </div>
}

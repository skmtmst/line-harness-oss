import Card, { CardContent, CardHeader } from '@/components/shared/card'
import Avatar from '@/components/shared/avatar'
import Button from '@/components/shared/button'
import DialogChoiceCards from '@/components/shared/dialog-choice-cards'
import MediaThumbnail from '@/components/shared/media-thumbnail'
import { DataTable, TableHeadRow, Tr, Th, Td } from '@/components/shared/table'
import { Tabs } from '@/components/shared/tabs'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import { ListPage, ListPageCards, ListPageSection } from '@/components/templates/list-page'
import { CreatePage } from '@/components/templates/create-page'
import { CreateSummaryCard } from '@/components/templates/create-parts'
import { Steps } from '@/components/templates/steps'
import { Plus } from 'lucide-react'

const steps = <Steps label="作成の進み" steps={[{ key: 'basic', label: '基本', state: 'current' }, { key: 'content', label: '内容', state: 'todo' }]} currentKey="basic" />
const tabs = <Tabs label="詳細の切り替え" items={[{ label: '概要', current: true, onClick() {} }, { label: '配信予定', onClick() {} }]} />
const table = <DataTable><thead><Tr><Th>名前</Th><Th>状態</Th></Tr></thead><tbody><Tr><Td>テスト</Td><Td>公開中</Td></Tr></tbody></DataTable>

/** 実画面が使う型と同じ口で、段の間を独立して測る。API・画面全体の目視判定は含まない。 */
export default function SurfaceLayoutFixture() {
  return <>
    <section id="hq"><ListPage standalone heightMode="content" title="統括アカウント" toolbarSpacing="stats" toolbar={<div data-measure="tools">数の帯と道具</div>}>
      <ListPageCards><Card frame="flat" padding="compact" layout="vertical" gap="tight" actions={<Button>開く</Button>}><h3>アカウント</h3><p>@account</p></Card></ListPageCards>
    </ListPage></section>
    <section id="contents"><ListPage standalone heightMode="content" title="登録メディア" toolbar={<Button>取り込む</Button>}><ListPageCards>
      <Card frame="flat" padding="rows" layout="media"><CardContent><CardHeader size="content" title="登録画像" meta="画像の補足" /></CardContent></Card>
    </ListPageCards></ListPage></section>
    <section id="banners"><ListPage standalone heightMode="content" title="バナー" toolbar={<Button>作る</Button>}><ListPageCards>
      <Card frame="flat" padding="rows" layout="media"><CardContent><CardHeader size="content" title="プロジェクト" /></CardContent></Card>
    </ListPageCards></ListPage></section>
    <section id="common-vars"><ListPage standalone heightMode="content" title="共通情報" folders={<><Button>作る</Button><div data-measure="folder-label">フォルダ</div></>} toolbar={<Button>絞り込む</Button>}>{table}</ListPage></section>
    <section id="reminder-detail"><PageFrame kind="detail" standalone heightMode="content"><PageHeading title="リマインダの詳細" subtitle="登録状況" tabs={tabs} />{table}</PageFrame></section>
    {[
      { id: 'auto-reply', title: '自動応答を作る' },
      { id: 'reminder', title: 'リマインダを作る' },
      { id: 'hq-broadcast', title: '一括配信を作る', headingSize: 'compact' as const },
      { id: 'scenario', title: 'シナリオを作る', stepsSpacing: 'compact' as const },
      { id: 'rich-menu', title: 'リッチメニューを作る' },
    ].map(({ id, ...heading }) => <section id={id} key={id}><CreatePage standalone dirty={false} footerActions={null} {...heading} steps={steps}><Card frame="flat" padding="compact">入力欄</Card></CreatePage></section>)}
    <section id="section-with-tools"><ListPage standalone heightMode="content" contentInset title="道具付きの段" toolbar={<Button>絞り込む</Button>}><ListPageSection><p>本文</p></ListPageSection></ListPage></section>
    <section id="section-without-tools"><ListPage standalone heightMode="content" title="本文の段"><ListPageSection><p>本文</p></ListPageSection></ListPage></section>
    <section id="surfaces">
      <Card id="raised" padding="compact">従来のカード</Card>
      <Card id="flat" frame="flat" padding="compact">平らなカード</Card>
      <Card id="selected-flat" frame="flat" selected padding="compact">選択中</Card>
      <Card id="flat-form" frame="flat" variant="form">入力の面</Card>
      <Card id="flat-bordered" frame="flat" surface="bordered" padding="compact">線の面</Card>
      <Card id="flat-outlined" frame="flat" appearance="outlined" padding="compact">外枠の面</Card>
      <Card id="flat-inset" frame="flat" surface="inset" padding="compact">内側の面</Card>
      {[
        { density: 'reviews' as const }, { density: 'records' as const },
        { presentation: 'inventory' as const }, { presentation: 'ledger' as const },
        { presentation: 'account-list' as const }, { presentation: 'account-handover' as const },
        { grid: { columns: '1fr 1fr', padding: '8px', headPadding: '8px' } },
      ].map((props, i) => <DataTable key={i} {...props}><thead><Tr><Th>項目</Th><Th>値</Th></Tr></thead><tbody><Tr><Td>内容</Td><Td>有効</Td></Tr></tbody></DataTable>)}
      <DataTable presentation="calendar"><thead><Tr><Th>時刻</Th><Th>卓</Th></Tr></thead><tbody><Tr><th scope="row">10:00</th><Td>—</Td></Tr></tbody></DataTable>
      <DataTable><thead><TableHeadRow presentation="embedded"><Th>埋め込み見出し</Th></TableHeadRow></thead><tbody><Tr><Td>本文</Td></Tr></tbody></DataTable>
      <CreateSummaryCard variant="link" rows={[{ label: 'URL', value: 'https://example.com' }]} description="補足です" />
      <CreateSummaryCard variant="record" rows={[{ label: '実行した内容', value: '送信しました' }]} />
      <Avatar name="田中" /><Avatar />
      <div style={{ width: 80, height: 60 }}><MediaThumbnail kind="video" src="" alt="動画" /></div>
      <DialogChoiceCards onChoose={() => {}} choices={[{ key: 'one', title: '種類を選ぶ', icon: <Plus />, description: '説明', notes: ['補足'], href: '/new' }]} />
      <Button variant="primary">保存する</Button>
    </section>
  </>
}

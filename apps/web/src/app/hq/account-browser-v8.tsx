'use client'

import { useMemo, useState } from 'react'
import type { AccountWithStats } from '@/contexts/account-context'
import { accountIconUrl } from '@/components/hq/account-list'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import ListState from '@/components/shared/list-state'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import { DataTable, TableHeadRow, Th, Td, Tr } from '@/components/shared/table'
import { formatNumber } from '@/lib/format'
import './readonly-v8.css'

type Filter = 'all' | 'ok' | 'warn' | 'inactive'
const categories: { value: Filter; label: string }[] = [{value:'all',label:'すべて'},{value:'ok',label:'正常'},{value:'warn',label:'要確認'},{value:'inactive',label:'停止中'}]
function matches(account: AccountWithStats, filter: Filter) {
  return filter === 'all' || (filter === 'inactive' ? !account.isActive : account.isActive && account.connection?.status === filter)
}
function status(account: AccountWithStats) {
  return !account.isActive ? <Chip tone="neutral">停止中</Chip> : account.connection?.status === 'ok' ? <Chip tone="ok">正常</Chip> : account.connection?.status === 'warn' ? <Chip tone="warn">要確認</Chip> : <Chip tone="neutral">未確認</Chip>
}
function AccountName({ account }: { account: AccountWithStats }) {
  const name = account.displayName || account.name
  const src = accountIconUrl(account)
  return <div className="v8-ro-hq-accountName">{src ? <img src={src} alt="" className="v8-ro-hq-logo" /> : <span className="v8-ro-hq-logo" aria-hidden="true">{name.slice(0,1)}</span>}<div><p title={name}>{name}</p><small title={account.basicId || account.channelId}>{account.basicId || account.channelId}</small></div></div>
}
export default function AccountBrowser({ accounts, onSelect, onSettings }: { accounts: AccountWithStats[]; onSelect: (id: string) => void; onSettings: (account: AccountWithStats) => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [view, setView] = useState<'cards'|'table'>('cards')
  const [sort, setSort] = useState('display')
  const [size, setSize] = useState(10)
  const [page, setPage] = useState(1)
  const filtered = useMemo(() => accounts.filter(account => matches(account,filter) && [account.name,account.displayName,account.basicId,account.channelId].some(text => text?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))).sort((a,b) => sort === 'name' ? (a.displayName || a.name).localeCompare(b.displayName || b.name,'ja') : sort === 'friends' ? (b.stats?.friendCount ?? 0)-(a.stats?.friendCount ?? 0) : a.displayOrder-b.displayOrder),[accounts,filter,query,sort])
  const current = Math.min(page,Math.max(1,Math.ceil(filtered.length/size)))
  const shown = filtered.slice((current-1)*size,current*size)
  const actions = (account: AccountWithStats) => <div className="v8-ro-hq-actions"><Button size="field" onClick={() => onSelect(account.id)}>このアカウントへ入る</Button><Button size="field" disabled={!['owner','admin'].includes(account.role ?? '')} title={['owner','admin'].includes(account.role ?? '') ? undefined : '設定の変更はオーナー・管理者が行えます'} onClick={() => onSettings(account)}>設定</Button></div>
  return <section className="v8-ro-hq-browser" aria-label="統括のアカウント一覧">
    <aside className="v8-ro-hq-categories" aria-label="接続状態で絞り込み"><Button href="/accounts/new" variant="primary">アカウントを登録</Button>{categories.map(item => <button type="button" key={item.value} aria-pressed={filter === item.value} onClick={() => {setFilter(item.value);setPage(1)}}>{item.label}　{accounts.filter(account => matches(account,item.value)).length}</button>)}</aside>
    <div className="v8-ro-hq-content">
      <div className="v8-ro-hq-controls"><SearchField aria-label="アカウントを検索" placeholder="アカウント名・LINE IDで検索" value={query} onChange={value => {setQuery(value);setPage(1)}} onClear={() => {setQuery('');setPage(1)}} /><Select aria-label="アカウントの並び順" value={sort} onChange={value => {setSort(value);setPage(1)}} options={[{value:'display',label:'登録の並び順'},{value:'name',label:'名前順'},{value:'friends',label:'友だちが多い順'}]} /><Button aria-pressed={view === 'cards'} onClick={() => setView('cards')}>カード</Button><Button aria-pressed={view === 'table'} onClick={() => setView('table')}>表</Button></div>
      {shown.length === 0 ? <ListState kind="empty" title="該当するアカウントがありません" description="検索の言葉や接続状態を変えてください。" /> : view === 'cards' ? <div className="v8-ro-hq-cards">{shown.map(account => <article className="v8-ro-hq-card" key={account.id}><AccountName account={account} /><div>{status(account)}</div><dl><div><dt>友だち</dt><dd>{formatNumber(account.stats?.friendCount ?? 0)}</dd></div><div><dt>今月の配信</dt><dd>{formatNumber(account.stats?.messagesThisMonth ?? 0)}</dd></div><div><dt>担当者</dt><dd>{formatNumber(account.stats?.staffCount ?? 0)}</dd></div></dl>{actions(account)}</article>)}</div> : <DataTable><thead><TableHeadRow><Th style={{width:'32%'}}>アカウント</Th><Th>状態</Th><Th align="right">友だち</Th><Th align="right">今月の配信</Th><Th style={{width:'32%'}}>操作</Th></TableHeadRow></thead><tbody>{shown.map(account => <Tr key={account.id}><Td><AccountName account={account} /></Td><Td>{status(account)}</Td><Td align="right">{formatNumber(account.stats?.friendCount ?? 0)}</Td><Td align="right">{formatNumber(account.stats?.messagesThisMonth ?? 0)}</Td><Td>{actions(account)}</Td></Tr>)}</tbody></DataTable>}
      <div className="v8-ro-hq-footer"><ListRange total={filtered.length} first={filtered.length ? (current-1)*size+1 : 0} last={(current-1)*size+shown.length} /><Select aria-label="アカウントの表示件数" value={String(size)} size="page-size" onChange={value => {setSize(Number(value));setPage(1)}} options={[10,20,50].map(value => ({value:String(value),label:`${value}件`}))} /></div><Pagination page={current} pageCount={Math.max(1,Math.ceil(filtered.length/size))} onPageChange={setPage} ariaLabel="アカウントのページ送り" />
    </div>
  </section>
}

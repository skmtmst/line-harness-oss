'use client'
import { useCallback,useEffect,useRef,useState } from 'react'
import { addDays } from '@line-crm/shared'
import Drawer from '@/components/shared/drawer'
import Button from '@/components/shared/button'
import StatusBadge from '@/components/shared/status-badge'
import { ListPageSection,ListPageStats } from '@/components/templates/list-page'
import { DashboardColumns } from '@/components/templates/dashboard-page'
import Card,{CardHeader} from '@/components/shared/card'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import { ListToolbarRow } from '@/components/shared/list-toolbar'
import { DataTable,TableHeadRow,Td,Th,Tr } from '@/components/shared/table'
import { ValueBarChart } from '@/components/shared/charts'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import SegmentedControl from '@/components/shared/segmented'
import { gap3InboxApi,type InboxResponseAnalysis } from '@/lib/api/helpers/gap3'

function todayJst() {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
 const get=(key:string)=>parts.find(part=>part.type===key)?.value ?? ''
 return `${get('year')}-${get('month')}-${get('day')}`
}
export default function InboxResponse({accountId}:{accountId:string}) {
 const [days,setDays]=useState<'7'|'28'|'91'>('28')
 const [data,setData]=useState<InboxResponseAnalysis|null>(null)
 const [error,setError]=useState<unknown>(null)
 const [loading,setLoading]=useState(true)
 const requestId=useRef(0)
 const listRequestId=useRef(0)
 const [period,setPeriod]=useState({from:'',to:''})
 const [pick,setPick]=useState<(InboxResponseAnalysis['byStaff'][number]&{kind?:'manual'|'automatic'})|null>(null)
 const [conversations,setConversations]=useState<Array<{sampleId:string;respondedAt:string;chatId:string;friendId:string;friendName:string|null}>>([])
 const [hasMore,setHasMore]=useState(false)
 const [listError,setListError]=useState<unknown>(null)
 const [listLoading,setListLoading]=useState(false)
 const load=useCallback(async()=>{
  const request=++requestId.current
  listRequestId.current++
  setLoading(true);setError(null);setPick(null)
  try {
   const today=todayJst(),weekday=new Date(`${today}T00:00:00Z`).getUTCDay()
   const to=addDays(today,(7-weekday)%7)
   const from=addDays(to,1-Number(days))
   const result=await gap3InboxApi.responseAnalysis(accountId,from,to)
   if(request===requestId.current){setPeriod({from,to});setData(result.data)}
  } catch(caught) {if(request===requestId.current)setError(caught)} finally {if(request===requestId.current)setLoading(false)}
 },[accountId,days])
 useEffect(()=>{void load();return ()=>{requestId.current++}},[load])
 const showConversations=async(row:InboxResponseAnalysis['byStaff'][number]&{kind?:'manual'|'automatic'},offset=0)=>{
  const request=++listRequestId.current
  if(offset===0){setPick(row);setConversations([])}
  setListLoading(true);setListError(null)
  try {const result=await gap3InboxApi.responseConversations(accountId,period.from,period.to,row.staffId,row.staffDeleted,offset,row.kind??'manual');if(request===listRequestId.current){setConversations(old=>offset?[...old,...result.data.items]:result.data.items);setHasMore(result.data.hasMore)}}
  catch(caught){if(request===listRequestId.current)setListError(caught)}finally{if(request===listRequestId.current)setListLoading(false)}
 }
 return <ListPageSection>
  <Notice tone="info">記録を始めた後の返信だけを週単位で集計します。それ以前の返信は含みません。最初の返事までの時間は、削除された会話を除いて計算します。</Notice>
  <ListToolbarRow><SegmentedControl aria-label="集計期間" value={days} onChange={setDays} options={[{value:'7',label:'今週'},{value:'28',label:'過去4週'},{value:'91',label:'過去13週'}]} /></ListToolbarRow>
  {loading ? <ListState kind="loading" title="返事の速さを読み込んでいます" /> : error ? <ListState kind="error" error={error} onRetry={()=>void load()} /> : data ? <>
   <ListPageStats><KpiBand>
    <KpiCard presentation="band" title="最初の返事（真ん中の値）" value={data.summary.medianFirstResponseMinutes} unit="分" detail="削除済みの会話を除く" />
    <KpiCard presentation="band" title="期限内に返した割合" value={data.summary.withinSlaRate} unit="%" detail="期限なしを除く" />
    <KpiCard presentation="band" title="期限超過" value={data.summary.overdueCount} unit="件" detail="この期間" />
    <KpiCard presentation="band" title="返事の数" value={data.summary.totalCount} unit="件" detail="最初と自動の返事" />
   </KpiBand></ListPageStats>
   <DashboardColumns layout="cards">
    <Card variant="form" padding="roomy" layout="vertical" gap="normal"><CardHeader title="担当ごと" />
   {data.byStaff.length===0 && !(data.automatic?.count) ? <ListState kind="empty" title="この期間の会話はありません" /> : <DataTable columnWeights={[1,1.25,0.8,1.9]}>
    <thead><TableHeadRow><Th grow>担当</Th><Th align="right">最初の返事まで</Th><Th align="right">期限内</Th><Th align="right">件数</Th></TableHeadRow></thead>
    <tbody>{data.byStaff.map(row=><Tr key={row.staffId ?? (row.staffDeleted?'deleted':'unassigned')}><Td grow>{row.staffName}</Td><Td align="right">{row.medianFirstResponseMinutes === null ? '—' : `${row.medianFirstResponseMinutes} 分`}</Td><Td align="right">{row.withinSlaRate === null ? '—' : `${row.withinSlaRate}%`}</Td><Td align="right"><Button variant="text" onClick={()=>void showConversations(row)}>{row.count} 件</Button>{row.deletedCount>0 ? <StatusBadge size="annotation" dot={false}>一部は削除済み</StatusBadge> : null}</Td></Tr>)}
     {data.automatic ? <Tr><Td grow title="自動の返事">自動</Td><Td align="right">—</Td><Td align="right">—</Td><Td align="right"><Button variant="text" onClick={()=>void showConversations({staffId:null,staffDeleted:false,staffName:'自動の返事',count:data.automatic!.count,deletedCount:data.automatic!.deletedCount,medianFirstResponseMinutes:null,withinSlaRate:null,kind:'automatic'})}>{data.automatic.count} 件</Button>{data.automatic.deletedCount>0 ? <StatusBadge size="annotation" dot={false}>一部は削除済み</StatusBadge> : null}{data.automatic.unavailableCount>0 ? <StatusBadge size="annotation" dot={false}>一部は会話を表示できません</StatusBadge> : null}</Td></Tr> : null}</tbody>
   </DataTable>}
    </Card>
    <Card variant="form" padding="roomy" layout="vertical" gap="normal"><CardHeader title="週ごとの推移" />
     {data.weekly.length ? <ValueBarChart label="週ごとの最初の返事" unit="件" items={data.weekly.map(item=>({key:item.week,label:item.week,value:item.count}))} /> : <ListState kind="empty" title="この期間の会話はありません" />}
    </Card>
   </DashboardColumns>
  </> : null}
  <Drawer open={pick!==null} title={pick?`${pick.staffName}の会話`:''} description={`${period.from}〜${period.to}`} onClose={()=>{listRequestId.current++;setPick(null)}}>
   {pick?.deletedCount ? <Notice tone="info">一部は削除済みです。</Notice> : null}
   <Notice tone="info">別の店へ移動した会話は表示されません。</Notice>
   {listError ? <ListState kind="error" error={listError} onRetry={()=>pick&&void showConversations(pick)} /> : null}
   {listLoading && conversations.length===0 ? <ListState kind="loading" title="会話を読み込んでいます" /> : null}
   {!listLoading && !listError && conversations.length===0 ? <ListState kind="empty" title="表示できる会話はありません" /> : null}
   {conversations.length ? <DataTable><thead><TableHeadRow><Th grow>会話</Th><Th>返信時刻</Th><Th>操作</Th></TableHeadRow></thead><tbody>{conversations.map(item=><Tr key={item.sampleId}><Td grow>{item.friendName || '名前なし'}</Td><Td>{new Date(item.respondedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}</Td><Td><Button variant="text" href={`/chats?friend=${encodeURIComponent(item.friendId)}`}>会話を開く</Button></Td></Tr>)}</tbody></DataTable> : null}
   {hasMore && pick ? <Button onClick={()=>void showConversations(pick,conversations.length)} disabled={listLoading}>続きを読み込む</Button> : null}
  </Drawer>
 </ListPageSection>
}

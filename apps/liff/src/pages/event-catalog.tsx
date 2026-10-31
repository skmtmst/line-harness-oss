import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatJstEventAt } from '../lib/datetime.js';
import LiffHeader from '../components/ui/liff-header.js';
import Card from '../components/ui/card.js';
import Button from '../components/ui/button/index.js';
import LoadErrorView from '../components/load-error-view.js';
import LoadingView from '../components/loading-view.js';
import StatusView from '../components/ui/status-view.js';

type Catalog=Awaited<ReturnType<typeof api.listEvents>>;
export default function EventCatalog() {
 const [data,setData]=useState<Catalog|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false),[tick,setTick]=useState(0);
 const navigate=useNavigate(),{search}=useLocation();
 useEffect(()=>{let active=true;setError(false);setData(null);void api.listEvents().then(data=>{if(active)setData(data)}).catch(()=>{if(active)setError(true)});return ()=>{active=false}},[tick]);
 const more=async()=>{if(!data?.nextCursor||busy)return;setBusy(true);setError(false);try{const next=await api.listEvents(data.nextCursor);setData(current=>current?{items:[...current.items,...next.items],nextCursor:next.nextCursor}:next)}catch{setError(true)}finally{setBusy(false)}};
 return <div className="min-h-screen bg-canvas"><LiffHeader title="クラス・スケジュール"/><main className="mx-auto flex max-w-md flex-col gap-4 p-4">
  {error?<LoadErrorView onRetry={()=>setTick(n=>n+1)}/>:null}
  {!data&&!error?<LoadingView/>:null}
  {data?.items.length===0?<StatusView icon="calendar" title="これからのクラスはありません" body="スケジュールが公開されるまでお待ちください。"/>:null}
  {data?.items.map(event=><Card key={event.id}><h2 className="text-base font-semibold">{event.name}</h2><p className="text-sm text-liff-sub">{formatJstEventAt(event.nextStartsAt)}</p>{event.venue_name?<p className="text-sm">{event.venue_name}</p>:null}<Button variant="primary" onClick={()=>navigate({pathname:`/events/${encodeURIComponent(event.id)}`,search})}>日時を選ぶ</Button></Card>)}
  {data?.nextCursor?<Button variant="secondary" onClick={()=>void more()} disabled={busy}>続きを見る</Button>:null}
 </main></div>
}

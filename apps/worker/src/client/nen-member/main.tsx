import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import './styles.css';

type Ctx = { liffId: string; lineUserId: string; idToken: string };
type Pet = { id: string; name: string; animalType: string; breed: string; birthday: string; weightKg: number; concerns: string[]; recommendedDailyMinGrams: number; recommendedDailyMaxGrams: number; venisonDailyGrams: number; foodCycleDays: number; imageUrl?: string | null };
type OrderItem = { name?: string; quantity?: number; product_id?: string | number | null; product_url?: string | null; productUrl?: string | null };
type CommerceOrder = { id?: string; number?: string; date?: string; orderDate?: string; total?: number; detailUrl?: string | null; items?: OrderItem[] };
type MemberPhoto = { id: string; imageUrl: string; caption: string; status: string; awardedPoints: number; petName?: string };
type SiteGalleryPhoto = { imageUrl: string; alt: string };
type MemberData = { owner: { displayName: string | null }; pets: Pet[]; commerce: { orders: CommerceOrder[]; subscription: any; purchaseCount: number; purchaseAmount: number; points: number; rank: string }; photos: MemberPhoto[]; photoStats: { submittedCount: number; pendingCount: number; adoptedCount: number; earnedPoints: number } };
type HealthLog = { id: string; pet_id: string; logged_on: string; weight_kg: number | null; heart_rate_bpm: number | null; respiratory_rate_bpm: number | null; stool_status: string; appetite: string; skin_status: string; tear_stain_status: string; note: string };
type HealthMetric = 'weight_kg' | 'heart_rate_bpm' | 'respiratory_rate_bpm';
type HealthPeriod = 'day' | 'week' | 'month';
type Tab = 'home' | 'pets' | 'health' | 'orders' | 'photos' | 'advice';
let root: Root | null = null;

const ranks = [
  { name: '会員', min: 0 },
  { name: 'シルバー会員', min: 20_000 },
  { name: 'ゴールド会員', min: 50_000 },
  { name: 'プラチナ会員', min: 100_000 },
] as const;
const tabItems: Array<{ value: Tab; label: string }> = [
  { value: 'home', label: 'ホーム' },
  { value: 'pets', label: 'ペット' },
  { value: 'health', label: '健康' },
  { value: 'orders', label: '注文' },
  { value: 'photos', label: '投稿' },
];

async function call<T>(ctx: Ctx, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { Authorization: `Bearer ${ctx.idToken}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error(data.error || '通信に失敗しました');
  return data;
}
const concernLabels: Record<string, string> = { tear_stain: '涙やけ', coat: '毛並み', allergy: 'アレルギー', appetite: '食いつき', stool: '便', weight: '体重', other: 'その他' };

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="nm-field"><span>{label}</span>{children}</label>; }
function Notice({ children }: { children: React.ReactNode }) { return <div className="nm-notice">{children}</div>; }
function displayDate(value?: string) { if (!value) return ''; const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}+09:00`); return Number.isFinite(date.getTime()) ? date.toLocaleDateString('ja-JP') : value.slice(0, 10); }

function TabIcon({ tab }: { tab: Tab }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
    {tab === 'home' && <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>}
    {tab === 'pets' && <><circle cx="8" cy="7" r="2"/><circle cx="16" cy="7" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M12 11c-3 0-6 3-6 6 0 2 1.5 3 3.3 2.3 1.8-.7 3.6-.7 5.4 0C16.5 20 18 19 18 17c0-3-3-6-6-6Z"/></>}
    {tab === 'health' && <><path d="M20.8 5.7c-2-2-5.2-2-7.2 0L12 7.3l-1.6-1.6a5.1 5.1 0 0 0-7.2 7.2L12 21l8.8-8.1a5.1 5.1 0 0 0 0-7.2Z"/><path d="M7 13h3l1-3 2 6 1-3h3"/></>}
    {tab === 'orders' && <><path d="M4 5h2l2 10h9l2-7H7"/><circle cx="10" cy="19" r="1.2"/><circle cx="17" cy="19" r="1.2"/></>}
    {tab === 'photos' && <><rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m5 18 5-5 3 3 2-2 4 4"/></>}
    {tab === 'advice' && <><path d="M21 12a8 8 0 0 1-9 8 9 9 0 0 1-4-.9L3 21l1.7-4A8 8 0 1 1 21 12Z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/></>}
  </svg>;
}

function useAnimatedNumber(target: number, duration = 1100) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

function rankFor(amount: number) {
  let index = 0;
  ranks.forEach((rank, i) => { if (amount >= rank.min) index = i; });
  return { index, current: ranks[index], next: ranks[index + 1] || null };
}

type OptimizedPhoto = { data: string; mimeType: 'image/jpeg'; size: number; name: string };

async function optimizePhoto(file: File): Promise<OptimizedPhoto> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('この写真を読み込めません。iPhoneの写真設定をご確認ください。'));
      element.src = objectUrl;
    });
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    let width = Math.max(1, Math.round(image.naturalWidth * scale));
    let height = Math.max(1, Math.round(image.naturalHeight * scale));
    let quality = .84;
    let blob: Blob | null = null;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('写真を変換できませんでした');
      context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= 1_500_000) break;
      quality = Math.max(.62, quality - .08);
      width = Math.max(1, Math.round(width * .88));
      height = Math.max(1, Math.round(height * .88));
    }
    if (!blob) throw new Error('写真を変換できませんでした');
    if (blob.size > 1_500_000) throw new Error('写真を十分に軽量化できませんでした。別の写真をお試しください。');
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob!);
    });
    return { data, mimeType: 'image/jpeg', size: blob.size, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function loadPhoto(file: File): Promise<{ image: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('この写真を読み込めません。iPhoneの写真設定をご確認ください。'));
    element.src = url;
  }).catch(error => { URL.revokeObjectURL(url); throw error; });
  return { image, url };
}

async function cropPetPhoto(file: File, image: HTMLImageElement, zoom: number, offset: { x: number; y: number }): Promise<OptimizedPhoto> {
  const previewSize = 260; const outputSize = 720;
  const baseScale = Math.max(previewSize / image.naturalWidth, previewSize / image.naturalHeight);
  const outputScale = baseScale * zoom * (outputSize / previewSize);
  const canvas = document.createElement('canvas'); canvas.width = outputSize; canvas.height = outputSize;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('写真を変換できませんでした');
  context.fillStyle = '#fff'; context.fillRect(0, 0, outputSize, outputSize);
  const width = image.naturalWidth * outputScale; const height = image.naturalHeight * outputScale;
  context.drawImage(image, (outputSize - width) / 2 + offset.x * outputSize / previewSize, (outputSize - height) / 2 + offset.y * outputSize / previewSize, width, height);
  let quality = .86; let blob: Blob | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= 650_000) break;
    quality -= .08;
  }
  if (!blob) throw new Error('写真を変換できませんでした');
  const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob!); });
  return { data, mimeType: 'image/jpeg', size: blob.size, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
}

function PetPhotoCropper({ file, onDone, onCancel }: { file: File; onDone: (photo: OptimizedPhoto) => void; onCancel: () => void }) {
  const [source, setSource] = useState<{ image: HTMLImageElement; url: string } | null>(null); const [zoom, setZoom] = useState(1); const [offset, setOffset] = useState({ x: 0, y: 0 }); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null); const previewSize = 260;
  useEffect(() => { let active = true; let loaded: { image: HTMLImageElement; url: string } | null = null; void loadPhoto(file).then(value => { loaded = value; if (active) setSource(value); else URL.revokeObjectURL(value.url); }).catch(e => setError(e instanceof Error ? e.message : '写真を読み込めませんでした')); return () => { active = false; if (loaded) URL.revokeObjectURL(loaded.url); }; }, [file]);
  const dimensions = source ? (() => { const base = Math.max(previewSize / source.image.naturalWidth, previewSize / source.image.naturalHeight); return { width: source.image.naturalWidth * base * zoom, height: source.image.naturalHeight * base * zoom }; })() : { width: previewSize, height: previewSize };
  const clamp = (next: { x: number; y: number }, dims = dimensions) => ({ x: Math.max(-(dims.width - previewSize) / 2, Math.min((dims.width - previewSize) / 2, next.x)), y: Math.max(-(dims.height - previewSize) / 2, Math.min((dims.height - previewSize) / 2, next.y)) });
  const changeZoom = (value: number) => { if (!source) return; const base = Math.max(previewSize / source.image.naturalWidth, previewSize / source.image.naturalHeight); const dims = { width: source.image.naturalWidth * base * value, height: source.image.naturalHeight * base * value }; setZoom(value); setOffset(current => clamp(current, dims)); };
  const save = async () => { if (!source) return; setBusy(true); setError(''); try { onDone(await cropPetPhoto(file, source.image, zoom, offset)); } catch (e) { setError(e instanceof Error ? e.message : '写真を保存できませんでした'); setBusy(false); } };
  return <div className="nm-crop-modal" role="dialog" aria-modal="true" aria-label="ペット写真の位置調整"><div className="nm-crop-sheet"><div className="nm-crop-heading"><div><span>PET ICON</span><h2>写真の位置を調整</h2></div><button onClick={onCancel} aria-label="閉じる">×</button></div><p>丸の中をドラッグし、スライダーで拡大・縮小できます。</p><div className="nm-crop-stage" onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (drag.current) setOffset(clamp({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y })); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>{source && <img src={source.url} alt="切り抜き位置の確認" draggable={false} style={{ width: dimensions.width, height: dimensions.height, transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }} />}<div className="nm-crop-mask" /></div><label className="nm-crop-zoom"><span>縮小</span><input type="range" min="1" max="3" step="0.01" value={zoom} onChange={e => changeZoom(Number(e.target.value))} /><span>拡大</span></label>{error && <p className="nm-error">{error}</p>}<div className="nm-crop-actions"><button onClick={onCancel}>キャンセル</button><button className="nm-primary" disabled={!source || busy} onClick={() => void save()}>{busy ? '最適化中…' : 'この位置で設定'}</button></div></div></div>;
}

function PetForm({ ctx, onDone, onCancel }: { ctx: Ctx; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ name: '', animalType: 'dog', breed: '', gender: 'unknown', birthday: '', weightKg: '', concerns: [] as string[] });
  const [photo, setPhoto] = useState<OptimizedPhoto | null>(null); const [cropFile, setCropFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async () => { setBusy(true); setError(''); try { await call(ctx, '/api/liff/nen/pets', { method: 'POST', body: JSON.stringify({ ...form, weightKg: Number(form.weightKg), photoData: photo?.data }) }); setForm({ name: '', animalType: 'dog', breed: '', gender: 'unknown', birthday: '', weightKg: '', concerns: [] }); onDone(); } catch (e) { setError(e instanceof Error ? e.message : '登録できませんでした'); } finally { setBusy(false); } };
  return <section className="nm-card nm-pet-form"><button className="nm-back" type="button" onClick={onCancel}>← マイペットへ戻る</button><div className="nm-section-heading"><span>NEW PET</span><h2>マイペットを登録</h2></div><p className="nm-sub">多頭飼いの場合は、1頭ずつ追加できます。</p>
    <label className="nm-pet-photo-picker"><input type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) setCropFile(file); e.target.value = ''; }} />{photo ? <img src={photo.data} alt="ペット写真の確認" /> : <span>＋</span>}<b>{photo ? '写真を変更' : 'ペットの写真を登録'}</b><small>任意・位置と大きさを調整できます</small></label>
    <div className="nm-grid"><Field label="ペット名"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field><fieldset className="nm-species-field"><legend>種別</legend><div className="nm-species">{([['dog','わんちゃん'],['cat','ねこちゃん']] as const).map(([value,label]) => <label className={form.animalType === value ? 'active' : ''} key={value}><input type="radio" name="animalType" value={value} checked={form.animalType === value} onChange={() => setForm({ ...form, animalType: value })}/><span>{label}</span></label>)}</div></fieldset><Field label="犬種・猫種"><input value={form.breed} onChange={e => setForm({ ...form, breed: e.target.value })} /></Field><Field label="誕生日"><input type="date" value={form.birthday} onChange={e => setForm({ ...form, birthday: e.target.value })} /></Field><Field label="体重（kg）"><input type="number" min="0.2" step="0.1" value={form.weightKg} onChange={e => setForm({ ...form, weightKg: e.target.value })} /></Field></div>
    <fieldset><legend>現在のお悩み（複数選択可）</legend><div className="nm-chips">{Object.entries(concernLabels).map(([key, label]) => <label key={key} className={form.concerns.includes(key) ? 'active' : ''}><input type="checkbox" checked={form.concerns.includes(key)} onChange={() => setForm({ ...form, concerns: form.concerns.includes(key) ? form.concerns.filter(v => v !== key) : [...form.concerns, key] })} />{label}</label>)}</div></fieldset>
    {error && <p className="nm-error">{error}</p>}<button className="nm-primary" disabled={busy} onClick={() => void submit()}>{busy ? '登録中…' : '登録する'}</button>{cropFile && <PetPhotoCropper file={cropFile} onCancel={() => setCropFile(null)} onDone={value => { setPhoto(value); setCropFile(null); }} />}</section>;
}

function PetProfileCard({ pet, ctx, onChanged }: { pet: Pet; ctx: Ctx; onChanged: () => void }) {
  const [busy, setBusy] = useState(false); const [cropFile, setCropFile] = useState<File | null>(null); const [error, setError] = useState('');
  const updatePhoto = async (photo: OptimizedPhoto) => { setBusy(true); setError(''); try { await call(ctx, `/api/liff/nen/pets/${pet.id}/photo`, { method: 'POST', body: JSON.stringify({ data: photo.data }) }); setCropFile(null); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : '写真を変更できませんでした'); } finally { setBusy(false); } };
  return <article className="nm-pet-profile-card"><div className="nm-pet-profile-top"><label className="nm-pet-avatar"><input type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) setCropFile(file); e.target.value = ''; }} /><span className="nm-pet-avatar-frame">{pet.imageUrl ? <img src={pet.imageUrl} alt={`${pet.name}ちゃん`} /> : <TabIcon tab="pets" />}</span><i>{busy ? '…' : '+'}</i></label><div><small>MY PET</small><h2>{pet.name}ちゃん</h2><p>{pet.animalType === 'cat' ? '猫' : '犬'}・{pet.breed}</p></div></div><div className="nm-pet-facts"><div><span>体重</span><b>{pet.weightKg}kg</b></div><div><span>誕生日</span><b>{pet.birthday}</b></div><div><span>フード目安</span><b>{pet.recommendedDailyMinGrams}〜{pet.recommendedDailyMaxGrams}g</b></div></div><p className="nm-pet-concerns">お悩み　{pet.concerns.map(v => concernLabels[v] || v).join('・') || '未登録'}</p>{error && <p className="nm-error">{error}</p>}{cropFile && <PetPhotoCropper file={cropFile} onCancel={() => setCropFile(null)} onDone={value => void updatePhoto(value)} />}</article>;
}

function PetsView({ ctx, pets, onChanged }: { ctx: Ctx; pets: Pet[]; onChanged: () => void }) {
  const [registering, setRegistering] = useState(false);
  if (registering) return <PetForm ctx={ctx} onCancel={() => setRegistering(false)} onDone={() => { setRegistering(false); onChanged(); }} />;
  return <section className="nm-stack nm-pets-page">{pets.length > 0 && <div className="nm-pet-list"><div className="nm-list-heading"><span>REGISTERED PETS</span><h2>登録しているペット</h2></div>{pets.map(pet => <PetProfileCard key={pet.id} pet={pet} ctx={ctx} onChanged={onChanged} />)}</div>}<button className="nm-add-pet" onClick={() => setRegistering(true)}><span>＋</span><div><b>マイペットを登録</b><small>{pets.length ? '新しいペットを追加する' : 'はじめに、うちの子を登録しましょう'}</small></div><i>›</i></button></section>;
}

const healthMetrics: Array<{ value: HealthMetric; label: string; short: string; unit: string; color: string }> = [
  { value: 'weight_kg', label: '体重', short: '体重', unit: 'kg', color: '#16815b' },
  { value: 'heart_rate_bpm', label: '心拍数', short: '心拍', unit: '回/分', color: '#d46272' },
  { value: 'respiratory_rate_bpm', label: '呼吸数', short: '呼吸', unit: '回/分', color: '#4f7fac' },
];

function healthSeries(logs: HealthLog[], metric: HealthMetric, period: HealthPeriod) {
  const grouped = new Map<string, { label: string; values: number[] }>();
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - (period === 'day' ? 30 : period === 'week' ? 7 * 26 : 31 * 18));
  logs.forEach(log => {
    const rawValue = log[metric];
    if (rawValue == null) return;
    const value = Number(rawValue);
    const date = new Date(`${log.logged_on}T00:00:00`);
    if (!Number.isFinite(value) || date < cutoff) return;
    let key = log.logged_on; let label = `${date.getMonth() + 1}/${date.getDate()}`;
    if (period === 'week') {
      const monday = new Date(date); const day = (monday.getDay() + 6) % 7; monday.setDate(monday.getDate() - day);
      key = monday.toISOString().slice(0, 10); label = `${monday.getMonth() + 1}/${monday.getDate()}週`;
    } else if (period === 'month') {
      key = log.logged_on.slice(0, 7); label = `${date.getFullYear().toString().slice(2)}年${date.getMonth() + 1}月`;
    }
    const current = grouped.get(key) || { label, values: [] }; current.values.push(value); grouped.set(key, current);
  });
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => ({ key, label: item.label, value: item.values.reduce((sum, value) => sum + value, 0) / item.values.length })).slice(period === 'day' ? -14 : -12);
}

function HealthLineChart({ points, metric }: { points: Array<{ key: string; label: string; value: number }>; metric: typeof healthMetrics[number] }) {
  if (!points.length) return <div className="nm-chart-empty"><span>＋</span><b>まだ記録がありません</b><p>下のフォームから記録すると、ここに推移が表示されます。</p></div>;
  const width = 340; const height = 190; const left = 38; const right = 12; const top = 20; const bottom = 34;
  const values = points.map(point => point.value); const rawMin = Math.min(...values); const rawMax = Math.max(...values); const spread = Math.max(rawMax - rawMin, metric.value === 'weight_kg' ? 1 : 10);
  const min = Math.max(0, rawMin - spread * .22); const max = rawMax + spread * .22;
  const x = (index: number) => left + (points.length === 1 ? (width - left - right) / 2 : index * (width - left - right) / (points.length - 1));
  const y = (value: number) => top + (max - value) * (height - top - bottom) / Math.max(.001, max - min);
  const line = points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ');
  const labelIndexes = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  return <div className="nm-chart-wrap"><svg className="nm-health-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric.label}の推移`}>
    {[0, .5, 1].map((step, index) => { const yy = top + step * (height - top - bottom); const value = max - step * (max - min); return <g key={index}><line x1={left} y1={yy} x2={width - right} y2={yy} className="nm-chart-grid"/><text x={left - 6} y={yy + 3} textAnchor="end" className="nm-chart-axis">{metric.value === 'weight_kg' ? value.toFixed(1) : Math.round(value)}</text></g>; })}
    {points.length > 1 && <polyline points={line} fill="none" stroke={metric.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="nm-chart-line"/>}
    {points.map((point, index) => <g key={point.key}><circle cx={x(index)} cy={y(point.value)} r="4.5" fill="#fff" stroke={metric.color} strokeWidth="3"/><text x={x(index)} y={y(point.value) - 10} textAnchor="middle" className="nm-chart-value">{metric.value === 'weight_kg' ? point.value.toFixed(1) : Math.round(point.value)}</text>{labelIndexes.has(index) && <text x={x(index)} y={height - 9} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} className="nm-chart-axis">{point.label}</text>}</g>)}
  </svg></div>;
}

function HealthForm({ ctx, pet, onSaved }: { ctx: Ctx; pet: Pet; onSaved: () => void }) {
  const [form, setForm] = useState({ petId: pet.id, loggedOn: new Date().toISOString().slice(0, 10), weightKg: '', heartRateBpm: '', respiratoryRateBpm: '', stoolStatus: 'normal', appetite: 'normal', skinStatus: 'normal', tearStainStatus: 'normal', note: '' });
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(value => ({ ...value, petId: pet.id })); setMessage(''); }, [pet.id]);
  const submit = async () => { setBusy(true); setMessage(''); try { const res = await call<{ data: { careRequired: boolean } }>(ctx, '/api/liff/nen/health-logs', { method: 'POST', body: JSON.stringify(form) }); setMessage(res.data.careRequired ? '記録しました。気になる状態が続いているため、管理画面に要ケアとして共有しました。' : '今日の健康記録を保存しました。'); onSaved(); } catch (error) { setMessage(error instanceof Error ? error.message : '記録できませんでした'); } finally { setBusy(false); } };
  return <section className="nm-card nm-health-form"><div className="nm-section-heading"><span>DAILY RECORD</span><h2>{pet.name}ちゃんの健康を記録</h2></div><div className="nm-grid"><Field label="記録日"><input type="date" value={form.loggedOn} onChange={e => setForm({ ...form, loggedOn: e.target.value })} /></Field><Field label="体重（kg）"><input inputMode="decimal" type="number" min="0.2" max="150" step="0.1" placeholder="例：8.4" value={form.weightKg} onChange={e => setForm({ ...form, weightKg: e.target.value })} /></Field><Field label="心拍数（回/分）"><input inputMode="numeric" type="number" min="20" max="300" step="1" placeholder="例：96" value={form.heartRateBpm} onChange={e => setForm({ ...form, heartRateBpm: e.target.value })} /></Field><Field label="呼吸数（回/分）"><input inputMode="numeric" type="number" min="5" max="150" step="1" placeholder="例：24" value={form.respiratoryRateBpm} onChange={e => setForm({ ...form, respiratoryRateBpm: e.target.value })} /></Field><Field label="便"><select value={form.stoolStatus} onChange={e => setForm({ ...form, stoolStatus: e.target.value })}><option value="normal">正常</option><option value="soft">やわらかい</option><option value="hard">かたい</option><option value="diarrhea">下痢</option><option value="bloody">血が混じる</option><option value="other">その他</option></select></Field><Field label="食いつき"><select value={form.appetite} onChange={e => setForm({ ...form, appetite: e.target.value })}><option value="good">良好</option><option value="normal">普通</option><option value="poor">不良</option></select></Field><Field label="皮膚"><select value={form.skinStatus} onChange={e => setForm({ ...form, skinStatus: e.target.value })}><option value="normal">問題なし</option><option value="itchy">かゆそう</option><option value="red">赤み</option><option value="other">その他</option></select></Field><Field label="涙やけ"><select value={form.tearStainStatus} onChange={e => setForm({ ...form, tearStainStatus: e.target.value })}><option value="normal">問題なし</option><option value="mild">少し気になる</option><option value="concern">気になる</option></select></Field></div><Field label="その日の様子・獣医師に伝えたいこと"><textarea rows={4} placeholder="食事、運動、投薬、気になった変化など" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></Field>{message && <Notice>{message}</Notice>}<button className="nm-primary" disabled={busy} onClick={() => void submit()}>{busy ? '保存中…' : '今日の記録を保存'}</button></section>;
}

function HealthDiary({ ctx, pets }: { ctx: Ctx; pets: Pet[] }) {
  const [petId, setPetId] = useState(pets[0]?.id || ''); const [logs, setLogs] = useState<HealthLog[]>([]); const [metricKey, setMetricKey] = useState<HealthMetric>('weight_kg'); const [period, setPeriod] = useState<HealthPeriod>('day'); const [loading, setLoading] = useState(true);
  const loadLogs = useCallback(async () => { setLoading(true); try { const response = await call<{ data: HealthLog[] }>(ctx, '/api/liff/nen/health-logs'); setLogs(response.data); } finally { setLoading(false); } }, [ctx]);
  useEffect(() => { void loadLogs(); }, [loadLogs]);
  useEffect(() => { if (!pets.some(pet => pet.id === petId)) setPetId(pets[0]?.id || ''); }, [pets, petId]);
  if (!pets.length) return <section className="nm-stack"><div className="nm-health-hero"><span>HEALTH DIARY</span><h2>なるべく早く愛犬愛猫の異変に気付くためには、<br/>ご家庭での健康管理が大切です。</h2></div><Notice>先にマイペットを登録してください。</Notice></section>;
  const pet = pets.find(item => item.id === petId) || pets[0]; const petLogs = logs.filter(log => log.pet_id === pet.id); const metric = healthMetrics.find(item => item.value === metricKey)!; const points = healthSeries(petLogs, metricKey, period);
  const latestFor = (key: HealthMetric) => petLogs.find(log => log[key] != null && Number.isFinite(Number(log[key])))?.[key];
  return <section className="nm-stack nm-health-page"><div className="nm-health-hero"><span>HEALTH DIARY</span><h2>なるべく早く愛犬愛猫の異変に気付くためには、<br/>ご家庭での健康管理が大切です。</h2><p>いつもの数値を残しておくと、小さな変化を見つけやすく、診察時にも経過を正確に伝えられます。</p></div>
    <section className="nm-card nm-health-dashboard"><div className="nm-health-toolbar"><label><span>記録を見るペット</span><select value={pet.id} onChange={e => setPetId(e.target.value)}>{pets.map(item => <option key={item.id} value={item.id}>{item.name}ちゃん</option>)}</select></label><div className="nm-health-period">{([['day','日'],['week','週'],['month','月']] as const).map(([value,label]) => <button className={period === value ? 'active' : ''} onClick={() => setPeriod(value)} key={value}>{label}</button>)}</div></div>
      <div className="nm-vital-cards">{healthMetrics.map(item => { const latest = latestFor(item.value); return <button className={metricKey === item.value ? 'active' : ''} style={{ '--vital-color': item.color } as React.CSSProperties} onClick={() => setMetricKey(item.value)} key={item.value}><span>{item.short}</span><b>{latest == null ? '—' : item.value === 'weight_kg' ? Number(latest).toFixed(1) : Math.round(Number(latest))}</b><small>{item.unit}</small></button>; })}</div>
      <div className="nm-chart-heading"><div><span>{period === 'day' ? '日別' : period === 'week' ? '週平均' : '月平均'}</span><h3>{metric.label}の推移</h3></div><i style={{ background: metric.color }}/></div>{loading ? <div className="nm-chart-empty"><b>記録を読み込んでいます…</b></div> : <HealthLineChart points={points} metric={metric}/>}<p className="nm-chart-note">診察時はこの画面を獣医師へ見せて、普段との差や変化の期間をお伝えください。</p>{petLogs.length > 0 && <div className="nm-health-recent"><h4>最近の記録</h4>{petLogs.slice(0, 5).map(log => <div key={log.id}><time>{log.logged_on.replaceAll('-', '.')}</time><span>体重 <b>{log.weight_kg == null ? '—' : `${Number(log.weight_kg).toFixed(1)}kg`}</b></span><span>心拍 <b>{log.heart_rate_bpm == null ? '—' : `${log.heart_rate_bpm}回`}</b></span><span>呼吸 <b>{log.respiratory_rate_bpm == null ? '—' : `${log.respiratory_rate_bpm}回`}</b></span>{log.note && <p>{log.note}</p>}</div>)}</div>}</section>
    <section className="nm-card nm-measure-guide"><div className="nm-section-heading"><span>HOW TO MEASURE</span><h2>おうちでの測り方</h2></div><div className="nm-measure-item"><i>01</i><div><h3>体重</h3><p>ペットを抱いて体重計に乗り、表示された重さから飼い主さま自身の体重を差し引きます。毎回できるだけ同じ時間・同じ条件で測ると変化を比べやすくなります。</p></div></div><div className="nm-measure-item"><i>02</i><div><h3>心拍数</h3><p>落ち着いている時に胸のあたりへそっと手を当て、15秒間の拍動数を数えて4倍します。家庭での参考目安は大型犬60〜80回、小型犬80〜120回、猫130〜160回/分ですが、年齢・体格・緊張などで変わります。</p></div></div><div className="nm-measure-item"><i>03</i><div><h3>呼吸数</h3><p>眠っている時や安静時に胸・お腹の上下を見て、「吸って吐く」を1回として15秒間数え、4倍します。20〜30回/分をひとつの参考にし、パンティング中や猫が喉を鳴らしている時は避けましょう。</p></div></div><div className="nm-health-caution">数値だけで病気を判断するものではありません。普段と違う状態が続く、呼吸が苦しそう、ぐったりしているなどの症状がある場合は、記録を待たず獣医師へご相談ください。</div></section>
    <HealthForm ctx={ctx} pet={pet} onSaved={() => void loadLogs()}/>
  </section>;
}

function PhotoForm({ ctx, pets, onDone }: { ctx: Ctx; pets: Pet[]; onDone: () => void }) {
  const [petId, setPetId] = useState(pets[0]?.id || ''); const [caption, setCaption] = useState(''); const [photo, setPhoto] = useState<OptimizedPhoto | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const choose = async (file?: File) => { if (!file) return; setBusy(true); setError(''); try { setPhoto(await optimizePhoto(file)); } catch (e) { setPhoto(null); setError(e instanceof Error ? e.message : '写真を読み込めませんでした'); } finally { setBusy(false); } };
  const submit = async () => { if (!photo || !petId) return; setBusy(true); setError(''); try { await call(ctx, '/api/liff/nen/photos', { method: 'POST', body: JSON.stringify({ petId, caption, mimeType: photo.mimeType, data: photo.data }) }); setPhoto(null); setCaption(''); onDone(); } catch (e) { setError(e instanceof Error ? e.message : '投稿できませんでした'); } finally { setBusy(false); } };
  if (!pets.length) return <Notice>先にマイペットを登録してください。</Notice>;
  return <section className="nm-card nm-photo-card"><div className="nm-section-heading"><span>SHARE YOUR NEN MOMENT</span><h2>うちの子の“おいしい顔”を投稿</h2></div><p className="nm-sub">然を楽しむ表情や、ご家族らしい一枚をお送りください。採用された写真は公式サイトに掲載し、お買い物に使える5ポイントをプレゼントします。</p><Field label="ペット"><select value={petId} onChange={e => setPetId(e.target.value)}>{pets.map(p => <option key={p.id} value={p.id}>{p.name}ちゃん</option>)}</select></Field><label className="nm-photo-picker"><input type="file" accept="image/*" onChange={e => void choose(e.target.files?.[0])} />{photo ? <><img src={photo.data} alt="投稿前の確認" /><span><b>{photo.name}</b><small>{Math.ceil(photo.size / 1024).toLocaleString()}KBに最適化済み</small></span></> : <><strong>＋</strong><span><b>{busy ? '写真を最適化しています…' : '写真を選ぶ'}</b><small>iPhoneの大きな写真も自動で軽量化</small></span></>}</label><Field label="写真に添えるひとこと"><textarea value={caption} maxLength={300} placeholder="例：鹿肉ミンチの日は、待ちきれないこの笑顔です。" onChange={e => setCaption(e.target.value)} /></Field>{error && <p className="nm-error">{error}</p>}<button className="nm-primary" disabled={!photo || busy} onClick={() => void submit()}>{busy ? '処理中…' : 'この写真を投稿する'}</button><p className="nm-photo-note">投稿写真は管理者が内容を確認します。採用された写真だけが公開されます。</p></section>;
}

function PhotoCampaign({ photos, sitePhotos, stats }: { photos: MemberPhoto[]; sitePhotos: SiteGalleryPhoto[]; stats: MemberData['photoStats'] }) {
  const reel = [
    ...photos.map(photo => ({ key: `adopted-${photo.id}`, imageUrl: photo.imageUrl, alt: `${photo.petName || 'ペット'}ちゃんの採用写真`, name: `${photo.petName || 'NEN FAMILY'}ちゃん`, caption: photo.caption || 'しあわせなひととき' })),
    ...sitePhotos.filter(site => !photos.some(photo => photo.imageUrl === site.imageUrl)).map((site, index) => ({ key: `site-${index}`, imageUrl: site.imageUrl, alt: site.alt || '公式サイト掲載中のご家族', name: 'NEN FAMILY', caption: '公式サイト掲載中' })),
  ];
  return <>
    <section className="nm-photo-hero"><span>NEN PHOTO PROJECT</span><h2>夢中でぱくぱく、<br/>しあわせ顔をみんなへ。</h2><p>あなたの一枚が、次に然を知るご家族のきっかけになります。</p><div><b>採用1枚につき 5pt</b><small>ショッピングですぐ使えます</small></div></section>
    <section className="nm-photo-preview" aria-label="公式サイトへの掲載イメージ"><div className="nm-photo-preview-heading"><span>CUSTOMERS &amp; NEN</span><h2>夢中でぱくぱく、しあわせ顔。</h2><p>公式サイトで実際に掲載されている写真です。横へスワイプしてご覧いただけます。</p></div><div className="nm-photo-reel">{reel.length ? reel.map(photo => <figure key={photo.key}><img src={photo.imageUrl} alt={photo.alt} /><figcaption><b>{photo.name}</b><span>{photo.caption}</span></figcaption></figure>) : [1,2,3].map(index => <div className="nm-photo-placeholder" key={index}><i>＋</i><b>次に掲載されるのは<br/>あなたの家族かも</b></div>)}</div><a href="https://stg.nen-petfood.com/#nen-voices-title" target="_blank" rel="noreferrer">実際の掲載場所を見る <span>↗</span></a></section>
    <section className="nm-photo-stats"><div><span>この企画で獲得</span><b>{stats.earnedPoints.toLocaleString()}<small>pt</small></b></div><div><span>採用された写真</span><b>{stats.adoptedCount}<small>枚</small></b></div><p>{stats.pendingCount > 0 ? `${stats.pendingCount}枚を審査しています。結果が決まり次第、掲載とポイントへ反映します。` : '心が動いた瞬間を、いつでもお待ちしています。'}</p></section>
  </>;
}

function Advice({ ctx, pets }: { ctx: Ctx; pets: Pet[] }) {
  const initialAnimal = pets[0]?.animalType === 'cat' ? 'cat' : 'dog';
  const [animalType, setAnimalType] = useState<'dog' | 'cat'>(initialAnimal);
  const [petId, setPetId] = useState(pets.find(pet => pet.animalType === initialAnimal)?.id || '');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [visibleAnswer, setVisibleAnswer] = useState('');
  const [safetyLevel, setSafetyLevel] = useState('general');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const matchingPets = pets.filter(pet => pet.animalType === animalType);
  useEffect(() => { if (!matchingPets.some(pet => pet.id === petId)) setPetId(matchingPets[0]?.id || ''); }, [animalType, petId, matchingPets]);
  useEffect(() => {
    if (!answer) { setVisibleAnswer(''); return; }
    let index = 0;
    let timer = 0;
    let cancelled = false;
    const typeNext = () => {
      if (cancelled) return;
      index = Math.min(answer.length, index + 1);
      setVisibleAnswer(answer.slice(0, index));
      if (index >= answer.length) return;
      const current = answer[index - 1] || '';
      const delay = /[。！？\n]/.test(current) ? 150 : /[、，]/.test(current) ? 75 : 24;
      timer = window.setTimeout(typeNext, delay);
    };
    timer = window.setTimeout(typeNext, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [answer]);
  const run = async () => {
    if (question.trim().length < 8) { setError('お悩みを8文字以上で詳しく教えてください。'); return; }
    setLoading(true); setError(''); setAnswer('');
    try {
      const res = await call<{ data: { advice: string; safetyLevel: string } }>(ctx, '/api/liff/nen/consultations', { method: 'POST', body: JSON.stringify({ animalType, petId: petId || undefined, question: question.trim() }) });
      setAnswer(res.data.advice); setSafetyLevel(res.data.safetyLevel);
    } catch (e) { setError(e instanceof Error ? e.message : '回答を作成できませんでした。'); }
    finally { setLoading(false); }
  };
  return <div className="nm-ai-page">
    <section className="nm-ai-hero"><span>NEN AI CARE</span><h2>小さな気がかりを、<br/>ひとりで抱えないために。</h2><p>暮らしの中で気になったことを、いつもの言葉で教えてください。</p></section>
    <section className="nm-ai-card"><div className="nm-section-heading"><span>AI CONSULTATION</span><h2>どちらのご相談ですか？</h2></div>
      <div className="nm-ai-animal" role="radiogroup" aria-label="相談するペットの種別">{([['dog','わんちゃん'],['cat','ねこちゃん']] as const).map(([value,label]) => <button role="radio" aria-checked={animalType === value} className={animalType === value ? 'active' : ''} onClick={() => setAnimalType(value)} key={value}><i>{value === 'dog' ? '犬' : '猫'}</i><b>{label}</b><span>について相談する</span></button>)}</div>
      {matchingPets.length > 0 && <Field label="登録ペット（任意）"><select value={petId} onChange={e => setPetId(e.target.value)}><option value="">選択しない</option>{matchingPets.map(pet => <option key={pet.id} value={pet.id}>{pet.name}ちゃん</option>)}</select></Field>}
      <Field label="どんなことでお悩みですか？"><textarea className="nm-ai-question" maxLength={1000} value={question} onChange={e => setQuestion(e.target.value)} placeholder={animalType === 'dog' ? '例：6か月の柴犬が、昨日からご飯をあまり食べません。元気はありますが心配です。' : '例：2歳の猫が、最近トイレ以外でおしっこをするようになりました。'} /></Field>
      <div className="nm-ai-count"><span>症状が始まった時期や普段との違いも書くと、回答しやすくなります。</span><b>{question.length}/1000</b></div>
      <button className="nm-primary nm-ai-send" disabled={loading || question.trim().length < 8} onClick={() => void run()}>{loading ? 'NENナレッジを確認中' : 'AIに相談する'}</button>
      {error && <p className="nm-error">{error}</p>}
    </section>
    {loading && <section className="nm-ai-thinking" aria-live="polite"><div className="nm-ai-orb"><i/><i/><i/></div><div><b>NEN AIが考えています</b><span>お悩みの内容を整理して、回答を作成しています</span></div></section>}
    {visibleAnswer && <section className={`nm-ai-answer ${safetyLevel}`} aria-live="polite"><div className="nm-ai-answer-head"><span>NEN AI</span><b>{safetyLevel === 'urgent' ? '早めの対応が必要です' : 'お悩みへの回答'}</b></div><p>{visibleAnswer}{visibleAnswer.length < answer.length && <i className="nm-ai-caret"/>}</p>{visibleAnswer.length === answer.length && <div className="nm-ai-disclaimer">このAI相談は診断ではありません。症状が強い、続く、普段と明らかに違う場合は、動物病院へご相談ください。</div>}</section>}
  </div>;
}

function App({ ctx }: { ctx: Ctx }) {
  const initialTab = new URLSearchParams(window.location.search).get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(['home','pets','health','orders','photos'].includes(initialTab || '') ? initialTab! : 'home'); const [data, setData] = useState<MemberData | null>(null); const [sitePhotos, setSitePhotos] = useState<SiteGalleryPhoto[]>([]); const [error, setError] = useState('');
  const load = useCallback(async () => { try { const r = await call<{ data: MemberData }>(ctx, '/api/liff/nen/member'); setData(r.data); } catch (e) { setError(e instanceof Error ? e.message : '読み込めませんでした'); } }, [ctx]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let active = true;
    fetch('/api/public/nen/gallery-preview')
      .then(response => response.ok ? response.json() : Promise.reject(new Error('gallery unavailable')))
      .then((payload: { data?: SiteGalleryPhoto[] }) => { if (active && Array.isArray(payload.data)) setSitePhotos(payload.data); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  const animatedPoints = useAnimatedNumber(data?.commerce.points || 0);
  if (!data) return <main className="nm-app"><p>{error || '読み込み中…'}</p></main>;
  const rank = rankFor(data.commerce.purchaseAmount);
  const rankProgress = Math.max(0, Math.min(100, data.commerce.purchaseAmount / 100_000 * 100));
  const tabLabel = tabItems.find(item => item.value === tab)?.label || '';
  const gaugeOffset = 314 * (1 - rankProgress / 100);
  const subscriptions = Array.isArray(data.commerce.subscription?.contracts)
    ? data.commerce.subscription.contracts
    : data.commerce.subscription ? [data.commerce.subscription] : [];
  return <main className="nm-app">
    {tab === 'home' ? <header className="nm-member-header" data-rank={rank.index}>
      <div className="nm-brand-row"><div><p>NEN MEMBERS</p><h1>{data.owner.displayName || 'お客様'}さん</h1></div><span>然 -NEN-</span></div>
      <section className="nm-membership-sheet">
        <div className="nm-rank-summary"><span className="nm-rank-pill">{rank.current.name}</span><small>MEMBERSHIP STATUS</small></div>
        <div className="nm-gauge" aria-label={`現在のポイント ${data.commerce.points.toLocaleString()}ポイント`}>
          <svg viewBox="0 0 260 150" aria-hidden="true"><path className="nm-gauge-base" d="M30 130 A100 100 0 0 1 230 130"/><path className="nm-gauge-value" d="M30 130 A100 100 0 0 1 230 130" style={{ strokeDashoffset: gaugeOffset }}/>{([{label:'0',amount:0,x:30,y:130},{label:'2',amount:20_000,x:49.1,y:71.2},{label:'5',amount:50_000,x:130,y:30},{label:'10',amount:100_000,x:230,y:130}] as const).map(tick => { const reached = data.commerce.purchaseAmount >= tick.amount; return <g className={`nm-gauge-checkpoint ${reached ? 'reached' : ''}`} key={tick.label}><circle cx={tick.x} cy={tick.y} r="10"/><text x={tick.x} y={tick.y + 3} textAnchor="middle">{reached ? '✓' : tick.label}</text></g>; })}</svg>
          <div className="nm-gauge-number"><strong>{animatedPoints.toLocaleString()}</strong><span>現在のポイント</span></div>
        </div>
        <div className="nm-rank-levels">{ranks.map((item, index) => <div className={index <= rank.index ? 'reached' : ''} key={item.name}><i/><b>{item.name}</b><span>{item.min === 0 ? '0円〜' : `累計${(item.min / 10_000).toLocaleString()}万円〜`}</span></div>)}</div>
        <div className="nm-member-summary"><div><span>累計購入額</span><b>¥{data.commerce.purchaseAmount.toLocaleString()}</b></div>{rank.next ? <p>あと <b>¥{Math.max(0, rank.next.min - data.commerce.purchaseAmount).toLocaleString()}</b> で{rank.next.name}</p> : <p>最高ランクです。いつもありがとうございます。</p>}</div>
      </section>
    </header> : <header className="nm-page-header"><span>NEN MEMBERS</span><h1>{tabLabel}</h1></header>}
    {tab === 'home' && <section className="nm-stack"><div className="nm-welcome"><span>WELCOME TO NEN</span><h2>毎日の健やかさを、<br />一緒に育てていきましょう。</h2></div><div className="nm-card"><div className="nm-section-heading"><span>MY PET</span><h2>マイペット</h2></div>{data.pets.length ? data.pets.map(p => <div className="nm-pet" key={p.id}><div><b>{p.name}ちゃん</b><span>{p.breed}・{p.weightKg}kg</span></div><p>フード目安 <strong>{p.recommendedDailyMinGrams}〜{p.recommendedDailyMaxGrams}g/日</strong></p><p>鹿肉トッピング目安 <strong>{p.venisonDailyGrams}g/日まで</strong></p><small>1kg：約{p.foodCycleDays}日分</small></div>) : <p>まだ登録がありません。</p>}</div><div className="nm-card"><div className="nm-section-heading"><span>MEMBER DATA</span><h2>会員情報</h2></div><div className="nm-stats"><div><b>{data.commerce.purchaseCount}</b><span>購入回数</span></div><div><b>¥{data.commerce.purchaseAmount.toLocaleString()}</b><span>累計購入額</span></div></div></div></section>}
    {tab === 'pets' && <PetsView ctx={ctx} pets={data.pets} onChanged={() => void load()} />}
    {tab === 'health' && <HealthDiary ctx={ctx} pets={data.pets} />}
    {tab === 'orders' && <div className="nm-stack nm-orders-page"><section className="nm-card"><div className="nm-section-heading"><span>SUBSCRIPTION</span><h2>定期便の契約状況</h2></div>{subscriptions.length ? subscriptions.map((subscription: any, contractIndex: number) => <article className="nm-subscription-view" key={subscription.id || subscription.contract_number || contractIndex}><div><span>現在の状況</span><b>{subscription.status || '契約中'}</b></div><div><span>次回お届け</span><b>{displayDate(subscription.nextShippingDate || subscription.next_shipping_date) || '確認中'}</b></div><div><span>お届け周期</span><b>{subscription.cycle || '—'}</b></div>{Array.isArray(subscription.items) && subscription.items.length > 0 && <ul>{subscription.items.map((item: OrderItem, index: number) => <li key={`${item.name}-${index}`}><span>{item.name || '商品'}</span><b>× {item.quantity || 1}</b></li>)}</ul>}<p>変更・スキップ・解約のお手続きはこの画面では行いません。</p></article>) : <p className="nm-empty-text">契約中の定期便はありません。</p>}</section><section className="nm-card"><div className="nm-section-heading"><span>ORDER HISTORY</span><h2>通常購入の履歴</h2></div>{data.commerce.orders.length ? data.commerce.orders.map((order, index) => <article className="nm-order" key={order.id || index}><div className="nm-order-head"><div><b>注文番号 {order.number || index + 1}</b><time>{displayDate(order.date || order.orderDate)}</time></div><strong>¥{Number(order.total || 0).toLocaleString()}</strong></div>{Array.isArray(order.items) && order.items.length > 0 ? <div className="nm-order-items">{order.items.map((item, itemIndex) => { const productUrl = item.product_url || item.productUrl; return <div key={`${item.name}-${itemIndex}`}><span>{item.name || '商品'} <small>× {item.quantity || 1}</small></span>{productUrl && <a href={productUrl} target="_blank" rel="noreferrer">もう一度購入</a>}</div>; })}</div> : <p className="nm-order-no-item">商品情報を確認中です。</p>}{order.detailUrl && <a className="nm-order-detail" href={order.detailUrl} target="_blank" rel="noreferrer">注文内容を見る</a>}</article>) : <p className="nm-empty-text">通常購入の履歴はまだありません。</p>}</section></div>}
    {tab === 'photos' && <div className="nm-stack nm-photo-page"><PhotoCampaign photos={data.photos} sitePhotos={sitePhotos} stats={data.photoStats} /><PhotoForm ctx={ctx} pets={data.pets} onDone={() => void load()} />{data.photos.length > 0 && <section className="nm-adopted-gallery"><div className="nm-list-heading"><span>NEN FAMILY GALLERY</span><h2>みんなの採用写真</h2></div><div className="nm-gallery">{data.photos.map(p => <figure key={p.id}><img src={p.imageUrl} alt={`${p.petName || 'ペット'}ちゃん`} /><figcaption><b>{p.petName || 'ペット'}ちゃん</b>{p.caption && <small>{p.caption}</small>}<span>公式サイト掲載中</span></figcaption></figure>)}</div></section>}</div>}
    <nav className="nm-bottom-nav" aria-label="会員メニュー">{tabItems.map(item => <button className={tab === item.value ? 'active' : ''} onClick={() => { setTab(item.value); window.scrollTo({ top: 0, behavior: 'smooth' }); }} key={item.value}><i><TabIcon tab={item.value} /></i><span>{item.label}</span></button>)}</nav>
  </main>;
}

export function mountNenMember(container: HTMLElement, ctx: Ctx) { root?.unmount(); root = createRoot(container); root.render(<StrictMode><App ctx={ctx} /></StrictMode>); }

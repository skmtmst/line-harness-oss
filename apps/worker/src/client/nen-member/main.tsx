import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import './styles.css';

type Ctx = { liffId: string; lineUserId: string; idToken: string };
type FeedingProduct = { id: string; name: string; kcalPer100g: number; isDefault?: boolean };
type Feeding = { dailyKcal: number; dailyGrams: number | null; minGrams: number | null; maxGrams: number | null; rerKcal: number; factor: number; factorLabel: string; stage: string; stageLabel: string; ageMonths: number | null; product: FeedingProduct | null };
type Neutered = 'yes' | 'no' | 'unknown';
type Activity = 'low' | 'normal' | 'high';
type Pet = { id: string; name: string; animalType: string; gender?: string; breed: string; birthday: string; weightKg: number; concerns: string[]; neutered?: Neutered; activityLevel?: Activity; feedingProductId?: string | null; feeding?: Feeding | null; recommendedDailyMinGrams: number; recommendedDailyMaxGrams: number; venisonDailyGrams: number; foodCycleDays: number; imageUrl?: string | null };
type OrderItem = { name?: string; quantity?: number; product_id?: string | number | null; product_url?: string | null; productUrl?: string | null };
type CommerceOrder = { id?: string; number?: string; date?: string; orderDate?: string; total?: number; detailUrl?: string | null; items?: OrderItem[] };
type MemberPhoto = { id: string; imageUrl: string; caption: string; status: string; awardedPoints: number; petName?: string };
type SiteGalleryPhoto = { imageUrl: string; alt: string };
type Membership = {
  rankKey: string | null; rankName: string; mileRatePercent: number | null;
  annualMilesYen: number; lifetimeMilesYen: number; mileBalance: number; validUntil: string | null;
  next: { name: string; thresholdYen: number; remainingYen: number } | null;
  ranks: Array<{ key: string; name: string; thresholdYen: number; mileRatePercent: number }>;
  milestones: Array<{ thresholdYen: number; title: string; reached: boolean }>;
  nextMilestone: { thresholdYen: number; title: string; remainingYen: number } | null;
};
type MemberData = { owner: { displayName: string | null }; membership?: Membership; pets: Pet[]; feedingProducts?: FeedingProduct[]; commerce: { orders: CommerceOrder[]; subscription: any; purchaseCount: number; purchaseAmount: number; points: number; rank: string }; photos: MemberPhoto[]; photoStats: { submittedCount: number; pendingCount: number; adoptedCount: number; earnedPoints: number } };
type HealthLog = { id: string; pet_id: string; logged_on: string; weight_kg: number | null; heart_rate_bpm: number | null; respiratory_rate_bpm: number | null; stool_status: string; appetite: string; skin_status: string; tear_stain_status: string; note: string };
type HealthPeriod = 'day' | 'week' | 'month';
type Tab = 'home' | 'pets' | 'health' | 'orders' | 'photos';
let root: Root | null = null;

const tabItems: Array<{ value: Tab; label: string }> = [
  { value: 'home', label: 'マイページ' },
  { value: 'pets', label: 'マイペット' },
  { value: 'health', label: '健康日記' },
  { value: 'orders', label: '注文・定期' },
  { value: 'photos', label: '投稿' },
];

async function call<T>(ctx: Ctx, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { Authorization: `Bearer ${ctx.idToken}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error(data.error || '通信に失敗しました');
  return data;
}
const concernLabels: Record<string, string> = { tear_stain: '涙やけ', coat: '毛並み', allergy: 'アレルギー', appetite: '食いつき', stool: '便', weight: '体重', other: 'その他' };
const neuteredOptions: Array<[Neutered, string]> = [['unknown', 'わからない'], ['yes', '済み'], ['no', 'していない']];
const activityOptions: Array<[Activity, string]> = [['low', '少なめ'], ['normal', 'ふつう'], ['high', '多め']];
const neuteredChip: Record<Neutered, string> = { yes: '避妊・去勢済み', no: '避妊・去勢なし', unknown: '避妊・去勢 未回答' };
const activityChip: Record<Activity, string> = { low: '運動 少なめ', normal: '運動 ふつう', high: '運動 多め' };
/** 「今日の目安」の短い表記。主食が登録されていれば g、なければ kcal だけ。どちらも無ければ従来の幅。 */
function feedingSummary(pet: Pet): string {
  const f = pet.feeding;
  if (f?.dailyGrams != null) return `${f.dailyGrams}g／日`;
  if (f) return `${f.dailyKcal}kcal／日`;
  return `${pet.recommendedDailyMinGrams}〜${pet.recommendedDailyMaxGrams}g／日`;
}
function petBasics(pet: Pet): string {
  const gender = pet.gender === 'male' ? '男の子' : pet.gender === 'female' ? '女の子' : '';
  const age = petAgeDetail(pet.birthday);
  return [pet.animalType === 'cat' ? '猫' : '犬', pet.breed].filter(Boolean).join('・') + (age || gender ? `／${[age, gender].filter(Boolean).join('・')}` : '');
}
function petAgeDetail(birthday: string): string {
  const born = new Date(`${birthday}T00:00:00`);
  if (!birthday || Number.isNaN(born.getTime())) return '';
  const today = new Date();
  let months = (today.getFullYear() - born.getFullYear()) * 12 + (today.getMonth() - born.getMonth());
  if (today.getDate() < born.getDate()) months -= 1;
  if (months < 0) return '';
  if (months < 12) return `${months}か月`;
  return `${Math.floor(months / 12)}歳${months % 12 ? `${months % 12}か月` : ''}`;
}
/**
 * 変更画面のプレビュー用。Worker `services/nen-feeding.ts` と同じ式・係数（NRC／FEDIAF）。
 * 保存後の正の値はサーバーが返す。
 */
function previewFeeding(animalType: string, weightKg: number, birthday: string, neutered: Neutered, activity: Activity, product: FeedingProduct | null): { kcal: number; grams: number | null; label: string; formula: string } | null {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
  const cat = animalType === 'cat';
  const born = new Date(`${birthday}T00:00:00`);
  const today = new Date();
  const months = Number.isNaN(born.getTime()) ? null : (today.getFullYear() - born.getFullYear()) * 12 + (today.getMonth() - born.getMonth()) - (today.getDate() < born.getDate() ? 1 : 0);
  const stage = months == null ? 'adult' : months < 12 ? 'young' : months >= (cat ? 132 : 84) ? 'senior' : 'adult';
  let factor: number; let label: string;
  if (stage === 'young') { factor = cat ? 2.5 : months != null && months < 4 ? 3.0 : 2.0; label = cat ? '子猫' : months != null && months < 4 ? '子犬（4か月未満）' : '子犬'; }
  else {
    const intact = neutered === 'no';
    factor = cat ? (stage === 'senior' ? (intact ? 1.3 : 1.1) : (intact ? 1.4 : 1.2)) : (stage === 'senior' ? (intact ? 1.6 : 1.4) : (intact ? 1.8 : 1.6));
    const step = cat ? 0.1 : 0.2;
    factor = Math.round((factor + (activity === 'high' ? step : activity === 'low' ? -step : 0)) * 100) / 100;
    label = `${stage === 'senior' ? 'シニア' : cat ? '成猫' : '成犬'}${intact ? '' : '・避妊去勢済み'}${activity === 'high' ? '・運動多め' : activity === 'low' ? '・運動少なめ' : ''}`;
  }
  const rer = Math.round(70 * Math.pow(Math.round(weightKg * 10) / 10, 0.75));
  const kcal = Math.round(rer * factor);
  const grams = product ? Math.max(1, Math.round((kcal / product.kcalPer100g) * 100)) : null;
  return { kcal, grams, label, formula: `70 × ${Math.round(weightKg * 10) / 10}^0.75 × ${factor}（${label}）${product ? ` ÷ ${product.kcalPer100g}kcal × 100` : ''}` };
}
function productFor(pet: Pet, products: FeedingProduct[]): FeedingProduct | null {
  return pet.feeding?.product ?? products.find(p => p.id === pet.feedingProductId) ?? products.find(p => p.isDefault) ?? products[0] ?? null;
}
/** 避妊去勢・運動量・主食の入力（登録と変更で共通）。★V6 37-2-A-1 の3択と選択。 */
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (next: T) => void }) {
  return <div className="nm-seg-field"><span>{label}</span><div className="nm-seg" role="radiogroup" aria-label={label}>{options.map(([v, l]) => <button type="button" key={v} role="radio" aria-checked={value === v} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>{l}</button>)}</div></div>;
}
function ProductSelect({ value, products, onChange }: { value: string; products: FeedingProduct[]; onChange: (next: string) => void }) {
  if (products.length === 0) return null;
  const fallback = products.find(p => p.isDefault) || products[0];
  return <Field label="いつもの主食"><select value={value} onChange={e => onChange(e.target.value)}><option value="">おまかせ（{fallback.name}）</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}（{p.kcalPer100g}kcal/100g）</option>)}</select></Field>;
}

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

function PetForm({ ctx, products, onDone, onCancel }: { ctx: Ctx; products: FeedingProduct[]; onDone: () => void; onCancel: () => void }) {
  const emptyForm = { name: '', animalType: 'dog', breed: '', gender: 'unknown', birthday: '', weightKg: '', concerns: [] as string[], neutered: 'unknown' as Neutered, activityLevel: 'normal' as Activity, feedingProductId: '' };
  const [form, setForm] = useState(emptyForm);
  const [photo, setPhoto] = useState<OptimizedPhoto | null>(null); const [cropFile, setCropFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async () => { setBusy(true); setError(''); try { await call(ctx, '/api/liff/nen/pets', { method: 'POST', body: JSON.stringify({ ...form, weightKg: Number(form.weightKg), feedingProductId: form.feedingProductId || null, photoData: photo?.data }) }); setForm(emptyForm); onDone(); } catch (e) { setError(e instanceof Error ? e.message : '登録できませんでした'); } finally { setBusy(false); } };
  return <section className="nm-card nm-pet-form"><button className="nm-back" type="button" onClick={onCancel}>← マイペットへ戻る</button><div className="nm-section-heading"><span>NEW PET</span><h2>マイペットを登録</h2></div><p className="nm-sub">多頭飼いの場合は、1頭ずつ追加できます。</p>
    <label className="nm-pet-photo-picker"><input type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) setCropFile(file); e.target.value = ''; }} />{photo ? <img src={photo.data} alt="ペット写真の確認" /> : <span>＋</span>}<b>{photo ? '写真を変更' : 'ペットの写真を登録'}</b><small>任意・位置と大きさを調整できます</small></label>
    <div className="nm-grid"><Field label="ペット名"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field><fieldset className="nm-species-field"><legend>種別</legend><div className="nm-species">{([['dog','わんちゃん'],['cat','ねこちゃん']] as const).map(([value,label]) => <label className={form.animalType === value ? 'active' : ''} key={value}><input type="radio" name="animalType" value={value} checked={form.animalType === value} onChange={() => setForm({ ...form, animalType: value })}/><span>{label}</span></label>)}</div></fieldset><Field label="犬種・猫種"><input value={form.breed} onChange={e => setForm({ ...form, breed: e.target.value })} /></Field><Field label="誕生日"><input type="date" value={form.birthday} onChange={e => setForm({ ...form, birthday: e.target.value })} /></Field><Field label="体重（kg）"><input type="number" min="0.2" step="0.1" value={form.weightKg} onChange={e => setForm({ ...form, weightKg: e.target.value })} /></Field></div>
    <Segmented label="避妊・去勢" value={form.neutered} options={neuteredOptions} onChange={neutered => setForm({ ...form, neutered })} /><Segmented label="運動量" value={form.activityLevel} options={activityOptions} onChange={activityLevel => setForm({ ...form, activityLevel })} /><ProductSelect value={form.feedingProductId} products={products} onChange={feedingProductId => setForm({ ...form, feedingProductId })} />
    <fieldset><legend>現在のお悩み（複数選択可）</legend><div className="nm-chips">{Object.entries(concernLabels).map(([key, label]) => <label key={key} className={form.concerns.includes(key) ? 'active' : ''}><input type="checkbox" checked={form.concerns.includes(key)} onChange={() => setForm({ ...form, concerns: form.concerns.includes(key) ? form.concerns.filter(v => v !== key) : [...form.concerns, key] })} />{label}</label>)}</div></fieldset>
    {error && <p className="nm-error">{error}</p>}<button className="nm-primary" disabled={busy} onClick={() => void submit()}>{busy ? '登録中…' : '登録する'}</button>{cropFile && <PetPhotoCropper file={cropFile} onCancel={() => setCropFile(null)} onDone={value => { setPhoto(value); setCropFile(null); }} />}</section>;
}

/** ★V6 37-2-A 然・マイペット：ペットカード（写真・印・今日の目安・基本情報・操作）。 */
function PetProfileCard({ pet, ctx, products, onEdit, onHealth, onChanged }: { pet: Pet; ctx: Ctx; products: FeedingProduct[]; onEdit: () => void; onHealth: () => void; onChanged: () => void }) {
  const [cropFile, setCropFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const updatePhoto = async (photo: OptimizedPhoto) => { setBusy(true); setError(''); try { await call(ctx, `/api/liff/nen/pets/${pet.id}/photo`, { method: 'POST', body: JSON.stringify({ data: photo.data }) }); setCropFile(null); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : '写真を変更できませんでした'); } finally { setBusy(false); } };
  const f = pet.feeding; const product = productFor(pet, products);
  return <article className="nm-card nm-v6-pet">
    <div className="nm-v6-pet-top"><label className="nm-v6-pet-photo"><input type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) setCropFile(file); e.target.value = ''; }} />{pet.imageUrl ? <img src={pet.imageUrl} alt={`${pet.name}ちゃん`} /> : <TabIcon tab="pets" />}<i aria-hidden="true">{busy ? '…' : '+'}</i></label>
      <div className="nm-v6-pet-name"><h2>{pet.name}ちゃん</h2><p>{petBasics(pet)}</p><div className="nm-v6-chips"><span className="nm-v6-chip">{neuteredChip[pet.neutered || 'unknown']}</span><span className="nm-v6-chip nm-v6-chip-info">{activityChip[pet.activityLevel || 'normal']}</span></div></div></div>
    <div className="nm-v6-guide"><div className="nm-v6-guide-row"><div><span>今日の目安</span><b>{f?.dailyGrams != null ? <>{f.dailyGrams}<small>g／日</small></> : f ? <>{f.dailyKcal}<small>kcal／日</small></> : <>{pet.recommendedDailyMinGrams}〜{pet.recommendedDailyMaxGrams}<small>g／日</small></>}</b></div>{f?.dailyGrams != null && <em>約 {f.dailyKcal} kcal</em>}</div>
      <p>{f ? `${f.factorLabel} × 体重${pet.weightKg}kg${product ? ` → ${product.name}（${product.kcalPer100g}kcal/100g）` : '。主食のカロリーが登録されるとグラムで表示されます'}` : '体重と年齢から計算した参考値です。'}</p></div>
    <div className="nm-v6-facts"><div><span>体重</span><b>{pet.weightKg}kg</b></div><div><span>誕生日</span><b>{pet.birthday.replaceAll('-', '.')}</b></div><div><span>いつもの主食</span><b>{product ? product.name : '未設定'}</b></div></div>
    <p className="nm-v6-concerns">お悩み　{pet.concerns.map(v => concernLabels[v] || v).join('・') || '未登録'}</p>
    <div className="nm-v6-actions"><button type="button" className="nm-v6-btn nm-v6-btn-accent" onClick={onEdit}>体重・運動量を変更</button><button type="button" className="nm-v6-btn" onClick={onHealth}>健康日記を見る</button></div>
    {error && <p className="nm-error">{error}</p>}{cropFile && <PetPhotoCropper file={cropFile} onCancel={() => setCropFile(null)} onDone={value => void updatePhoto(value)} />}
  </article>;
}

/** ★V6 37-2-A-1 然・マイペット 変更：体重・避妊去勢・運動量・主食だけ。保存すると「今日の目安」が計算し直される。 */
function PetEditView({ ctx, pet, products, onSaved, onCancel }: { ctx: Ctx; pet: Pet; products: FeedingProduct[]; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ weightKg: String(pet.weightKg ?? ''), neutered: (pet.neutered || 'unknown') as Neutered, activityLevel: (pet.activityLevel || 'normal') as Activity, feedingProductId: pet.feedingProductId || '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const product = products.find(p => p.id === form.feedingProductId) || products.find(p => p.isDefault) || products[0] || null;
  const preview = previewFeeding(pet.animalType, Number(form.weightKg), pet.birthday, form.neutered, form.activityLevel, product);
  const submit = async () => { setBusy(true); setError(''); try { await call(ctx, `/api/liff/nen/pets/${pet.id}`, { method: 'PUT', body: JSON.stringify({ weightKg: Number(form.weightKg), neutered: form.neutered, activityLevel: form.activityLevel, feedingProductId: form.feedingProductId || null }) }); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : '変更できませんでした'); } finally { setBusy(false); } };
  return <section className="nm-stack nm-home-stack nm-v6-edit"><button className="nm-back" type="button" onClick={onCancel}>← マイペットへ戻る</button>
    <div className="nm-v6-heading"><span>EDIT</span><h2>{pet.name}ちゃんの体重・運動量</h2><p>変えると「今日の目安」がその場で計算し直されます。</p></div>
    <div className="nm-card nm-v6-form"><label className="nm-field"><span>体重（kg）</span><input inputMode="decimal" type="number" min="0.2" max="150" step="0.1" value={form.weightKg} onChange={e => setForm({ ...form, weightKg: e.target.value })} /></label>
      <Segmented label="避妊・去勢" value={form.neutered} options={neuteredOptions} onChange={neutered => setForm({ ...form, neutered })} /><Segmented label="運動量" value={form.activityLevel} options={activityOptions} onChange={activityLevel => setForm({ ...form, activityLevel })} /><ProductSelect value={form.feedingProductId} products={products} onChange={feedingProductId => setForm({ ...form, feedingProductId })} /></div>
    <div className="nm-v6-guide"><div className="nm-v6-guide-row"><div><span>この内容での今日の目安</span><b>{preview ? (preview.grams != null ? <>{preview.grams}<small>g／日</small></> : <>{preview.kcal}<small>kcal／日</small></>) : '—'}</b></div>{preview?.grams != null && <em>約 {preview.kcal} kcal</em>}</div>{preview && <p>{preview.formula}</p>}</div>
    {error && <p className="nm-error">{error}</p>}<button className="nm-primary nm-v6-primary" disabled={busy || !Number.isFinite(Number(form.weightKg)) || Number(form.weightKg) <= 0} onClick={() => void submit()}>{busy ? '保存中…' : '保存して目安を計算し直す'}</button>
    <p className="nm-note">目安は参考値です。体型や体調で前後します。獣医師の判断に代わるものではありません。</p></section>;
}

/** ★V6 37-2-A 然・マイペット：見出し行（登録する）→ ペットカード → 注記。 */
function PetsView({ ctx, pets, products, onChanged, onHealth }: { ctx: Ctx; pets: Pet[]; products: FeedingProduct[]; onChanged: () => void; onHealth: () => void }) {
  const [registering, setRegistering] = useState(false); const [editingId, setEditingId] = useState<string | null>(null);
  const editing = pets.find(p => p.id === editingId);
  if (registering) return <PetForm ctx={ctx} products={products} onCancel={() => setRegistering(false)} onDone={() => { setRegistering(false); onChanged(); }} />;
  if (editing) return <PetEditView ctx={ctx} pet={editing} products={products} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); onChanged(); }} />;
  return <section className="nm-stack nm-home-stack nm-v6-pets">
    <div className="nm-v6-heading-row"><div className="nm-v6-heading"><span>MY PETS</span><h2>マイペット</h2></div><button type="button" className="nm-v6-add" onClick={() => setRegistering(true)}>＋ 登録する</button></div>
    {pets.length ? pets.map(pet => <PetProfileCard key={pet.id} pet={pet} ctx={ctx} products={products} onEdit={() => setEditingId(pet.id)} onHealth={onHealth} onChanged={onChanged} />) : <button className="nm-add-pet" onClick={() => setRegistering(true)}><span>＋</span><div><b>マイペットを登録</b><small>はじめに、うちの子を登録しましょう</small></div><i>›</i></button>}
    <p className="nm-note">目安は体重・年齢・避妊去勢・運動量から公的な指針（NRC／FEDIAF）の式で計算した参考値です。体型や体調で前後します。獣医師の判断に代わるものではありません。</p>
  </section>;
}

// ---------------------------------------------------------------- 健康日記（★V6 37-2-B `CkgoD`）

type HealthKey = 'weight' | 'heart' | 'resp' | 'stool' | 'appetite';
const healthKeys: Array<{ value: HealthKey; label: string; unit: string }> = [
  { value: 'weight', label: '体重', unit: 'kg' },
  { value: 'heart', label: '心拍', unit: '回/分' },
  { value: 'resp', label: '呼吸', unit: '回/分' },
  { value: 'stool', label: '便', unit: '' },
  { value: 'appetite', label: '食いつき', unit: '' },
];
const stoolLabel: Record<string, string> = { normal: '正常', soft: 'やわらかい', hard: 'かたい', diarrhea: '下痢', bloody: '血が混じる', other: 'その他' };
const appetiteLabel: Record<string, string> = { good: '良好', normal: '普通', poor: '不良' };
const skinLabel: Record<string, string> = { normal: '問題なし', itchy: 'かゆそう', red: '赤み', other: 'その他' };
const tearLabel: Record<string, string> = { normal: '問題なし', mild: '少し気になる', concern: '気になる' };
/** 便・食いつきは 3 段階の点数にして棒にする（3＝いつも通り、1＝気になる）。 */
const stoolScore: Record<string, number> = { normal: 3, soft: 2, hard: 2, other: 2, diarrhea: 1, bloody: 1 };
const appetiteScore: Record<string, number> = { good: 3, normal: 2, poor: 1 };

function healthValue(log: HealthLog, key: HealthKey): number | null {
  if (key === 'weight') return log.weight_kg == null ? null : Number(log.weight_kg);
  if (key === 'heart') return log.heart_rate_bpm == null ? null : Number(log.heart_rate_bpm);
  if (key === 'resp') return log.respiratory_rate_bpm == null ? null : Number(log.respiratory_rate_bpm);
  if (key === 'stool') return stoolScore[log.stool_status] ?? null;
  return appetiteScore[log.appetite] ?? null;
}
function fmtValue(key: HealthKey, value: number): string {
  if (key === 'weight') return value.toFixed(1);
  if (key === 'stool' || key === 'appetite') return value >= 2.5 ? '良' : value >= 1.5 ? '中' : '注';
  return String(Math.round(value));
}
/** 期間ごとに 8 枠（日＝直近8日、週＝直近8週の平均、月＝直近8か月の平均）。記録の無い枠は null。 */
function healthBars(logs: HealthLog[], key: HealthKey, period: HealthPeriod): Array<{ label: string; value: number | null }> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const slots: Array<{ start: Date; end: Date; label: string }> = [];
  for (let i = 7; i >= 0; i -= 1) {
    if (period === 'day') { const d = new Date(today); d.setDate(d.getDate() - i); const e = new Date(d); e.setDate(e.getDate() + 1); slots.push({ start: d, end: e, label: `${d.getMonth() + 1}/${d.getDate()}` }); }
    else if (period === 'week') { const e = new Date(today); e.setDate(e.getDate() - i * 7 + 1); const d = new Date(e); d.setDate(d.getDate() - 7); slots.push({ start: d, end: e, label: `${d.getMonth() + 1}/${d.getDate()}` }); }
    else { const d = new Date(today.getFullYear(), today.getMonth() - i, 1); const e = new Date(today.getFullYear(), today.getMonth() - i + 1, 1); slots.push({ start: d, end: e, label: `${d.getMonth() + 1}月` }); }
  }
  return slots.map(slot => {
    const values = logs.map(log => ({ date: new Date(`${log.logged_on}T00:00:00`), value: healthValue(log, key) }))
      .filter(item => item.value != null && item.date >= slot.start && item.date < slot.end).map(item => item.value as number);
    return { label: slot.label, value: values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null };
  });
}
/** 棒グラフ（★V6 37-2-B 推移カード）。8 枠。数値は最小〜最大の幅で高さを決める。 */
function HealthBars({ bars, keyName }: { bars: Array<{ label: string; value: number | null }>; keyName: HealthKey }) {
  const known = bars.map(b => b.value).filter((v): v is number => v != null);
  if (!known.length) return <div className="nm-v6-bars-empty"><b>この期間の記録はまだありません</b><p>「今日を記録」から付けると、ここに推移が出ます。</p></div>;
  const min = keyName === 'stool' || keyName === 'appetite' ? 0 : Math.min(...known); const max = keyName === 'stool' || keyName === 'appetite' ? 3 : Math.max(...known);
  const height = (v: number) => max === min ? 60 : 24 + Math.round(((v - min) / (max - min)) * 72);
  return <div className="nm-v6-bars" role="img" aria-label={`${healthKeys.find(k => k.value === keyName)?.label}の推移`}>
    {bars.map((bar, index) => <div key={index} className="nm-v6-bar-col">
      {bar.value == null ? <i className="nm-v6-bar nm-v6-bar-empty" /> : <i className={`nm-v6-bar${(keyName === 'stool' || keyName === 'appetite') && bar.value < 1.5 ? ' nm-v6-bar-warn' : ''}`} style={{ height: `${height(bar.value)}%` }}><b>{fmtValue(keyName, bar.value)}</b></i>}
      <span>{bar.label}</span>
    </div>)}
  </div>;
}
function weekAgoNote(logs: HealthLog[]): string {
  const latest = logs.find(log => log.weight_kg != null);
  if (!latest) return '—';
  const latestDate = new Date(`${latest.logged_on}T00:00:00`);
  const before = logs.find(log => log.weight_kg != null && (latestDate.getTime() - new Date(`${log.logged_on}T00:00:00`).getTime()) >= 6 * 86_400_000);
  if (!before) return '先週の記録なし';
  const diff = Math.round((Number(latest.weight_kg) - Number(before.weight_kg)) * 10) / 10;
  return diff === 0 ? '先週と同じ' : `先週 ${diff > 0 ? '+' : ''}${diff.toFixed(1)}`;
}
function stableNote(logs: HealthLog[], key: 'heart' | 'resp'): string {
  const values = logs.map(log => healthValue(log, key)).filter((v): v is number => v != null);
  if (!values.length) return '—';
  if (values.length < 3) return '記録を続けましょう';
  const [latest, ...rest] = values; const avg = rest.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, rest.length);
  return Math.abs(latest - avg) / avg <= 0.15 ? '安定' : latest > avg ? 'いつもより多め' : 'いつもより少なめ';
}
function recordLine(log: HealthLog): string {
  return [log.weight_kg == null ? '' : `${Number(log.weight_kg).toFixed(1)}kg`, `便 ${stoolLabel[log.stool_status] ?? log.stool_status}`, `食いつき ${appetiteLabel[log.appetite] ?? log.appetite}`].filter(Boolean).join('・');
}

function HealthForm({ ctx, pet, onSaved }: { ctx: Ctx; pet: Pet; onSaved: () => void }) {
  const [form, setForm] = useState({ petId: pet.id, loggedOn: new Date().toISOString().slice(0, 10), weightKg: '', heartRateBpm: '', respiratoryRateBpm: '', stoolStatus: 'normal', appetite: 'normal', skinStatus: 'normal', tearStainStatus: 'normal', note: '' });
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(value => ({ ...value, petId: pet.id })); setMessage(''); }, [pet.id]);
  const submit = async () => { setBusy(true); setMessage(''); try { const res = await call<{ data: { careRequired: boolean } }>(ctx, '/api/liff/nen/health-logs', { method: 'POST', body: JSON.stringify(form) }); setMessage(res.data.careRequired ? '記録しました。気になる状態が続いているため、管理画面に要ケアとして共有しました。' : '今日の健康記録を保存しました。'); onSaved(); } catch (error) { setMessage(error instanceof Error ? error.message : '記録できませんでした'); } finally { setBusy(false); } };
  return <section className="nm-card nm-health-form nm-v6-form"><div className="nm-section-heading"><span>DAILY RECORD</span><h2>{pet.name}ちゃんの健康を記録</h2></div><div className="nm-grid"><Field label="記録日"><input type="date" value={form.loggedOn} onChange={e => setForm({ ...form, loggedOn: e.target.value })} /></Field><Field label="体重（kg）"><input inputMode="decimal" type="number" min="0.2" max="150" step="0.1" placeholder="例：8.4" value={form.weightKg} onChange={e => setForm({ ...form, weightKg: e.target.value })} /></Field><Field label="心拍数（回/分）"><input inputMode="numeric" type="number" min="20" max="300" step="1" placeholder="例：96" value={form.heartRateBpm} onChange={e => setForm({ ...form, heartRateBpm: e.target.value })} /></Field><Field label="呼吸数（回/分）"><input inputMode="numeric" type="number" min="5" max="150" step="1" placeholder="例：24" value={form.respiratoryRateBpm} onChange={e => setForm({ ...form, respiratoryRateBpm: e.target.value })} /></Field><Field label="便"><select value={form.stoolStatus} onChange={e => setForm({ ...form, stoolStatus: e.target.value })}><option value="normal">正常</option><option value="soft">やわらかい</option><option value="hard">かたい</option><option value="diarrhea">下痢</option><option value="bloody">血が混じる</option><option value="other">その他</option></select></Field><Field label="食いつき"><select value={form.appetite} onChange={e => setForm({ ...form, appetite: e.target.value })}><option value="good">良好</option><option value="normal">普通</option><option value="poor">不良</option></select></Field><Field label="皮膚"><select value={form.skinStatus} onChange={e => setForm({ ...form, skinStatus: e.target.value })}><option value="normal">問題なし</option><option value="itchy">かゆそう</option><option value="red">赤み</option><option value="other">その他</option></select></Field><Field label="涙やけ"><select value={form.tearStainStatus} onChange={e => setForm({ ...form, tearStainStatus: e.target.value })}><option value="normal">問題なし</option><option value="mild">少し気になる</option><option value="concern">気になる</option></select></Field></div><Field label="その日の様子・獣医師に伝えたいこと"><textarea rows={4} placeholder="食事、運動、投薬、気になった変化など" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></Field>{message && <Notice>{message}</Notice>}<button className="nm-primary nm-v6-primary" disabled={busy} onClick={() => void submit()}>{busy ? '保存中…' : '今日の記録を保存'}</button></section>;
}

function MeasureGuide() {
  return <section className="nm-card nm-measure-guide"><div className="nm-section-heading"><span>HOW TO MEASURE</span><h2>おうちでの測り方</h2></div><div className="nm-measure-item"><i>01</i><div><h3>体重</h3><p>ペットを抱いて体重計に乗り、表示された重さから飼い主さま自身の体重を差し引きます。毎回できるだけ同じ時間・同じ条件で測ると変化を比べやすくなります。</p></div></div><div className="nm-measure-item"><i>02</i><div><h3>心拍数</h3><p>落ち着いている時に胸のあたりへそっと手を当て、15秒間の拍動数を数えて4倍します。家庭での参考目安は大型犬60〜80回、小型犬80〜120回、猫130〜160回/分ですが、年齢・体格・緊張などで変わります。</p></div></div><div className="nm-measure-item"><i>03</i><div><h3>呼吸数</h3><p>眠っている時や安静時に胸・お腹の上下を見て、「吸って吐く」を1回として15秒間数え、4倍します。20〜30回/分をひとつの参考にし、パンティング中や猫が喉を鳴らしている時は避けましょう。</p></div></div><div className="nm-health-caution">数値だけで病気を判断するものではありません。普段と違う状態が続く、呼吸が苦しそう、ぐったりしているなどの症状がある場合は、記録を待たず獣医師へご相談ください。</div></section>;
}

type HealthSummaryData = { pet: { id: string; name: string; animalType: string; breed: string; birthday: string | null; weightKg: number | null }; owner: { name: string }; generatedAt: string; summary: { days: number; records: number; weight: { first: number; last: number; min: number; max: number } | null; heartRateAvg: number | null; respiratoryRateAvg: number | null; stool: Record<string, number>; appetite: Record<string, number>; skin: Record<string, number>; tearStain: Record<string, number>; notes: Array<{ loggedOn: string; note: string }>; logs: Array<{ loggedOn: string; weightKg: number | null; heartRateBpm: number | null; respiratoryRateBpm: number | null; stool: string; appetite: string; skin: string | null; tearStain: string | null }> } };
function countText(counts: Record<string, number>, labels: Record<string, string>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([k, n]) => `${labels[k] ?? k} ${n}回`).join('・') : '—';
}
/** 「獣医師に見せる（直近30日のまとめ）」。管理画面の 30日のまとめ と同じ内容を、診察室で見せやすい 1 画面にする。 */
function HealthSummaryView({ ctx, pet, onBack }: { ctx: Ctx; pet: Pet; onBack: () => void }) {
  const [data, setData] = useState<HealthSummaryData | null>(null); const [error, setError] = useState('');
  useEffect(() => { let active = true; call<{ data: HealthSummaryData }>(ctx, `/api/liff/nen/health-logs/summary?petId=${encodeURIComponent(pet.id)}`).then(r => { if (active) setData(r.data); }).catch(e => { if (active) setError(e instanceof Error ? e.message : '読み込めませんでした'); }); return () => { active = false; }; }, [ctx, pet.id]);
  const s = data?.summary;
  return <section className="nm-stack nm-home-stack nm-v6-edit nm-v6-summary"><button className="nm-back" type="button" onClick={onBack}>← 健康日記へ戻る</button>
    <div className="nm-v6-heading"><span>FOR YOUR VET</span><h2>直近30日のまとめ</h2><p>{pet.name}ちゃん（{petBasics(pet)}）。診察のときに獣医師へそのままお見せください。</p></div>
    {error ? <Notice>{error}</Notice> : !s || !data ? <Notice>まとめを作っています…</Notice> : <>
      <div className="nm-v6-facts nm-v6-summary-facts">
        <div><span>記録</span><b>{s.records}件／{s.days}日</b></div>
        <div><span>体重</span><b>{s.weight ? `${s.weight.first}→${s.weight.last}kg` : '—'}</b></div>
        <div><span>体重の幅</span><b>{s.weight ? `${s.weight.min}〜${s.weight.max}` : '—'}</b></div>
        <div><span>心拍（平均）</span><b>{s.heartRateAvg == null ? '—' : `${s.heartRateAvg}回/分`}</b></div>
        <div><span>呼吸（平均）</span><b>{s.respiratoryRateAvg == null ? '—' : `${s.respiratoryRateAvg}回/分`}</b></div>
        <div><span>作成</span><b>{data.generatedAt.slice(5, 10).replace('-', '/')}</b></div>
      </div>
      <div className="nm-v6-summary-list">
        <div><span>便</span><b>{countText(s.stool, stoolLabel)}</b></div>
        <div><span>食いつき</span><b>{countText(s.appetite, appetiteLabel)}</b></div>
        <div><span>皮膚</span><b>{countText(s.skin, skinLabel)}</b></div>
        <div><span>涙やけ</span><b>{countText(s.tearStain, tearLabel)}</b></div>
      </div>
      {s.logs.length > 0 && <div className="nm-v6-summary-table"><div className="nm-v6-summary-row nm-v6-summary-head"><span>日付</span><span>体重</span><span>心拍</span><span>呼吸</span><span>便</span><span>食いつき</span></div>{s.logs.map(log => <div className="nm-v6-summary-row" key={log.loggedOn}><span>{log.loggedOn.slice(5).replace('-', '/')}</span><span>{log.weightKg == null ? '—' : Number(log.weightKg).toFixed(1)}</span><span>{log.heartRateBpm ?? '—'}</span><span>{log.respiratoryRateBpm ?? '—'}</span><span>{stoolLabel[log.stool] ?? log.stool}</span><span>{appetiteLabel[log.appetite] ?? log.appetite}</span></div>)}</div>}
      {s.notes.length > 0 && <div className="nm-v6-summary-notes"><b>メモ</b>{s.notes.map(note => <p key={note.loggedOn}><span>{note.loggedOn.slice(5).replace('-', '/')}</span>{note.note}</p>)}</div>}
      <p className="nm-note">お客様がマイページで付けた記録をまとめたものです。診断や治療の判断は含みません。</p>
    </>}
  </section>;
}

function HealthDiary({ ctx, pets }: { ctx: Ctx; pets: Pet[] }) {
  const [petId, setPetId] = useState(pets[0]?.id || ''); const [logs, setLogs] = useState<HealthLog[]>([]); const [keyName, setKeyName] = useState<HealthKey>('weight'); const [period, setPeriod] = useState<HealthPeriod>('week'); const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'diary' | 'record' | 'summary'>('diary'); const [showAll, setShowAll] = useState(false);
  const loadLogs = useCallback(async () => { setLoading(true); try { const response = await call<{ data: HealthLog[] }>(ctx, '/api/liff/nen/health-logs'); setLogs(response.data); } finally { setLoading(false); } }, [ctx]);
  useEffect(() => { void loadLogs(); }, [loadLogs]);
  useEffect(() => { if (!pets.some(pet => pet.id === petId)) setPetId(pets[0]?.id || ''); }, [pets, petId]);
  if (!pets.length) return <section className="nm-stack nm-home-stack nm-v6-health"><div className="nm-v6-heading"><span>HEALTH DIARY</span><h2>健康日記</h2><p>なるべく早く愛犬愛猫の異変に気付くためには、ご家庭での健康管理が大切です。</p></div><Notice>先にマイペットを登録してください。</Notice></section>;
  const pet = pets.find(item => item.id === petId) || pets[0]; const petLogs = logs.filter(log => log.pet_id === pet.id);
  if (view === 'record') return <section className="nm-stack nm-home-stack nm-v6-edit"><button className="nm-back" type="button" onClick={() => setView('diary')}>← 健康日記へ戻る</button><HealthForm ctx={ctx} pet={pet} onSaved={() => { void loadLogs(); setView('diary'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} /><MeasureGuide /></section>;
  if (view === 'summary') return <HealthSummaryView ctx={ctx} pet={pet} onBack={() => setView('diary')} />;
  const latestWeight = petLogs.find(log => log.weight_kg != null)?.weight_kg; const latestHeart = petLogs.find(log => log.heart_rate_bpm != null)?.heart_rate_bpm; const latestResp = petLogs.find(log => log.respiratory_rate_bpm != null)?.respiratory_rate_bpm;
  const bars = healthBars(petLogs, keyName, period); const keyMeta = healthKeys.find(k => k.value === keyName)!;
  const recent = showAll ? petLogs.slice(0, 30) : petLogs.slice(0, 3);
  return <section className="nm-stack nm-home-stack nm-v6-health">
    <div className="nm-v6-heading-row"><div className="nm-v6-heading"><span>HEALTH DIARY</span><h2>健康日記</h2></div><button type="button" className="nm-v6-add" onClick={() => setView('record')}>＋ 今日を記録</button></div>
    {pets.length > 1 && <div className="nm-v6-pet-switch" role="tablist" aria-label="記録を見るペット">{pets.map(item => <button type="button" role="tab" aria-selected={item.id === pet.id} className={item.id === pet.id ? 'active' : ''} key={item.id} onClick={() => setPetId(item.id)}><i>{item.imageUrl ? <img src={item.imageUrl} alt="" /> : null}</i>{item.name}ちゃん</button>)}</div>}
    <div className="nm-v6-vitals">
      <div><span>体重</span><b>{latestWeight == null ? '—' : Number(latestWeight).toFixed(1)}<small>kg</small></b><em>{weekAgoNote(petLogs)}</em></div>
      <div><span>心拍</span><b>{latestHeart == null ? '—' : Math.round(Number(latestHeart))}<small>回/分</small></b><em>{stableNote(petLogs, 'heart')}</em></div>
      <div><span>呼吸</span><b>{latestResp == null ? '—' : Math.round(Number(latestResp))}<small>回/分</small></b><em>{stableNote(petLogs, 'resp')}</em></div>
    </div>
    <div className="nm-v6-trend">
      <div className="nm-v6-trend-head"><div className="nm-v6-heading"><span>{period === 'day' ? '日別' : period === 'week' ? '週平均' : '月平均'}</span><h2>{keyMeta.label}の推移</h2></div><div className="nm-v6-period" role="radiogroup" aria-label="期間">{([['day', '日'], ['week', '週'], ['month', '月']] as const).map(([value, label]) => <button type="button" role="radio" aria-checked={period === value} className={period === value ? 'active' : ''} key={value} onClick={() => setPeriod(value)}>{label}</button>)}</div></div>
      <div className="nm-v6-keys" role="radiogroup" aria-label="指標">{healthKeys.map(k => <button type="button" role="radio" aria-checked={keyName === k.value} className={keyName === k.value ? 'active' : ''} key={k.value} onClick={() => setKeyName(k.value)}>{k.label}</button>)}</div>
      {loading ? <div className="nm-v6-bars-empty"><b>記録を読み込んでいます…</b></div> : <HealthBars bars={bars} keyName={keyName} />}
      <p>診察のときは、この画面を獣医師へ見せて「普段との差」と「変化の期間」をお伝えください。</p>
    </div>
    <button type="button" className="nm-v6-btn nm-v6-btn-accent nm-v6-btn-wide" onClick={() => setView('summary')}>獣医師に見せる（直近30日のまとめ）</button>
    <div className="nm-v6-recent">
      <div className="nm-v6-recent-head"><b>最近の記録</b>{petLogs.length > 3 && <button type="button" className="nm-link" onClick={() => setShowAll(v => !v)}>{showAll ? '閉じる' : 'すべて見る'}</button>}</div>
      {recent.length === 0 ? <p className="nm-v6-recent-empty">まだ記録がありません。「今日を記録」から始めましょう。</p> : recent.map(log => <div className="nm-v6-recent-row" key={log.id}><time>{log.logged_on.slice(5).replace('-', '.')}</time><div><b>{recordLine(log)}</b>{log.note && <p>{log.note}</p>}</div></div>)}
    </div>
  </section>;
}

function PhotoForm({ ctx, pets, onDone }: { ctx: Ctx; pets: Pet[]; onDone: () => void }) {
  const [petId, setPetId] = useState(pets[0]?.id || ''); const [caption, setCaption] = useState(''); const [photo, setPhoto] = useState<OptimizedPhoto | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const choose = async (file?: File) => { if (!file) return; setBusy(true); setError(''); try { setPhoto(await optimizePhoto(file)); } catch (e) { setPhoto(null); setError(e instanceof Error ? e.message : '写真を読み込めませんでした'); } finally { setBusy(false); } };
  const submit = async () => { if (!photo || !petId) return; setBusy(true); setError(''); try { await call(ctx, '/api/liff/nen/photos', { method: 'POST', body: JSON.stringify({ petId, caption, mimeType: photo.mimeType, data: photo.data }) }); setPhoto(null); setCaption(''); onDone(); } catch (e) { setError(e instanceof Error ? e.message : '投稿できませんでした'); } finally { setBusy(false); } };
  if (!pets.length) return <Notice>先にマイペットを登録してください。</Notice>;
  return <section className="nm-card nm-photo-card"><div className="nm-section-heading"><span>SHARE YOUR NEN MOMENT</span><h2>うちの子の“おいしい顔”を投稿</h2></div><p className="nm-sub">然を楽しむ表情や、ご家族らしい一枚をお送りください。採用された写真は公式サイトに掲載し、お買い物に使える5マイルをプレゼントします。</p><Field label="ペット"><select value={petId} onChange={e => setPetId(e.target.value)}>{pets.map(p => <option key={p.id} value={p.id}>{p.name}ちゃん</option>)}</select></Field><label className="nm-photo-picker"><input type="file" accept="image/*" onChange={e => void choose(e.target.files?.[0])} />{photo ? <><img src={photo.data} alt="投稿前の確認" /><span><b>{photo.name}</b><small>{Math.ceil(photo.size / 1024).toLocaleString()}KBに最適化済み</small></span></> : <><strong>＋</strong><span><b>{busy ? '写真を最適化しています…' : '写真を選ぶ'}</b><small>iPhoneの大きな写真も自動で軽量化</small></span></>}</label><Field label="写真に添えるひとこと"><textarea value={caption} maxLength={300} placeholder="例：鹿肉ミンチの日は、待ちきれないこの笑顔です。" onChange={e => setCaption(e.target.value)} /></Field>{error && <p className="nm-error">{error}</p>}<button className="nm-primary" disabled={!photo || busy} onClick={() => void submit()}>{busy ? '処理中…' : 'この写真を投稿する'}</button><p className="nm-photo-note">投稿写真は管理者が内容を確認します。採用された写真だけが公開されます。</p></section>;
}

function PhotoCampaign({ photos, sitePhotos, stats }: { photos: MemberPhoto[]; sitePhotos: SiteGalleryPhoto[]; stats: MemberData['photoStats'] }) {
  const reel = [
    ...photos.map(photo => ({ key: `adopted-${photo.id}`, imageUrl: photo.imageUrl, alt: `${photo.petName || 'ペット'}ちゃんの採用写真`, name: `${photo.petName || 'NEN FAMILY'}ちゃん`, caption: photo.caption || 'しあわせなひととき' })),
    ...sitePhotos.filter(site => !photos.some(photo => photo.imageUrl === site.imageUrl)).map((site, index) => ({ key: `site-${index}`, imageUrl: site.imageUrl, alt: site.alt || '公式サイト掲載中のご家族', name: 'NEN FAMILY', caption: '公式サイト掲載中' })),
  ];
  return <>
    <section className="nm-photo-hero"><span>NEN PHOTO PROJECT</span><h2>夢中でぱくぱく、<br/>しあわせ顔をみんなへ。</h2><p>あなたの一枚が、次に然を知るご家族のきっかけになります。</p><div><b>採用1枚につき 5マイル</b><small>ショッピングですぐ使えます</small></div></section>
    <section className="nm-photo-preview" aria-label="公式サイトへの掲載イメージ"><div className="nm-photo-preview-heading"><span>CUSTOMERS &amp; NEN</span><h2>夢中でぱくぱく、しあわせ顔。</h2><p>公式サイトで実際に掲載されている写真です。横へスワイプしてご覧いただけます。</p></div><div className="nm-photo-reel">{reel.length ? reel.map(photo => <figure key={photo.key}><img src={photo.imageUrl} alt={photo.alt} /><figcaption><b>{photo.name}</b><span>{photo.caption}</span></figcaption></figure>) : [1,2,3].map(index => <div className="nm-photo-placeholder" key={index}><i>＋</i><b>次に掲載されるのは<br/>あなたの家族かも</b></div>)}</div><a href="https://stg.nen-petfood.com/#nen-voices-title" target="_blank" rel="noreferrer">実際の掲載場所を見る <span>↗</span></a></section>
    <section className="nm-photo-stats"><div><span>この企画で獲得</span><b>{stats.earnedPoints.toLocaleString()}<small>マイル</small></b></div><div><span>採用された写真</span><b>{stats.adoptedCount}<small>枚</small></b></div><p>{stats.pendingCount > 0 ? `${stats.pendingCount}枚を審査しています。結果が決まり次第、掲載とマイルへ反映します。` : '心が動いた瞬間を、いつでもお待ちしています。'}</p></section>
  </>;
}


const yen = (value: number) => `¥${Math.round(value).toLocaleString()}`;
const man = (value: number) => (value % 10_000 === 0 ? `${value / 10_000}` : (value / 10_000).toFixed(1));

/**
 * メンバーシップシート（★V6 37-2 `lCs4n`）。
 * 弧＝通年（1〜12月の購入額）の進捗、節目の丸＝ランクのしきい値（到達で✓）、中央＝使えるマイルのカウントアップ。
 * 画面を開くと弧は0から現在位置まで、数字は0から現在値まで約1.1秒で動く。
 */
function MembershipSheet({ membership, ownerName }: { membership: Membership; ownerName: string }) {
  const ranks = membership.ranks.length ? membership.ranks : [{ key: 'regular', name: 'レギュラー', thresholdYen: 0, mileRatePercent: 1 }];
  const top = Math.max(1, ranks[ranks.length - 1]!.thresholdYen);
  const rankIndex = Math.max(0, ranks.findIndex(rank => rank.key === membership.rankKey));
  const progress = Math.max(0, Math.min(1, membership.annualMilesYen / top));
  const [drawn, setDrawn] = useState(0);
  useEffect(() => { const frame = requestAnimationFrame(() => setDrawn(progress)); return () => cancelAnimationFrame(frame); }, [progress]);
  const animatedMiles = useAnimatedNumber(membership.mileBalance);
  const point = (fraction: number) => { const angle = Math.PI * (1 - fraction); return { x: 130 + 110 * Math.cos(angle), y: 130 - 110 * Math.sin(angle) }; };
  const gaugeLength = 346;
  const gaugeOffset = gaugeLength * (1 - drawn);
  return <section className="nm-membership-sheet" data-rank={Math.min(3, rankIndex)} aria-label={`${ownerName}さんの会員情報`}>
      <div className="nm-rank-summary"><span className="nm-rank-pill">{membership.rankName}会員</span><small>MEMBERSHIP STATUS</small></div>
      <div className="nm-gauge" aria-label={`使えるマイル ${membership.mileBalance.toLocaleString()}マイル。今年のマイル ${yen(membership.annualMilesYen)}`}>
        <svg viewBox="0 0 260 150" aria-hidden="true">
          <path className="nm-gauge-base" d="M20 130 A110 110 0 0 1 240 130"/>
          <path className="nm-gauge-value" d="M20 130 A110 110 0 0 1 240 130" style={{ strokeDashoffset: gaugeOffset }}/>
          {ranks.map(rank => { const reached = membership.annualMilesYen >= rank.thresholdYen && rankIndex >= ranks.indexOf(rank); const { x, y } = point(rank.thresholdYen / top); return <g className={`nm-gauge-checkpoint ${reached ? 'reached' : ''}`} key={rank.key}><circle cx={x} cy={y} r="16"/><text x={x} y={y + 4} textAnchor="middle">{reached ? '✓' : man(rank.thresholdYen)}</text></g>; })}
        </svg>
        <div className="nm-gauge-number"><strong>{animatedMiles.toLocaleString()}</strong><span>使えるマイル</span></div>
      </div>
      <div className="nm-rank-levels" style={{ gridTemplateColumns: `repeat(${ranks.length}, 1fr)` }}>{ranks.map((rank, index) => <div className={index <= rankIndex ? 'reached' : ''} key={rank.key}><i/><b>{rank.name}</b><span>{rank.thresholdYen === 0 ? '0円〜' : `年${man(rank.thresholdYen)}万円〜`}</span></div>)}</div>
      <div className="nm-member-summary">
        <div><span>通年</span><b>{yen(membership.annualMilesYen)}</b></div>
        <div className="nm-member-next">
          {membership.next
            ? <strong>{membership.next.name}まで あと {yen(membership.next.remainingYen)}</strong>
            : <strong>最高ランクです</strong>}
          {membership.validUntil ? <span>{membership.rankName}は {displayDate(membership.validUntil)} まで維持</span> : null}
        </div>
      </div>
    </section>;
}

function petAge(birthday: string): string {
  const born = new Date(`${birthday}T00:00:00`);
  if (!Number.isFinite(born.getTime())) return '';
  const today = new Date();
  let years = today.getFullYear() - born.getFullYear();
  const beforeBirthday = today.getMonth() < born.getMonth() || (today.getMonth() === born.getMonth() && today.getDate() < born.getDate());
  if (beforeBirthday) years -= 1;
  return years >= 0 ? `${years}歳` : '';
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
  if (!data) return <main className="nm-app"><p>{error || '読み込み中…'}</p></main>;
  const membership: Membership = data.membership ?? { rankKey: null, rankName: data.commerce.rank || 'レギュラー', mileRatePercent: null, annualMilesYen: data.commerce.purchaseAmount, lifetimeMilesYen: data.commerce.purchaseAmount, mileBalance: data.commerce.points, validUntil: null, next: null, ranks: [], milestones: [], nextMilestone: null };
  const tabLabel = tabItems.find(item => item.value === tab)?.label || '';
  const subscriptions = Array.isArray(data.commerce.subscription?.contracts)
    ? data.commerce.subscription.contracts
    : data.commerce.subscription ? [data.commerce.subscription] : [];
  const recentOrders = data.commerce.orders.slice(0, 3);
  return <main className="nm-app">
    {tab === 'home' ? <header className="nm-home-header"><div><h1>マイページ</h1><span>然 -NEN-</span></div><p>{data.owner.displayName || 'お客様'}さん</p></header> : tab === 'pets' ? <header className="nm-home-header"><div><h1>マイペット</h1><span>然 -NEN-</span></div><p>{data.owner.displayName || 'お客様'}さん</p></header> : tab === 'health' ? <header className="nm-home-header"><div><h1>健康日記</h1><span>然 -NEN-</span></div><p>{data.owner.displayName || 'お客様'}さん</p></header> : <header className="nm-page-header"><span>NEN MEMBERS</span><h1>{tabLabel}</h1></header>}
    {tab === 'home' && <section className="nm-stack nm-home-stack">
      <MembershipSheet membership={membership} ownerName={data.owner.displayName || 'お客様'} />
      <div className="nm-card nm-lifetime"><div className="nm-lifetime-row"><span>ライフタイム</span><b>{yen(membership.lifetimeMilesYen)}</b></div><p className="nm-sub">{membership.nextMilestone ? `これまでの累計。あと ${yen(membership.nextMilestone.remainingYen)} で「${membership.nextMilestone.title}」。節目で限定グッズをご用意します` : 'これまでの累計。節目で限定グッズをご用意します'}</p></div>
      <div className="nm-card nm-home-pets"><div className="nm-heading-row"><h2>マイペット</h2><button type="button" className="nm-link" onClick={() => { setTab('pets'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>すべて見る</button></div>{data.pets.length ? data.pets.map(p => <button type="button" className="nm-home-pet-row" onClick={() => { setTab('pets'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} key={p.id}><span className="nm-pet-avatar-frame nm-pet-avatar-small">{p.imageUrl ? <img src={p.imageUrl} alt="" /> : <TabIcon tab="pets" />}</span><span className="nm-pet-text"><b>{p.name}ちゃん</b><span>{[p.animalType === 'cat' ? '猫' : '犬', petAge(p.birthday), p.weightKg ? `${p.weightKg}kg` : ''].filter(Boolean).join('・')}</span><strong>今日の目安 {feedingSummary(p)}{p.feeding?.product ? `（${p.feeding.product.name}）` : p.feeding ? '（主食の登録後にグラム表示）' : '（然の主食）'}</strong></span><i aria-hidden="true">›</i></button>) : <p className="nm-empty-text">まだ登録がありません。</p>}<p className="nm-note">目安は体重・年齢・避妊去勢・運動量から公的な指針（NRC／FEDIAF）の式で計算した参考値です。獣医師の判断に代わるものではありません。</p></div>
      <div className="nm-card nm-home-orders"><div className="nm-heading-row"><h2>最近の注文</h2><button type="button" className="nm-link" onClick={() => { setTab('orders'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>注文・定期を見る</button></div>{recentOrders.length ? <ul className="nm-order-lines">{recentOrders.map((order, index) => <li key={order.id || order.number || index}><span>{displayDate(order.date || order.orderDate).replace(/^\d{4}\//, '')}</span><em>{order.items?.map(item => item.name).filter(Boolean).slice(0, 2).join('、') || `注文 ${order.number || ''}`}</em><b>{typeof order.total === 'number' ? yen(order.total) : ''}</b></li>)}</ul> : <p className="nm-empty-text">まだ注文がありません。</p>}</div>
    </section>}
    {tab === 'pets' && <PetsView ctx={ctx} pets={data.pets} products={data.feedingProducts || []} onChanged={() => void load()} onHealth={() => { setTab('health'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
    {tab === 'health' && <HealthDiary ctx={ctx} pets={data.pets} />}
    {tab === 'orders' && <div className="nm-stack nm-orders-page"><section className="nm-card"><div className="nm-section-heading"><span>SUBSCRIPTION</span><h2>定期便の契約状況</h2></div>{subscriptions.length ? subscriptions.map((subscription: any, contractIndex: number) => <article className="nm-subscription-view" key={subscription.id || subscription.contract_number || contractIndex}><div><span>現在の状況</span><b>{subscription.status || '契約中'}</b></div><div><span>次回お届け</span><b>{displayDate(subscription.nextShippingDate || subscription.next_shipping_date) || '確認中'}</b></div><div><span>お届け周期</span><b>{subscription.cycle || '—'}</b></div>{Array.isArray(subscription.items) && subscription.items.length > 0 && <ul>{subscription.items.map((item: OrderItem, index: number) => <li key={`${item.name}-${index}`}><span>{item.name || '商品'}</span><b>× {item.quantity || 1}</b></li>)}</ul>}<p>変更・スキップ・解約のお手続きはこの画面では行いません。</p></article>) : <p className="nm-empty-text">契約中の定期便はありません。</p>}</section><section className="nm-card"><div className="nm-section-heading"><span>ORDER HISTORY</span><h2>通常購入の履歴</h2></div>{data.commerce.orders.length ? data.commerce.orders.map((order, index) => <article className="nm-order" key={order.id || index}><div className="nm-order-head"><div><b>注文番号 {order.number || index + 1}</b><time>{displayDate(order.date || order.orderDate)}</time></div><strong>¥{Number(order.total || 0).toLocaleString()}</strong></div>{Array.isArray(order.items) && order.items.length > 0 ? <div className="nm-order-items">{order.items.map((item, itemIndex) => { const productUrl = item.product_url || item.productUrl; return <div key={`${item.name}-${itemIndex}`}><span>{item.name || '商品'} <small>× {item.quantity || 1}</small></span>{productUrl && <a href={productUrl} target="_blank" rel="noreferrer">もう一度購入</a>}</div>; })}</div> : <p className="nm-order-no-item">商品情報を確認中です。</p>}{order.detailUrl && <a className="nm-order-detail" href={order.detailUrl} target="_blank" rel="noreferrer">注文内容を見る</a>}</article>) : <p className="nm-empty-text">通常購入の履歴はまだありません。</p>}</section></div>}
    {tab === 'photos' && <div className="nm-stack nm-photo-page"><PhotoCampaign photos={data.photos} sitePhotos={sitePhotos} stats={data.photoStats} /><PhotoForm ctx={ctx} pets={data.pets} onDone={() => void load()} />{data.photos.length > 0 && <section className="nm-adopted-gallery"><div className="nm-list-heading"><span>NEN FAMILY GALLERY</span><h2>みんなの採用写真</h2></div><div className="nm-gallery">{data.photos.map(p => <figure key={p.id}><img src={p.imageUrl} alt={`${p.petName || 'ペット'}ちゃん`} /><figcaption><b>{p.petName || 'ペット'}ちゃん</b>{p.caption && <small>{p.caption}</small>}<span>公式サイト掲載中</span></figcaption></figure>)}</div></section>}</div>}
    <nav className="nm-bottom-nav" aria-label="会員メニュー">{tabItems.map(item => <button className={tab === item.value ? 'active' : ''} onClick={() => { setTab(item.value); window.scrollTo({ top: 0, behavior: 'smooth' }); }} key={item.value}><i><TabIcon tab={item.value} /></i><span>{item.label}</span></button>)}</nav>
  </main>;
}

export function mountNenMember(container: HTMLElement, ctx: Ctx) { root?.unmount(); root = createRoot(container); root.render(<StrictMode><App ctx={ctx} /></StrictMode>); }

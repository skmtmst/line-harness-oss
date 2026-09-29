import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import './styles.css';

type Ctx = { liffId: string; lineUserId: string; idToken: string };
type FeedingProduct = { id: string; name: string; kcalPer100g: number; isDefault?: boolean };
type Venison = { limitPercent: number; kcal: number; grams: number | null; product: FeedingProduct | null };
type Feeding = { dailyKcal: number; dailyGrams: number | null; minGrams: number | null; maxGrams: number | null; rerKcal: number; factor: number; factorLabel: string; stage: string; stageLabel: string; ageMonths: number | null; product: FeedingProduct | null; venison?: Venison };
type Neutered = 'yes' | 'no' | 'unknown';
type Gender = 'male' | 'female' | 'unknown';
type Activity = 'low' | 'normal' | 'high';
type Pet = { id: string; name: string; callName?: string; animalType: string; gender?: Gender | string; breed: string; birthday: string; weightKg: number; concerns: string[]; neutered?: Neutered; activityLevel?: Activity; feedingProductId?: string | null; feeding?: Feeding | null; recommendedDailyMinGrams: number; recommendedDailyMaxGrams: number; venisonDailyGrams: number; foodCycleDays: number; imageUrl?: string | null };
type OrderItem = { name?: string; quantity?: number; product_id?: string | number | null; product_url?: string | null; productUrl?: string | null };
type CommerceOrder = { id?: string; number?: string; date?: string; orderDate?: string; total?: number; detailUrl?: string | null; items?: OrderItem[] };
type SubscriptionContract = { id?: string; contract_number?: string; status?: string; nextShippingDate?: string | null; next_shipping_date?: string | null; cycle?: string | null; items?: OrderItem[]; manageUrl?: string | null; manage_url?: string | null; mypage_subscription_url?: string | null };
type MemberPhoto = {
  id: string;
  imageUrl: string;
  caption: string;
  status: string;
  awardedPoints: number;
  petName?: string;
  publicationConsent?: boolean;
  publicPetName?: boolean;
  createdAt?: string;
};
type Membership = {
  rankKey: string | null; rankName: string; mileRatePercent: number | null;
  annualMilesYen: number; lifetimeMilesYen: number; mileBalance: number; validUntil: string | null;
  next: { name: string; thresholdYen: number; remainingYen: number } | null;
  ranks: Array<{ key: string; name: string; thresholdYen: number; mileRatePercent: number }>;
  milestones: Array<{ thresholdYen: number; title: string; reached: boolean }>;
  nextMilestone: { thresholdYen: number; title: string; remainingYen: number } | null;
};
type MemberData = { owner: { displayName: string | null }; membership?: Membership; pets: Pet[]; feedingProducts?: FeedingProduct[]; nenProducts?: FeedingProduct[]; treatLimitPercent?: number; commerce: { orders: CommerceOrder[]; subscription: any; purchaseCount: number; purchaseAmount: number; points: number; rank: string }; photos: MemberPhoto[]; photoStats: { submittedCount: number; pendingCount: number; adoptedCount: number; earnedPoints: number } };
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
const genderOptions: Array<[Gender, string]> = [['male', '男の子'], ['female', '女の子']];
/** 呼び名：男の子＝くん、女の子＝ちゃん、未回答＝ちゃん（★V6 37-2-A-2）。 */
function petSuffix(gender: unknown): string { return gender === 'male' ? 'くん' : 'ちゃん'; }
function petLabel(pet: { name: string; callName?: string; gender?: string }): string { return pet.callName || (/(くん|ちゃん|さん)$/.test(pet.name) ? pet.name : `${pet.name}${petSuffix(pet.gender)}`); }
/** 犬種・猫種の候補（自由入力＋サジェスト。候補に無ければそのまま登録できる）。 */
const DOG_BREEDS = ['柴犬', '柴犬（豆柴）', 'トイプードル', 'チワワ', 'ミニチュアダックスフンド', 'ポメラニアン', 'ミニチュアシュナウザー', 'フレンチブルドッグ', 'ヨークシャーテリア', 'マルチーズ', 'シーズー', 'パピヨン', 'ジャックラッセルテリア', 'パグ', 'ペキニーズ', 'キャバリア', 'ビーグル', 'ウェルシュコーギー', 'ボストンテリア', 'イタリアングレーハウンド', 'ミニチュアピンシャー', 'ゴールデンレトリバー', 'ラブラドールレトリバー', 'ボーダーコリー', 'シェットランドシープドッグ', '秋田犬', '甲斐犬', '紀州犬', '四国犬', '北海道犬', 'バーニーズマウンテンドッグ', 'シベリアンハスキー', 'サモエド', 'ダルメシアン', 'ドーベルマン', 'ジャーマンシェパード', 'ミックス（雑種）'];
const CAT_BREEDS = ['雑種（ミックス）', 'スコティッシュフォールド', 'マンチカン', 'アメリカンショートヘア', 'ブリティッシュショートヘア', 'ノルウェージャンフォレストキャット', 'ラグドール', 'メインクーン', 'ロシアンブルー', 'ベンガル', 'ペルシャ', 'エキゾチックショートヘア', 'サイベリアン', 'アビシニアン', 'ソマリ', 'シャム', 'ヒマラヤン', 'スフィンクス', 'シンガプーラ', '三毛猫', '黒猫', '白猫', 'キジトラ', 'サバトラ', '茶トラ'];
function breedSuggestions(animalType: string, query: string): string[] {
  const list = animalType === 'cat' ? CAT_BREEDS : DOG_BREEDS;
  const q = query.trim();
  if (!q) return [];
  const hits = list.filter(b => b.includes(q));
  const mix = animalType === 'cat' ? `ミックス（${q}×）` : `ミックス（${q}×）`;
  return [...hits, ...(hits.includes(q) || /ミックス|雑種/.test(q) ? [] : [mix])].slice(0, 5);
}
/** 然の鹿肉（おやつ）の目安：必要カロリー × 上限% ÷ 然商品の kcal/100g × 100。 */
function previewVenison(kcal: number, treat: FeedingProduct | null, limitPercent: number): { kcal: number; grams: number | null } {
  const treatKcal = Math.round(kcal * limitPercent / 100);
  return { kcal: treatKcal, grams: treat ? Math.max(1, Math.round((treatKcal / treat.kcalPer100g) * 100)) : null };
}
function treatFor(products: FeedingProduct[] | undefined): FeedingProduct | null { return products?.find(p => p.isDefault) ?? products?.[0] ?? null; }
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

function PetForm({ ctx, products, nenProducts, treatLimitPercent, onDone, onCancel }: { ctx: Ctx; products: FeedingProduct[]; nenProducts: FeedingProduct[]; treatLimitPercent: number; onDone: () => void; onCancel: () => void }) {
  const emptyForm = { name: '', animalType: 'dog', breed: '', gender: '' as Gender | '', birthday: '', weightKg: '', concerns: [] as string[], neutered: 'unknown' as Neutered, activityLevel: 'normal' as Activity, feedingProductId: '' };
  const [form, setForm] = useState(emptyForm);
  const [photo, setPhoto] = useState<OptimizedPhoto | null>(null); const [cropFile, setCropFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [breedFocus, setBreedFocus] = useState(false);
  const product = products.find(p => p.id === form.feedingProductId) || products.find(p => p.isDefault) || products[0] || null;
  const preview = previewFeeding(form.animalType, Number(form.weightKg), form.birthday, form.neutered, form.activityLevel, product);
  const venison = preview ? previewVenison(preview.kcal, treatFor(nenProducts), treatLimitPercent) : null;
  const suggestions = breedFocus ? breedSuggestions(form.animalType, form.breed) : [];
  const ready = form.name.trim() && form.gender && form.breed.trim() && form.birthday && Number.isFinite(Number(form.weightKg)) && Number(form.weightKg) > 0;
  const submit = async () => { setBusy(true); setError(''); try { await call(ctx, '/api/liff/nen/pets', { method: 'POST', body: JSON.stringify({ ...form, weightKg: Number(form.weightKg), feedingProductId: form.feedingProductId || null, photoData: photo?.data }) }); setForm(emptyForm); onDone(); } catch (e) { setError(e instanceof Error ? e.message : '登録できませんでした'); } finally { setBusy(false); } };
  return <section className="nm-stack nm-home-stack nm-v6-edit nm-v6-register"><button className="nm-back" type="button" onClick={onCancel}>← マイペットへ戻る</button>
    <div className="nm-v6-heading"><span>NEW PET</span><h2>マイペットを登録</h2><p>多頭飼いの場合は、1頭ずつ追加できます。入れた内容から「今日の目安」を計算します。</p></div>
    <label className="nm-v6-photo-pick"><input type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) setCropFile(file); e.target.value = ''; }} /><span className="nm-v6-photo-circle">{photo ? <img src={photo.data} alt="ペット写真の確認" /> : <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>}</span><b>{photo ? '写真を変更' : '写真を登録（任意）'}</b></label>
    <div className="nm-card nm-v6-form">
      <label className="nm-field"><span>ペット名</span><input value={form.name} placeholder="例：豆太郎" onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      <div className="nm-seg-field"><span>性別</span><div className="nm-seg" role="radiogroup" aria-label="性別">{genderOptions.map(([v, l]) => <button type="button" key={v} role="radio" aria-checked={form.gender === v} className={form.gender === v ? 'active' : ''} onClick={() => setForm({ ...form, gender: v })}>{l}</button>)}</div><small className="nm-v6-hint">{form.gender ? `呼び名は「${form.name.trim() || 'お名前'}${petSuffix(form.gender)}」になります` : '呼び名が「くん」「ちゃん」に変わります'}</small></div>
      <Segmented label="種別" value={form.animalType} options={[['dog', 'わんちゃん'], ['cat', 'ねこちゃん']]} onChange={animalType => setForm({ ...form, animalType })} />
      <label className="nm-field nm-v6-breed"><span>犬種・猫種</span><input value={form.breed} placeholder={form.animalType === 'cat' ? '例：スコティッシュフォールド' : '例：柴犬'} onChange={e => setForm({ ...form, breed: e.target.value })} onFocus={() => setBreedFocus(true)} onBlur={() => setTimeout(() => setBreedFocus(false), 150)} />
        {suggestions.length > 0 && <ul className="nm-v6-suggest" role="listbox">{suggestions.map(b => <li key={b} role="option" aria-selected={b === form.breed} className={b === form.breed ? 'active' : ''} onMouseDown={e => { e.preventDefault(); setForm({ ...form, breed: b }); setBreedFocus(false); }}>{b}</li>)}</ul>}
        <small className="nm-v6-hint">入力すると候補が出ます。候補に無ければそのまま入力してください（ミックス・雑種も可）</small></label>
      <label className="nm-field"><span>誕生日</span><input type="date" value={form.birthday} onChange={e => setForm({ ...form, birthday: e.target.value })} /></label>
      <label className="nm-field"><span>体重（kg）</span><input inputMode="decimal" type="number" min="0.2" max="150" step="0.1" placeholder="例：8.4" value={form.weightKg} onChange={e => setForm({ ...form, weightKg: e.target.value })} /></label>
      <Segmented label="避妊・去勢" value={form.neutered} options={neuteredOptions} onChange={neutered => setForm({ ...form, neutered })} />
      <Segmented label="運動量" value={form.activityLevel} options={activityOptions} onChange={activityLevel => setForm({ ...form, activityLevel })} />
      <ProductSelect value={form.feedingProductId} products={products} onChange={feedingProductId => setForm({ ...form, feedingProductId })} />
      <div className="nm-seg-field"><span>現在のお悩み（複数選択可）</span><div className="nm-v6-chip-select">{Object.entries(concernLabels).map(([key, label]) => <button type="button" key={key} aria-pressed={form.concerns.includes(key)} className={form.concerns.includes(key) ? 'active' : ''} onClick={() => setForm({ ...form, concerns: form.concerns.includes(key) ? form.concerns.filter(v => v !== key) : [...form.concerns, key] })}>{label}</button>)}</div></div>
    </div>
    <div className="nm-v6-guide"><div className="nm-v6-guide-row"><div><span>この内容での今日の目安</span><b>{preview ? (preview.grams != null ? <>{preview.grams}<small>g／日（主食）</small></> : <>{preview.kcal}<small>kcal／日</small></>) : '—'}</b></div>{preview?.grams != null && <em>約 {preview.kcal} kcal</em>}</div>
      {venison && <div className="nm-v6-venison"><span>然の鹿肉（おやつ）の目安</span><b>{venison.grams != null ? `${venison.grams}g／日 まで` : `${venison.kcal}kcal／日 まで`}</b></div>}
      {preview ? <p>{preview.formula}。おやつは1日の{treatLimitPercent}%（{venison?.kcal ?? '—'}kcal）まで</p> : <p>体重と誕生日を入れると、目安がここに出ます。</p>}</div>
    {error && <p className="nm-error">{error}</p>}<button className="nm-primary nm-v6-primary" disabled={busy || !ready} onClick={() => void submit()}>{busy ? '登録中…' : '登録する'}</button>
    <p className="nm-note">目安は参考値です。体型や体調で前後します。獣医師の判断に代わるものではありません。</p>
    {cropFile && <PetPhotoCropper file={cropFile} onCancel={() => setCropFile(null)} onDone={value => { setPhoto(value); setCropFile(null); }} />}</section>;
}

/** ★V6 37-2-A 然・マイペット：ペットカード（写真・印・今日の目安・基本情報・操作）。 */
function PetProfileCard({ pet, ctx, products, onEdit, onHealth, onChanged }: { pet: Pet; ctx: Ctx; products: FeedingProduct[]; onEdit: () => void; onHealth: () => void; onChanged: () => void }) {
  const [cropFile, setCropFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const updatePhoto = async (photo: OptimizedPhoto) => { setBusy(true); setError(''); try { await call(ctx, `/api/liff/nen/pets/${pet.id}/photo`, { method: 'POST', body: JSON.stringify({ data: photo.data }) }); setCropFile(null); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : '写真を変更できませんでした'); } finally { setBusy(false); } };
  const f = pet.feeding; const product = productFor(pet, products);
  return <article className="nm-card nm-v6-pet">
    <div className="nm-v6-pet-top"><label className="nm-v6-pet-photo"><input type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) setCropFile(file); e.target.value = ''; }} />{pet.imageUrl ? <img src={pet.imageUrl} alt={petLabel(pet)} /> : <TabIcon tab="pets" />}<i aria-hidden="true">{busy ? '…' : '+'}</i></label>
      <div className="nm-v6-pet-name"><h2>{petLabel(pet)}</h2><p>{petBasics(pet)}</p><div className="nm-v6-chips"><span className="nm-v6-chip">{neuteredChip[pet.neutered || 'unknown']}</span><span className="nm-v6-chip nm-v6-chip-info">{activityChip[pet.activityLevel || 'normal']}</span></div></div></div>
    <div className="nm-v6-guide"><div className="nm-v6-guide-row"><div><span>今日の目安</span><b>{f?.dailyGrams != null ? <>{f.dailyGrams}<small>g／日</small></> : f ? <>{f.dailyKcal}<small>kcal／日</small></> : <>{pet.recommendedDailyMinGrams}〜{pet.recommendedDailyMaxGrams}<small>g／日</small></>}</b></div>{f?.dailyGrams != null && <em>約 {f.dailyKcal} kcal</em>}</div>
      {f?.venison && <div className="nm-v6-venison"><span>然の鹿肉（おやつ）の目安</span><b>{f.venison.grams != null ? `${f.venison.grams}g／日 まで` : `${f.venison.kcal}kcal／日 まで`}</b></div>}
      <p>{f ? `${f.factorLabel} × 体重${pet.weightKg}kg${product ? ` → ${product.name}（${product.kcalPer100g}kcal/100g）で割った量` : '。主食のカロリーが登録されるとグラムで表示されます'}${f.venison ? `。おやつは1日の${f.venison.limitPercent}%まで` : ''}` : '体重と年齢から計算した参考値です。'}</p></div>
    <div className="nm-v6-facts"><div><span>体重</span><b>{pet.weightKg}kg</b></div><div><span>誕生日</span><b>{pet.birthday.replaceAll('-', '.')}</b></div><div><span>いつもの主食</span><b>{product ? product.name : '未設定'}</b></div></div>
    <p className="nm-v6-concerns">お悩み　{pet.concerns.map(v => concernLabels[v] || v).join('・') || '未登録'}</p>
    <div className="nm-v6-actions"><button type="button" className="nm-v6-btn nm-v6-btn-accent" onClick={onEdit}>体重・運動量を変更</button><button type="button" className="nm-v6-btn" onClick={onHealth}>健康日記を見る</button></div>
    {error && <p className="nm-error">{error}</p>}{cropFile && <PetPhotoCropper file={cropFile} onCancel={() => setCropFile(null)} onDone={value => void updatePhoto(value)} />}
  </article>;
}

/** ★V6 37-2-A-1 然・マイペット 変更：体重・避妊去勢・運動量・主食だけ。保存すると「今日の目安」が計算し直される。 */
function PetEditView({ ctx, pet, products, nenProducts, treatLimitPercent, onSaved, onCancel }: { ctx: Ctx; pet: Pet; products: FeedingProduct[]; nenProducts: FeedingProduct[]; treatLimitPercent: number; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ weightKg: String(pet.weightKg ?? ''), neutered: (pet.neutered || 'unknown') as Neutered, activityLevel: (pet.activityLevel || 'normal') as Activity, feedingProductId: pet.feedingProductId || '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const product = products.find(p => p.id === form.feedingProductId) || products.find(p => p.isDefault) || products[0] || null;
  const preview = previewFeeding(pet.animalType, Number(form.weightKg), pet.birthday, form.neutered, form.activityLevel, product);
  const venison = preview ? previewVenison(preview.kcal, treatFor(nenProducts), treatLimitPercent) : null;
  const submit = async () => { setBusy(true); setError(''); try { await call(ctx, `/api/liff/nen/pets/${pet.id}`, { method: 'PUT', body: JSON.stringify({ weightKg: Number(form.weightKg), neutered: form.neutered, activityLevel: form.activityLevel, feedingProductId: form.feedingProductId || null }) }); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : '変更できませんでした'); } finally { setBusy(false); } };
  return <section className="nm-stack nm-home-stack nm-v6-edit"><button className="nm-back" type="button" onClick={onCancel}>← マイペットへ戻る</button>
    <div className="nm-v6-heading"><span>EDIT</span><h2>{petLabel(pet)}の体重・運動量</h2><p>変えると「今日の目安」がその場で計算し直されます。</p></div>
    <div className="nm-card nm-v6-form"><label className="nm-field"><span>体重（kg）</span><input inputMode="decimal" type="number" min="0.2" max="150" step="0.1" value={form.weightKg} onChange={e => setForm({ ...form, weightKg: e.target.value })} /></label>
      <Segmented label="避妊・去勢" value={form.neutered} options={neuteredOptions} onChange={neutered => setForm({ ...form, neutered })} /><Segmented label="運動量" value={form.activityLevel} options={activityOptions} onChange={activityLevel => setForm({ ...form, activityLevel })} /><ProductSelect value={form.feedingProductId} products={products} onChange={feedingProductId => setForm({ ...form, feedingProductId })} /></div>
    <div className="nm-v6-guide"><div className="nm-v6-guide-row"><div><span>この内容での今日の目安</span><b>{preview ? (preview.grams != null ? <>{preview.grams}<small>g／日</small></> : <>{preview.kcal}<small>kcal／日</small></>) : '—'}</b></div>{preview?.grams != null && <em>約 {preview.kcal} kcal</em>}</div>{venison && <div className="nm-v6-venison"><span>然の鹿肉（おやつ）の目安</span><b>{venison.grams != null ? `${venison.grams}g／日 まで` : `${venison.kcal}kcal／日 まで`}</b></div>}{preview && <p>{preview.formula}。おやつは1日の{treatLimitPercent}%まで</p>}</div>
    {error && <p className="nm-error">{error}</p>}<button className="nm-primary nm-v6-primary" disabled={busy || !Number.isFinite(Number(form.weightKg)) || Number(form.weightKg) <= 0} onClick={() => void submit()}>{busy ? '保存中…' : '保存して目安を計算し直す'}</button>
    <p className="nm-note">目安は参考値です。体型や体調で前後します。獣医師の判断に代わるものではありません。</p></section>;
}

/** ★V6 37-2-A 然・マイペット：見出し行（登録する）→ ペットカード → 注記。 */
function PetsView({ ctx, pets, products, nenProducts, treatLimitPercent, onChanged, onHealth }: { ctx: Ctx; pets: Pet[]; products: FeedingProduct[]; nenProducts: FeedingProduct[]; treatLimitPercent: number; onChanged: () => void; onHealth: () => void }) {
  const [registering, setRegistering] = useState(false); const [editingId, setEditingId] = useState<string | null>(null);
  const editing = pets.find(p => p.id === editingId);
  if (registering) return <PetForm ctx={ctx} products={products} nenProducts={nenProducts} treatLimitPercent={treatLimitPercent} onCancel={() => setRegistering(false)} onDone={() => { setRegistering(false); onChanged(); }} />;
  if (editing) return <PetEditView ctx={ctx} pet={editing} products={products} nenProducts={nenProducts} treatLimitPercent={treatLimitPercent} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); onChanged(); }} />;
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

const stoolOptions: Array<[string, string]> = [['normal', '正常'], ['soft', 'やわらかい'], ['hard', 'かたい'], ['diarrhea', '下痢'], ['bloody', '血が混じる'], ['other', 'その他']];
const appetiteOptions: Array<[string, string]> = [['good', '良好'], ['normal', '普通'], ['poor', '不良']];
const skinOptions: Array<[string, string]> = [['normal', '問題なし'], ['itchy', 'かゆそう'], ['red', '赤み'], ['other', 'その他']];
const tearOptions: Array<[string, string]> = [['normal', '問題なし'], ['mild', '少し気になる'], ['concern', '気になる']];
function ChoiceGrid({ label, value, options, columns, onChange }: { label: string; value: string; options: Array<[string, string]>; columns: number; onChange: (v: string) => void }) {
  return <div className="nm-seg-field"><span>{label}</span><div className="nm-v6-choice" role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>{options.map(([v, l]) => <button type="button" key={v} role="radio" aria-checked={value === v} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>{l}</button>)}</div></div>;
}
function shiftDate(iso: string, days: number): string { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function longDate(iso: string): string { const d = new Date(`${iso}T00:00:00`); if (Number.isNaN(d.getTime())) return iso; return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）`; }

/** ★V6 37-2-B-1 今日を記録：記録日（‹ 今日 ›）、からだの数値3列、便・食いつき・皮膚・涙やけはタップで選ぶ、メモ。 */
function HealthForm({ ctx, pet, lastLog, onSaved }: { ctx: Ctx; pet: Pet; lastLog: HealthLog | null; onSaved: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ petId: pet.id, loggedOn: today, weightKg: '', heartRateBpm: '', respiratoryRateBpm: '', stoolStatus: 'normal', appetite: 'normal', skinStatus: 'normal', tearStainStatus: 'normal', note: '' });
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(value => ({ ...value, petId: pet.id })); setMessage(''); }, [pet.id]);
  const submit = async () => { setBusy(true); setMessage(''); try { const res = await call<{ data: { careRequired: boolean } }>(ctx, '/api/liff/nen/health-logs', { method: 'POST', body: JSON.stringify(form) }); setMessage(res.data.careRequired ? '記録しました。気になる状態が続いているため、管理画面に要ケアとして共有しました。' : '今日の健康記録を保存しました。'); onSaved(); } catch (error) { setMessage(error instanceof Error ? error.message : '記録できませんでした'); } finally { setBusy(false); } };
  const prev = lastLog ? [lastLog.weight_kg == null ? null : `${Number(lastLog.weight_kg).toFixed(1)}kg`, lastLog.heart_rate_bpm == null ? null : `${lastLog.heart_rate_bpm}回`, lastLog.respiratory_rate_bpm == null ? null : `${lastLog.respiratory_rate_bpm}回`].filter(Boolean).join('・') : '';
  const isToday = form.loggedOn === today;
  return <section className="nm-card nm-v6-form nm-v6-record">
    <div className="nm-seg-field"><span>記録日</span><div className="nm-v6-date"><button type="button" aria-label="前の日" onClick={() => setForm({ ...form, loggedOn: shiftDate(form.loggedOn, -1) })}>‹</button><div><b>{longDate(form.loggedOn)}</b>{isToday && <em>今日</em>}</div><button type="button" aria-label="次の日" disabled={isToday} onClick={() => setForm({ ...form, loggedOn: shiftDate(form.loggedOn, 1) })}>›</button></div></div>
    <div className="nm-seg-field"><div className="nm-v6-label-row"><span>からだの数値</span>{prev && <small>前回：{prev}</small>}</div><div className="nm-v6-vital-inputs">
      <label><span>体重</span><div><input inputMode="decimal" type="number" min="0.2" max="150" step="0.1" placeholder="—" value={form.weightKg} onChange={e => setForm({ ...form, weightKg: e.target.value })} /><small>kg</small></div></label>
      <label><span>心拍</span><div><input inputMode="numeric" type="number" min="20" max="300" step="1" placeholder="—" value={form.heartRateBpm} onChange={e => setForm({ ...form, heartRateBpm: e.target.value })} /><small>回/分</small></div></label>
      <label><span>呼吸</span><div><input inputMode="numeric" type="number" min="5" max="150" step="1" placeholder="—" value={form.respiratoryRateBpm} onChange={e => setForm({ ...form, respiratoryRateBpm: e.target.value })} /><small>回/分</small></div></label>
    </div></div>
    <ChoiceGrid label="便" value={form.stoolStatus} options={stoolOptions} columns={3} onChange={stoolStatus => setForm({ ...form, stoolStatus })} />
    <ChoiceGrid label="食いつき" value={form.appetite} options={appetiteOptions} columns={3} onChange={appetite => setForm({ ...form, appetite })} />
    <ChoiceGrid label="皮膚" value={form.skinStatus} options={skinOptions} columns={4} onChange={skinStatus => setForm({ ...form, skinStatus })} />
    <ChoiceGrid label="涙やけ" value={form.tearStainStatus} options={tearOptions} columns={3} onChange={tearStainStatus => setForm({ ...form, tearStainStatus })} />
    <label className="nm-field"><div className="nm-v6-label-row"><span>その日の様子・獣医師に伝えたいこと</span><small>任意</small></div><textarea rows={3} placeholder="食事、運動、投薬、気になった変化など" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
    {message && <Notice>{message}</Notice>}<button className="nm-primary nm-v6-primary" disabled={busy} onClick={() => void submit()}>{busy ? '保存中…' : '今日の記録を保存'}</button></section>;
}

function MeasureGuide() {
  return <section className="nm-measure-guide nm-v6-measure"><div className="nm-measure-item"><i>01</i><div><h3>体重</h3><p>ペットを抱いて体重計に乗り、表示された重さから飼い主さま自身の体重を差し引きます。毎回できるだけ同じ時間・同じ条件で測ると変化を比べやすくなります。</p></div></div><div className="nm-measure-item"><i>02</i><div><h3>心拍数</h3><p>落ち着いている時に胸のあたりへそっと手を当て、15秒間の拍動数を数えて4倍します。家庭での参考目安は大型犬60〜80回、小型犬80〜120回、猫130〜160回/分ですが、年齢・体格・緊張などで変わります。</p></div></div><div className="nm-measure-item"><i>03</i><div><h3>呼吸数</h3><p>眠っている時や安静時に胸・お腹の上下を見て、「吸って吐く」を1回として15秒間数え、4倍します。20〜30回/分をひとつの参考にし、パンティング中や猫が喉を鳴らしている時は避けましょう。</p></div></div></section>;
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
    <div className="nm-v6-heading"><span>FOR YOUR VET</span><h2>直近30日のまとめ</h2><p>{petLabel(pet)}（{petBasics(pet)}）。診察のときに獣医師へそのままお見せください。</p></div>
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
  if (view === 'record') return <section className="nm-stack nm-home-stack nm-v6-edit nm-v6-record-page"><button className="nm-back" type="button" onClick={() => setView('diary')}>← 健康日記へ戻る</button>
    <div className="nm-v6-heading-row"><div className="nm-v6-heading"><span>DAILY RECORD</span><h2>{petLabel(pet)}の今日を記録</h2></div>{pets.length > 1 && <select className="nm-v6-pet-select" aria-label="記録するペット" value={pet.id} onChange={e => setPetId(e.target.value)}>{pets.map(item => <option key={item.id} value={item.id}>{petLabel(item)}</option>)}</select>}</div>
    <p className="nm-v6-lead">空欄のままでも保存できます。毎日同じ条件で測ると、変化に気づきやすくなります。</p>
    <HealthForm ctx={ctx} pet={pet} lastLog={petLogs[0] ?? null} onSaved={() => { void loadLogs(); setView('diary'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
    <details className="nm-v6-details"><summary>おうちでの測り方（体重・心拍・呼吸）</summary><MeasureGuide /></details>
    <p className="nm-note">数値だけで病気を判断するものではありません。普段と違う状態が続く、呼吸が苦しそう、ぐったりしているときは、記録を待たず獣医師へご相談ください。</p></section>;
  if (view === 'summary') return <HealthSummaryView ctx={ctx} pet={pet} onBack={() => setView('diary')} />;
  const latestWeight = petLogs.find(log => log.weight_kg != null)?.weight_kg; const latestHeart = petLogs.find(log => log.heart_rate_bpm != null)?.heart_rate_bpm; const latestResp = petLogs.find(log => log.respiratory_rate_bpm != null)?.respiratory_rate_bpm;
  const bars = healthBars(petLogs, keyName, period); const keyMeta = healthKeys.find(k => k.value === keyName)!;
  const recent = showAll ? petLogs.slice(0, 30) : petLogs.slice(0, 3);
  return <section className="nm-stack nm-home-stack nm-v6-health">
    <div className="nm-v6-heading-row"><div className="nm-v6-heading"><span>HEALTH DIARY</span><h2>健康日記</h2></div><button type="button" className="nm-v6-add" onClick={() => setView('record')}>＋ 今日を記録</button></div>
    {pets.length > 1 && <div className="nm-v6-pet-switch" role="tablist" aria-label="記録を見るペット">{pets.map(item => <button type="button" role="tab" aria-selected={item.id === pet.id} className={item.id === pet.id ? 'active' : ''} key={item.id} onClick={() => setPetId(item.id)}><i>{item.imageUrl ? <img src={item.imageUrl} alt="" /> : null}</i>{petLabel(item)}</button>)}</div>}
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
  return <section className="nm-photo-form-card">
    <div className="nm-photo-section-title"><h2>写真を投稿する</h2><span>すべて必須</span></div>
    <label className="nm-photo-field"><span>ペットを選ぶ</span><select value={petId} onChange={e => setPetId(e.target.value)}>{pets.map(p => <option key={p.id} value={p.id}>{petLabel(p)}</option>)}</select></label>
    <div className="nm-photo-upload">
      <div className="nm-photo-label-row"><b>写真を選ぶ</b><small>選択後にプレビューします</small></div>
      {photo ? <div className="nm-photo-selected"><div className="nm-photo-preview-frame"><img src={photo.data} alt="投稿前の写真プレビュー" /></div><div className="nm-photo-selected-actions"><strong>✓ 写真を選択しました</strong><label><input type="file" accept="image/*" onChange={e => void choose(e.target.files?.[0])} />↻ 選び直す</label></div></div> : <label className="nm-photo-picker-v6"><input type="file" accept="image/*" onChange={e => void choose(e.target.files?.[0])} /><strong aria-hidden="true">＋</strong><span>{busy ? '写真を読み込んでいます…' : '写真を選ぶ'}</span><small>縦長の写真も全体を確認できます</small></label>}
    </div>
    <label className="nm-photo-field"><span>ひとこと <small>300字まで</small></span><textarea value={caption} maxLength={300} placeholder="鹿肉ミンチの日は、待ちきれないこの笑顔です。" onChange={e => setCaption(e.target.value)} /><em>{caption.length} / 300</em></label>
    {error && <p className="nm-error" role="alert">{error}</p>}
    <button type="button" className="nm-photo-submit" disabled={!photo || busy} onClick={() => void submit()}><span aria-hidden="true">➤</span>{busy ? '処理中…' : 'この写真を投稿する'}</button>
    <p className="nm-photo-note">投稿写真は運営が内容を確認します。採用された写真だけが公開されます</p>
  </section>;
}

type PhotoViewStatus = 'pending' | 'adopted' | 'rejected';
function photoViewStatus(status: string): PhotoViewStatus {
  if (status === 'adopted') return 'adopted';
  if (status === 'rejected') return 'rejected';
  return 'pending';
}
const photoStatusLabel: Record<PhotoViewStatus, string> = { pending: '審査中', adopted: '採用', rejected: '見送り' };
function photoPetLabel(photo: MemberPhoto): string {
  const name = photo.petName || 'ペット';
  return /(くん|ちゃん|さん)$/.test(name) ? name : `${name}ちゃん`;
}

function PhotoConsent({ ctx, photo, onDone }: { ctx: Ctx; photo: MemberPhoto; onDone: () => void }) {
  const [showPetName, setShowPetName] = useState(photo.publicPetName === true);
  const [confirmWithdrawal, setConfirmWithdrawal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setShowPetName(photo.publicPetName === true); }, [photo.publicPetName]);
  const update = async (consent: boolean, nextShowPetName = showPetName) => {
    setBusy(true); setError('');
    try {
      await call(ctx, `/api/liff/nen/photos/${encodeURIComponent(photo.id)}/publication-consent`, {
        method: 'PUT',
        body: JSON.stringify(consent ? { consent: true, consentVersion: 'photo-public-v1', showPetName: nextShowPetName } : { consent: false }),
      });
      setConfirmWithdrawal(false); onDone();
    } catch (e) { setError(e instanceof Error ? e.message : '掲載設定を変更できませんでした'); }
    finally { setBusy(false); }
  };
  const changePetName = (next: boolean) => { setShowPetName(next); if (photo.publicationConsent) void update(true, next); };
  return <div className="nm-photo-consent">
    <label className="nm-photo-consent-check"><input type="checkbox" checked={photo.publicationConsent === true} disabled={busy} onChange={e => e.target.checked ? void update(true) : setConfirmWithdrawal(true)} /><span aria-hidden="true">✓</span><b>サイトへの掲載に同意する</b></label>
    <fieldset disabled={busy}><legend>ペット名の表示</legend><label><input type="radio" name={`pet-name-${photo.id}`} checked={showPetName} onChange={() => changePetName(true)} />ペット名を出す</label><label><input type="radio" name={`pet-name-${photo.id}`} checked={!showPetName} onChange={() => changePetName(false)} />出さない</label></fieldset>
    {!photo.publicationConsent && <p>同意していない写真は公式サイトに掲載されません</p>}
    {error && <p className="nm-error" role="alert">{error}</p>}
    {confirmWithdrawal && <div className="nm-photo-dialog-backdrop" role="presentation"><div className="nm-photo-dialog" role="dialog" aria-modal="true" aria-labelledby={`withdraw-${photo.id}`}><h3 id={`withdraw-${photo.id}`}>掲載を取り下げますか？</h3><p>公式サイトからこの写真を取り下げます。もう一度同意すれば、掲載候補に戻せます。</p><div><button type="button" disabled={busy} onClick={() => setConfirmWithdrawal(false)}>キャンセル</button><button type="button" disabled={busy} onClick={() => void update(false)}>{busy ? '処理中…' : '取り下げる'}</button></div></div></div>}
  </div>;
}

function PhotoList({ ctx, photos, onDone }: { ctx: Ctx; photos: MemberPhoto[]; onDone: () => void }) {
  return <section className="nm-photo-own-list">
    <div className="nm-photo-list-heading"><h2>自分の投稿</h2><span>{photos.length}件</span></div>
    {photos.length === 0 ? <div className="nm-photo-empty"><span aria-hidden="true">▧</span><b>まだ投稿がありません</b><p>お気に入りの一枚を投稿すると、ここに審査状況が表示されます。</p></div> : photos.map(photo => {
      const status = photoViewStatus(photo.status);
      return <article className="nm-photo-entry" key={photo.id}>
        <div className="nm-photo-entry-main"><div className="nm-photo-entry-image"><img src={photo.imageUrl} alt={`${photoPetLabel(photo)}の投稿写真`} /></div><div className="nm-photo-entry-copy"><div><span className={`nm-photo-status nm-photo-status-${status}`}>{photoStatusLabel[status]}</span><time>{displayDate(photo.createdAt).replace(/^\d{4}\//, '')}</time></div><b>{photoPetLabel(photo)}</b>{status === 'pending' && <p>運営が内容を確認しています。</p>}{status === 'adopted' && <div className="nm-photo-adopted-copy">{photo.publicationConsent && <strong>公式サイトに掲載中</strong>}<em>5マイル付与</em></div>}{status === 'rejected' && <p>この投稿は公開されません。</p>}</div></div>
        {status === 'adopted' && <PhotoConsent ctx={ctx} photo={photo} onDone={onDone} />}
      </article>;
    })}
  </section>;
}

function PhotosView({ ctx, data, onDone }: { ctx: Ctx; data: MemberData; onDone: () => void }) {
  return <section className="nm-stack nm-home-stack nm-photo-page-v6" data-design-node="pNuzE">
    <div className="nm-photo-intro"><span aria-hidden="true">▣</span><div><h2>うちの子の一枚を投稿</h2><p>採用された写真には 5マイルをプレゼント</p></div><p>投稿後は運営が内容を確認します。状態はこの画面でいつでも確認できます。</p></div>
    <PhotoForm ctx={ctx} pets={data.pets} onDone={onDone} />
    <PhotoList ctx={ctx} photos={data.photos} onDone={onDone} />
  </section>;
}

function OrdersView({ data, subscriptions }: { data: MemberData; subscriptions: SubscriptionContract[] }) {
  return <section className="nm-stack nm-home-stack nm-orders-page-v6" data-design-node="sBTL8">
    <div className="nm-order-intro"><span aria-hidden="true">▤</span><div><h2>お届けと購入履歴をまとめて確認</h2><p>定期便と通常購入をひとつの画面で確認できます</p></div><p>ホームの「最近の注文」から開いた注文も、こちらにまとまっています。</p></div>
    <section className="nm-order-section" aria-labelledby="subscription-heading">
      <div className="nm-order-section-heading"><div><span>SUBSCRIPTION</span><h2 id="subscription-heading">定期便の契約状況</h2></div><small>{subscriptions.length}件</small></div>
      {subscriptions.length ? subscriptions.map((subscription, contractIndex) => {
        const manageUrl = subscription.mypage_subscription_url || subscription.manage_url || subscription.manageUrl;
        return <article className="nm-subscription-card" key={subscription.id || subscription.contract_number || contractIndex}>
          <div className="nm-subscription-status"><span>現在の状況</span><b>{subscription.status || '契約中'}</b></div>
          <dl className="nm-subscription-facts"><div><dt>次回お届け</dt><dd>{displayDate(subscription.nextShippingDate || subscription.next_shipping_date) || '確認中'}</dd></div><div><dt>お届け周期</dt><dd>{subscription.cycle || '確認中'}</dd></div></dl>
          {Array.isArray(subscription.items) && subscription.items.length > 0 ? <ul className="nm-subscription-items">{subscription.items.map((item, index) => <li key={`${item.name}-${index}`}><span>{item.name || '商品'}</span><b>× {item.quantity || 1}</b></li>)}</ul> : <p className="nm-order-item-pending">商品情報を確認中です。</p>}
          <p className="nm-order-guidance">変更・スキップ・解約はこの画面では行いません。お手続きはECのマイページからお願いします。</p>
          {manageUrl && <a className="nm-order-primary-link" href={manageUrl} target="_blank" rel="noreferrer">ECのマイページへ<span aria-hidden="true">›</span></a>}
        </article>;
      }) : <div className="nm-order-empty"><span aria-hidden="true">○</span><b>契約中の定期便はありません</b><p>定期便を始めると、次回のお届け予定がここに表示されます。</p></div>}
    </section>
    <section className="nm-order-section" aria-labelledby="order-history-heading">
      <div className="nm-order-section-heading"><div><span>ORDER HISTORY</span><h2 id="order-history-heading">通常購入の履歴</h2></div><small>{data.commerce.orders.length}件</small></div>
      {data.commerce.orders.length ? data.commerce.orders.map((order, index) => <article className="nm-order-card" key={order.id || order.number || index}>
        <div className="nm-order-card-head"><div><b>注文番号 {order.number || index + 1}</b><time>{displayDate(order.date || order.orderDate)}</time></div><strong>{yen(Number(order.total || 0))}</strong></div>
        {Array.isArray(order.items) && order.items.length > 0 ? <div className="nm-order-card-items">{order.items.map((item, itemIndex) => { const productUrl = item.product_url || item.productUrl; return <div key={`${item.name}-${itemIndex}`}><span>{item.name || '商品'} <small>× {item.quantity || 1}</small></span>{productUrl && <a href={productUrl} target="_blank" rel="noreferrer">もう一度購入</a>}</div>; })}</div> : <p className="nm-order-item-pending">商品情報を確認中です。</p>}
        {order.detailUrl && <a className="nm-order-detail-link" href={order.detailUrl} target="_blank" rel="noreferrer">注文内容を見る<span aria-hidden="true">›</span></a>}
      </article>) : <div className="nm-order-empty"><span aria-hidden="true">▤</span><b>通常購入の履歴はまだありません</b><p>商品を購入すると、注文内容がここに表示されます。</p></div>}
    </section>
  </section>;
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
  const [tab, setTab] = useState<Tab>(['home','pets','health','orders','photos'].includes(initialTab || '') ? initialTab! : 'home'); const [data, setData] = useState<MemberData | null>(null); const [error, setError] = useState('');
  const load = useCallback(async () => { try { const r = await call<{ data: MemberData }>(ctx, '/api/liff/nen/member'); setData(r.data); } catch (e) { setError(e instanceof Error ? e.message : '読み込めませんでした'); } }, [ctx]);
  useEffect(() => { void load(); }, [load]);
  if (!data) return <main className="nm-app"><p>{error || '読み込み中…'}</p></main>;
  const membership: Membership = data.membership ?? { rankKey: null, rankName: data.commerce.rank || 'レギュラー', mileRatePercent: null, annualMilesYen: data.commerce.purchaseAmount, lifetimeMilesYen: data.commerce.purchaseAmount, mileBalance: data.commerce.points, validUntil: null, next: null, ranks: [], milestones: [], nextMilestone: null };
  const tabLabel = tabItems.find(item => item.value === tab)?.label || '';
  const subscriptions: SubscriptionContract[] = Array.isArray(data.commerce.subscription?.contracts)
    ? data.commerce.subscription.contracts
    : data.commerce.subscription ? [data.commerce.subscription] : [];
  const recentOrders = data.commerce.orders.slice(0, 3);
  return <main className="nm-app">
    {tab === 'home' ? <header className="nm-home-header"><div><h1>マイページ</h1><span>然 -NEN-</span></div><p>{data.owner.displayName || 'お客様'}さん</p></header> : tab === 'pets' ? <header className="nm-home-header"><div><h1>マイペット</h1><span>然 -NEN-</span></div><p>{data.owner.displayName || 'お客様'}さん</p></header> : tab === 'health' ? <header className="nm-home-header"><div><h1>健康日記</h1><span>然 -NEN-</span></div><p>{data.owner.displayName || 'お客様'}さん</p></header> : tab === 'orders' ? <header className="nm-home-header"><div><h1>注文・定期</h1><span>然 -NEN-</span></div><p>{data.owner.displayName || 'お客様'}さん</p></header> : tab === 'photos' ? <header className="nm-home-header"><div><h1>投稿</h1><span>然 -NEN-</span></div><p>{data.owner.displayName || 'お客様'}さん</p></header> : <header className="nm-page-header"><span>NEN MEMBERS</span><h1>{tabLabel}</h1></header>}
    {tab === 'home' && <section className="nm-stack nm-home-stack">
      <MembershipSheet membership={membership} ownerName={data.owner.displayName || 'お客様'} />
      <div className="nm-card nm-lifetime"><div className="nm-lifetime-row"><span>ライフタイム</span><b>{yen(membership.lifetimeMilesYen)}</b></div><p className="nm-sub">{membership.nextMilestone ? `これまでの累計。あと ${yen(membership.nextMilestone.remainingYen)} で「${membership.nextMilestone.title}」。節目で限定グッズをご用意します` : 'これまでの累計。節目で限定グッズをご用意します'}</p></div>
      <div className="nm-card nm-home-pets"><div className="nm-heading-row"><h2>マイペット</h2><button type="button" className="nm-link" onClick={() => { setTab('pets'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>すべて見る</button></div>{data.pets.length ? data.pets.map(p => <button type="button" className="nm-home-pet-row" onClick={() => { setTab('pets'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} key={p.id}><span className="nm-pet-avatar-frame nm-pet-avatar-small">{p.imageUrl ? <img src={p.imageUrl} alt="" /> : <TabIcon tab="pets" />}</span><span className="nm-pet-text"><b>{petLabel(p)}</b><span>{[p.animalType === 'cat' ? '猫' : '犬', petAge(p.birthday), p.weightKg ? `${p.weightKg}kg` : ''].filter(Boolean).join('・')}</span><strong>今日の目安 {feedingSummary(p)}{p.feeding?.product ? `（${p.feeding.product.name}）` : p.feeding ? '（主食の登録後にグラム表示）' : '（然の主食）'}</strong></span><i aria-hidden="true">›</i></button>) : <p className="nm-empty-text">まだ登録がありません。</p>}<p className="nm-note">目安は体重・年齢・避妊去勢・運動量から公的な指針（NRC／FEDIAF）の式で計算した参考値です。獣医師の判断に代わるものではありません。</p></div>
      <div className="nm-card nm-home-orders"><div className="nm-heading-row"><h2>最近の注文</h2><button type="button" className="nm-link" onClick={() => { setTab('orders'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>注文・定期を見る</button></div>{recentOrders.length ? <ul className="nm-order-lines">{recentOrders.map((order, index) => <li key={order.id || order.number || index}><span>{displayDate(order.date || order.orderDate).replace(/^\d{4}\//, '')}</span><em>{order.items?.map(item => item.name).filter(Boolean).slice(0, 2).join('、') || `注文 ${order.number || ''}`}</em><b>{typeof order.total === 'number' ? yen(order.total) : ''}</b></li>)}</ul> : <p className="nm-empty-text">まだ注文がありません。</p>}</div>
    </section>}
    {tab === 'pets' && <PetsView ctx={ctx} pets={data.pets} products={data.feedingProducts || []} nenProducts={data.nenProducts || []} treatLimitPercent={data.treatLimitPercent ?? 10} onChanged={() => void load()} onHealth={() => { setTab('health'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
    {tab === 'health' && <HealthDiary ctx={ctx} pets={data.pets} />}
    {tab === 'orders' && <OrdersView data={data} subscriptions={subscriptions} />}
    {tab === 'photos' && <PhotosView ctx={ctx} data={data} onDone={() => void load()} />}
    <nav className="nm-bottom-nav" aria-label="会員メニュー">{tabItems.map(item => <button className={tab === item.value ? 'active' : ''} onClick={() => { setTab(item.value); window.scrollTo({ top: 0, behavior: 'smooth' }); }} key={item.value}><i><TabIcon tab={item.value} /></i><span>{item.label}</span></button>)}</nav>
  </main>;
}

export function mountNenMember(container: HTMLElement, ctx: Ctx) { root?.unmount(); root = createRoot(container); root.render(<StrictMode><App ctx={ctx} /></StrictMode>); }

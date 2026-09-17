/**
 * 然-NEN- 健康日記の管理画面（★V6 37-4）：記録から「変化」に気づくための計算。
 *
 * 記録はお客様がマイページで付ける（体重・心拍・呼吸・便・食いつき・皮膚・涙やけ・メモ）。
 * ここでは医療判断はせず、次の 3 つを「気になる変化」として印を付けるだけ：
 *  - 体重が 8 週間で ±10% 以上変わった
 *  - 便の異常（下痢・血が混じる）が 3 回続いた
 *  - 食いつき「不良」が 3 回続いた
 * それとは別に「30 日以上 記録なし」を続けるきっかけ（配信）の対象として数える。
 */

export type HealthLogRow = {
  pet_id: string;
  logged_on: string;
  weight_kg: number | null;
  stool_status: string;
  appetite: string;
  skin_status?: string | null;
  tear_stain_status?: string | null;
  heart_rate_bpm?: number | null;
  respiratory_rate_bpm?: number | null;
  note?: string | null;
};

export type HealthChange = {
  key: 'weight_drop' | 'weight_gain' | 'stool_abnormal' | 'appetite_poor' | 'silent';
  label: string;
  tone: 'warn' | 'faint';
};

export type PetHealthSummary = {
  lastLoggedOn: string | null;
  daysSinceLast: number | null;
  count30d: number;
  /** 直近 8 週の週平均体重（古い → 新しい）。記録が無い週は null。 */
  weightSeries: Array<number | null>;
  latestWeightKg: number | null;
  weightChangePercent: number | null;
  latestStool: string | null;
  latestAppetite: string | null;
  changes: HealthChange[];
};

export const STOOL_LABELS: Record<string, string> = { normal: '正常', soft: 'やわらかい', hard: 'かたい', diarrhea: '下痢', bloody: '血が混じる', other: 'その他' };
export const APPETITE_LABELS: Record<string, string> = { good: '良好', normal: '普通', poor: '不良' };
export const SKIN_LABELS: Record<string, string> = { normal: '問題なし', itchy: 'かゆそう', red: '赤み', other: 'その他' };
export const TEAR_LABELS: Record<string, string> = { normal: '問題なし', mild: '少し気になる', concern: '気になる' };

const ABNORMAL_STOOL = new Set(['diarrhea', 'bloody']);
export const WEIGHT_CHANGE_THRESHOLD_PERCENT = 10;
export const CONSECUTIVE_ABNORMAL = 3;
export const SILENT_DAYS = 30;
export const WEEKS = 8;

function dayIndex(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/**
 * 1 頭分の記録（logged_on 昇順でも降順でも可）から要約を作る。
 */
export function summarizePetHealth(logs: HealthLogRow[], today: Date): PetHealthSummary {
  const sorted = [...logs]
    .filter((log) => /^\d{4}-\d{2}-\d{2}$/.test(log.logged_on))
    .sort((a, b) => (a.logged_on < b.logged_on ? -1 : a.logged_on > b.logged_on ? 1 : 0));
  const todayIdx = Math.floor(today.getTime() / 86_400_000);
  const last = sorted[sorted.length - 1] ?? null;
  const daysSinceLast = last ? todayIdx - dayIndex(last.logged_on) : null;
  const count30d = sorted.filter((log) => todayIdx - dayIndex(log.logged_on) < 30).length;

  // 週平均体重（8 週）。今日を含む週を最後の枠にする。
  const buckets: Array<number[]> = Array.from({ length: WEEKS }, () => []);
  for (const log of sorted) {
    if (log.weight_kg == null || !Number.isFinite(Number(log.weight_kg))) continue;
    const weeksAgo = Math.floor((todayIdx - dayIndex(log.logged_on)) / 7);
    if (weeksAgo < 0 || weeksAgo >= WEEKS) continue;
    buckets[WEEKS - 1 - weeksAgo].push(Number(log.weight_kg));
  }
  const weightSeries = buckets.map((values) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null));
  const known = weightSeries.filter((v): v is number => v != null);
  const weightChangePercent = known.length >= 2 && known[0] > 0 ? Math.round(((known[known.length - 1] - known[0]) / known[0]) * 1000) / 10 : null;
  const latestWeight = [...sorted].reverse().find((log) => log.weight_kg != null)?.weight_kg ?? null;

  const changes: HealthChange[] = [];
  if (weightChangePercent != null && Math.abs(weightChangePercent) >= WEIGHT_CHANGE_THRESHOLD_PERCENT) {
    changes.push(weightChangePercent < 0
      ? { key: 'weight_drop', label: `体重 −${Math.abs(weightChangePercent)}%（8週）`, tone: 'warn' }
      : { key: 'weight_gain', label: `体重 +${weightChangePercent}%（8週）`, tone: 'warn' });
  }
  const recent = sorted.slice(-CONSECUTIVE_ABNORMAL);
  if (recent.length === CONSECUTIVE_ABNORMAL && recent.every((log) => ABNORMAL_STOOL.has(log.stool_status))) {
    changes.push({ key: 'stool_abnormal', label: `便の異常が${CONSECUTIVE_ABNORMAL}回続く`, tone: 'warn' });
  }
  if (recent.length === CONSECUTIVE_ABNORMAL && recent.every((log) => log.appetite === 'poor')) {
    changes.push({ key: 'appetite_poor', label: `食いつき不良が${CONSECUTIVE_ABNORMAL}回続く`, tone: 'warn' });
  }
  if (daysSinceLast != null && daysSinceLast >= SILENT_DAYS) {
    changes.push({ key: 'silent', label: `${SILENT_DAYS}日以上 記録なし`, tone: 'faint' });
  }

  return {
    lastLoggedOn: last?.logged_on ?? null,
    daysSinceLast,
    count30d,
    weightSeries,
    latestWeightKg: latestWeight == null ? null : Number(latestWeight),
    weightChangePercent,
    latestStool: last?.stool_status ?? null,
    latestAppetite: last?.appetite ?? null,
    changes,
  };
}

/** 「最終記録」の短い表記：今日／昨日／N日前／M/D。 */
export function lastLoggedLabel(summary: PetHealthSummary): string {
  if (!summary.lastLoggedOn || summary.daysSinceLast == null) return '—';
  if (summary.daysSinceLast <= 0) return '今日';
  if (summary.daysSinceLast === 1) return '昨日';
  if (summary.daysSinceLast < 30) return `${summary.daysSinceLast}日前`;
  return summary.lastLoggedOn.slice(5).replace('-', '/');
}

/** 診察時に見せる「30 日のまとめ」。医療判断はしない。 */
export function thirtyDaySummary(logs: HealthLogRow[], today: Date) {
  const todayIdx = Math.floor(today.getTime() / 86_400_000);
  const recent = logs
    .filter((log) => /^\d{4}-\d{2}-\d{2}$/.test(log.logged_on) && todayIdx - dayIndex(log.logged_on) < 30)
    .sort((a, b) => (a.logged_on < b.logged_on ? 1 : -1));
  const weights = recent.map((log) => log.weight_kg).filter((v): v is number => v != null && Number.isFinite(Number(v))).map(Number);
  const count = (pick: (log: HealthLogRow) => string | null | undefined) => {
    const out: Record<string, number> = {};
    for (const log of recent) { const key = pick(log) ?? ''; if (key) out[key] = (out[key] ?? 0) + 1; }
    return out;
  };
  const avg = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null);
  return {
    days: 30,
    records: recent.length,
    weight: weights.length ? { first: weights[weights.length - 1], last: weights[0], min: Math.min(...weights), max: Math.max(...weights) } : null,
    heartRateAvg: avg(recent.map((log) => log.heart_rate_bpm).filter((v): v is number => v != null).map(Number)),
    respiratoryRateAvg: avg(recent.map((log) => log.respiratory_rate_bpm).filter((v): v is number => v != null).map(Number)),
    stool: count((log) => log.stool_status),
    appetite: count((log) => log.appetite),
    skin: count((log) => log.skin_status),
    tearStain: count((log) => log.tear_stain_status),
    notes: recent.filter((log) => (log.note ?? '').trim()).slice(0, 20).map((log) => ({ loggedOn: log.logged_on, note: String(log.note).trim().slice(0, 300) })),
    logs: recent.map((log) => ({
      loggedOn: log.logged_on, weightKg: log.weight_kg, heartRateBpm: log.heart_rate_bpm ?? null, respiratoryRateBpm: log.respiratory_rate_bpm ?? null,
      stool: log.stool_status, appetite: log.appetite, skin: log.skin_status ?? null, tearStain: log.tear_stain_status ?? null,
    })),
  };
}

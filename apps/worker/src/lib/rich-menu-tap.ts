// リッチメニューのボタンが押されたことを、こちら側で受け取るための約束事。
//
// LINE のリッチメニューは「押されたよ」とは教えてくれない。postback だけが
// webhook に届く。そこで postback の data の先頭に、押されたボタン (area) の id を
// 付けておく。webhook はそれを見て、
//   ・どのボタンが押されたかを数える
//   ・そのボタンに設定されたタグ付け / スコア加算 / テンプレート送信を実行する
// ことができる。
//
// 形式:
//   rma=<areaId>              … 付随する data なし
//   rma=<areaId>&d=<encoded>  … 元の data あり (URL エンコード)
//
// 元の data は必ず剥がして下流に渡す。運用者が組んだ自動応答やオートメーションは
// 「data がこの文字列と一致したら」で判定しているので、こちらの都合で付けた目印を
// そのまま流すと、今まで動いていた条件に当たらなくなる。

const PREFIX = 'rma=';

export type RichMenuTapPostback = {
  areaId: string;
  /** 運用者が設定した本来の data。無ければ null。 */
  inner: string | null;
};

export function buildTapPostbackData(areaId: string, inner?: string | null): string {
  const base = `${PREFIX}${areaId}`;
  if (!inner) return base;
  return `${base}&d=${encodeURIComponent(inner)}`;
}

/**
 * postback data がリッチメニュー由来なら中身を返す。そうでなければ null。
 * null が返った場合、呼び出し側は今までどおりの処理を続ければよい。
 */
export function parseTapPostbackData(data: string): RichMenuTapPostback | null {
  if (typeof data !== 'string' || !data.startsWith(PREFIX)) return null;
  const rest = data.slice(PREFIX.length);
  const sep = rest.indexOf('&d=');
  if (sep === -1) {
    const areaId = rest.trim();
    return areaId ? { areaId, inner: null } : null;
  }
  const areaId = rest.slice(0, sep).trim();
  if (!areaId) return null;
  const encoded = rest.slice(sep + 3);
  let inner: string | null = null;
  try {
    inner = decodeURIComponent(encoded);
  } catch {
    // 壊れたエンコードでもボタンの識別だけは活かす
    inner = encoded;
  }
  return { areaId, inner: inner.length > 0 ? inner : null };
}

/**
 * 日本時間で「その月の1日」と「翌月の1日」を返す。押された回数の既定の集計期間。
 *
 * 文字列のまま比べる（辞書順＝時系列順）ので、月の 0 詰めを外すと 9月と 10月の
 * 大小が逆転する。ここが1日ずれると「今月のタップ」が前月ぶんを混ぜる。
 */
export function currentMonthRange(nowJst: string): { from: string; to: string } {
  const year = Number(nowJst.slice(0, 4));
  const month = Number(nowJst.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, '0');
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    from: `${year}-${pad(month)}-01T00:00:00.000`,
    to: `${nextYear}-${pad(nextMonth)}-01T00:00:00.000`,
  };
}

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

/**
 * 日本時間で「集計する期間」を出す。
 *
 * 期間を文字列で持つのは、DB の日時が日本時間の ISO 文字列だから
 * （`2026-08-20T01:23:45.678`）。辞書順が時系列順になるので、そのまま
 * 大小で比べられる。
 */

/**
 * その月の1日 0:00 と、翌月の1日 0:00。**終わりは含まない。**
 *
 * ダッシュボードの「今月」は `substr(created_at, 1, 7) = 'YYYY-MM'` の
 * 前方一致で数えている。**指す範囲は同じ**（同じ月の1日から末日まで）。
 * こちらが範囲比較なのは、索引を使えるようにするため。数え方が違うので
 * 名前を分けるべきか迷ったが、**答えが同じなら分けないほうがよい**と判断した。
 * 分けると、どちらを使うべきか読む人が毎回考えることになる。
 *
 * 月の 0 詰めを外すと 9月と 10月の大小が逆転する（'2026-9-01' > '2026-10-01'）。
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

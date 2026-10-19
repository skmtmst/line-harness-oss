/** 固定した電話列だけを検索時に整える。入力値は必ず別のbindで渡す。 */
export const normalizedPhoneSql = (() => {
  let sql = "COALESCE(customer_phone, '')";
  for (const [from, to] of [...'０１２３４５６７８９'].map((digit, i) => [digit, String(i)])) sql = `REPLACE(${sql}, '${from}', '${to}')`;
  for (const separator of ' -()（）－‐‑‒–—―−ー　\t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff') sql = `REPLACE(${sql}, '${separator}', '')`;
  return sql;
})();

/** 固定した電話列だけを検索時に整える。入力値は必ず別のbindで渡す。 */
export const normalizedPhoneSql = (() => {
  const digits = '０１２３４５６７８９';
  const separators = ' -()（）－‐‑‒–—―−ー　\t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  const steps = digits.length + separators.length;
  // 同じ固定回数の置換を順に行い、登録の副問合せでもD1の式の深さ100に収める。
  return `(WITH RECURSIVE normalized_phone(step, value) AS (
    SELECT 0, COALESCE(customer_phone, '')
    UNION ALL
    SELECT step + 1, CASE WHEN step < 10
      THEN REPLACE(value, SUBSTR('${digits}', step + 1, 1), CAST(step AS TEXT))
      ELSE REPLACE(value, SUBSTR('${separators}', step - 9, 1), '') END
    FROM normalized_phone WHERE step < ${steps}
  ) SELECT value FROM normalized_phone WHERE step = ${steps})`;
})();

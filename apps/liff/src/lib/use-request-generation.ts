import { useCallback, useLayoutEffect, useRef } from 'react';

/** 入力・画面の世代が変わった後に返った応答は、成功・失敗とも画面へ反映しない。 */
export function useRequestGeneration(contextKey: string) {
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useLayoutEffect(() => {
    invalidate();
    return invalidate;
  }, [contextKey, invalidate]);
  const begin = useCallback(() => ++generation.current, []);
  const isCurrent = useCallback((request: number) => request === generation.current, []);
  return { begin, isCurrent, invalidate };
}

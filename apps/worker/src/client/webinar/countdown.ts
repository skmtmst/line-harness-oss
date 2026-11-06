export function countdownParts(seconds: number): Array<{ value: number; unit: string }> {
  const remaining = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  if (remaining > 48 * 3600) return [{ value: Math.floor(remaining / 86400), unit: '日' }, { value: Math.floor(remaining % 86400 / 3600), unit: '時間' }];
  if (remaining >= 3600) return [{ value: Math.floor(remaining / 3600), unit: '時間' }, { value: Math.floor(remaining % 3600 / 60), unit: '分' }];
  return [{ value: Math.floor(remaining / 60), unit: '分' }, { value: remaining % 60, unit: '秒' }];
}

export function countdownText(seconds: number): string {
  return countdownParts(seconds).map(({ value, unit }) => `${value}${unit}`).join('');
}

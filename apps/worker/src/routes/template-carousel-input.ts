/** 162: カルーセルの選択肢まわりの設定を読む。 */
export function readCarouselOptions(body: Record<string, unknown>):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string } {
  const value: Record<string, unknown> = {};
  if ('carouselActions' in body) {
    const raw = body.carouselActions;
    if (raw === null) {
      value.carouselActions = null;
    } else if (typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'carouselActions must be an object keyed by column index' };
    } else {
      value.carouselActions = raw;
    }
  }
  if ('carouselTapLimitMode' in body) {
    if (body.carouselTapLimitMode !== 'none' && body.carouselTapLimitMode !== 'once') {
      return { ok: false, error: "carouselTapLimitMode must be 'none' or 'once'" };
    }
    value.carouselTapLimitMode = body.carouselTapLimitMode;
  }
  if ('carouselTapLimitText' in body) {
    const raw = body.carouselTapLimitText;
    if (raw === null || raw === '') {
      value.carouselTapLimitText = null;
    } else if (typeof raw !== 'string') {
      return { ok: false, error: 'carouselTapLimitText must be a string' };
    } else if ([...raw].length > 300) {
      return { ok: false, error: 'carouselTapLimitText must be 300 characters or fewer' };
    } else {
      value.carouselTapLimitText = raw;
    }
  }
  return { ok: true, value };
}

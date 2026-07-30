const BOTTOM_THRESHOLD_PX = 8;

export function isConsentScrolledToBottom({
  scrollTop,
  clientHeight,
  scrollHeight,
}: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): boolean {
  return scrollTop + clientHeight >= scrollHeight - BOTTOM_THRESHOLD_PX;
}

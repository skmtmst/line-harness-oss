export type TableOrientation = 'horizontal' | 'vertical';
export type ChairArrangement = 'both' | 'one' | 'all';
export type ChairSide = 'top' | 'right' | 'bottom' | 'left';
export type ChairPosition = { side: ChairSide; offset: number };

const opposite: Record<ChairSide, ChairSide> = {
  top: 'bottom', right: 'left', bottom: 'top', left: 'right',
};

function along(side: ChairSide, count: number): ChairPosition[] {
  return Array.from({ length: count }, (_, index) => ({
    side,
    offset: (index + 1) / (count + 1),
  }));
}

/** Penの最大人数と卓形状に合わせ、人数を変えるたびに椅子を再配置する。 */
export function restaurantChairPositions({
  capacity, shape, orientation = 'horizontal', arrangement = 'both', side,
}: {
  capacity: number;
  shape: 'rectangle' | 'circle' | 'long' | 'counter' | 'sofa';
  orientation?: TableOrientation;
  arrangement?: ChairArrangement;
  side?: ChairSide;
}): ChairPosition[] {
  if (!Number.isInteger(capacity) || capacity < 1) return [];
  const count = Math.min(capacity, 100);
  if (shape === 'circle') {
    const sides: ChairSide[] = ['top', 'right', 'bottom', 'left'];
    const totals = sides.map((_, index) => Math.floor(count / 4) + (index < count % 4 ? 1 : 0));
    return sides.flatMap((face, index) => along(face, totals[index]));
  }
  if (shape === 'counter') return along(side ?? (orientation === 'vertical' ? 'left' : 'bottom'), count);
  if (arrangement === 'one') return along(side ?? (orientation === 'vertical' ? 'left' : 'top'), count);
  if (arrangement === 'all') {
    const sides: ChairSide[] = ['top', 'right', 'bottom', 'left'];
    const totals = sides.map((_, index) => Math.floor(count / 4) + (index < count % 4 ? 1 : 0));
    return sides.flatMap((face, index) => along(face, totals[index]));
  }
  const first: ChairSide = side ?? (orientation === 'vertical' || (shape === 'rectangle' && count <= 2) ? 'left' : 'top');
  return [...along(first, Math.ceil(count / 2)), ...along(opposite[first], Math.floor(count / 2))];
}

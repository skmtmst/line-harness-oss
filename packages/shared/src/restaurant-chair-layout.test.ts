import { describe, expect, it } from 'vitest';
import { restaurantChairPositions } from './restaurant-chair-layout.js';

describe('restaurantChairPositions', () => {
  it('places five chairs as three and two on the square table', () => {
    const chairs = restaurantChairPositions({ capacity: 5, shape: 'rectangle' });
    expect(chairs.filter((chair) => chair.side === 'top')).toHaveLength(3);
    expect(chairs.filter((chair) => chair.side === 'bottom')).toHaveLength(2);
  });

  it('places two chairs opposite one another', () => {
    expect(restaurantChairPositions({ capacity: 2, shape: 'rectangle' }).map((chair) => chair.side)).toEqual(['left', 'right']);
  });

  it('rotates a six-seat rectangle to three chairs on each long side', () => {
    const chairs = restaurantChairPositions({ capacity: 6, shape: 'long', orientation: 'vertical' });
    expect(chairs.filter((chair) => chair.side === 'left')).toHaveLength(3);
    expect(chairs.filter((chair) => chair.side === 'right')).toHaveLength(3);
  });

  it('puts a single counter chair on the selected customer side', () => {
    expect(restaurantChairPositions({ capacity: 1, shape: 'counter', side: 'left' })).toEqual([{ side: 'left', offset: 0.5 }]);
  });

  it('spaces four chairs around a round table', () => {
    expect(restaurantChairPositions({ capacity: 4, shape: 'circle' }).map((chair) => chair.side)).toEqual(['top', 'right', 'bottom', 'left']);
  });
});

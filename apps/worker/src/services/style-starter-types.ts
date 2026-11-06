import type { AccountStyle, StyleCard, InitialMenuTarget, StarterCatalogSelection } from '@line-crm/shared';

export type StarterItem = {
  key: string;
  kind:
    | 'form'
    | 'template'
    | 'rich_menu'
    | 'automation'
    | 'reminder'
    | 'booking_menu'
    | 'dashboard'
    | 'friend_add_rule'
    | 'tag_set'
    | 'scenario';
  name: string;
  initialMenu?: AccountStyle;
  formTarget?: InitialMenuTarget;
  /** friend_add_rule が送るごあいさつ。同じ組の template の key を指す。 */
  templateKey?: string;
  feature?: string;
  text?: string;
  durationMinutes?: number;
  price?: number;
  buttons?: Array<{ target?: InitialMenuTarget; label: string; feature: string; actionType?: 'uri' | 'message'; actionData?: string }>;
  cards?: StyleCard[];
  sourceId?: string;
  offsetMinutes?: number;
  offsetDays?: number;
  sendAtTime?: string;
  triggerType?: 'calendar_booked' | 'restaurant.departed';
  /** tag_set の見本のタグの名前。入れた時点では本物のタグを作らない。 */
  tags?: Array<{ name: string }>;
  /** scenario の通数。delayMinutes は前の通（1 通目はシナリオの始まり）からの分。 */
  steps?: Array<{ delayMinutes: number; text: string }>;
};
export type StarterDefinition = { items: StarterItem[]; mode?: 'catalog'; selections?: StarterCatalogSelection[] };

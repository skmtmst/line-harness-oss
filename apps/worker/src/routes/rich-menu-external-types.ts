
export type ExternalLineArea = {
  bounds?: { x?: number; y?: number; width?: number; height?: number };
  action?: {
    type?: string;
    label?: string;
    uri?: string;
    text?: string;
    displayText?: string;
    richMenuAliasId?: string;
  };
};

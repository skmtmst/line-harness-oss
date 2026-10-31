export type InitialMenuLayout = {
  width: number;
  imageWidth: number;
  imageReady: boolean;
  overflow: number;
  beside: boolean;
  gap: number | null;
};
export function measureInitialMenuLayout(): InitialMenuLayout[];
export function initialMenuLayoutFailures(previews: InitialMenuLayout[]): string[];

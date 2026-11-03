export const MILEAGE_FRIENDS_EC: {
  balanceSource: string;
  items: Array<{
    rank: string;
    available: number | null;
    [key: string]: unknown;
  }>;
  ecKnownCount: number;
  summary: { available: number };
};

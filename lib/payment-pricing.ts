export const APPLICATION_FEE_PAISE = 3000;
export const ORGANIZER_COMMISSION_PERCENT = 40;

export function calculateOrganizerCommissionPaise(grossPaise: number) {
  return Math.floor((grossPaise * ORGANIZER_COMMISSION_PERCENT) / 100);
}

import { venueBookingLifecycle } from '../../../lib/lifecycle';

// Read as the requesting organization, so a request reads the same on its list and on the SAO's.
export function venueStageText(booking) {
  return venueBookingLifecycle(booking, 'ADMIN').nextAction.title;
}

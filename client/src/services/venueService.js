import api from './api';

// Venue catalog: SUPER_ADMIN manages it, everyone with a venue route reads it.
export const getVenues = (params) => api.get('/venues', { params });
export const createVenue = (data) => api.post('/venues', data);
export const updateVenue = (id, data) => api.put(`/venues/${id}`, data);
export const deleteVenue = (id) => api.delete(`/venues/${id}`);

// Pending and approved slots for a chosen date range, with other organizations anonymized.
export const getVenueAvailability = (id, params) => api.get(`/venues/${id}/availability`, { params });

// Bookings: SUPER_ADMIN reviews across organizations, ADMIN/SBO_OFFICER see their own.
export const getVenueBookings = (params) => api.get('/venue-bookings', { params });
export const createVenueBooking = (data) => api.post('/venue-bookings', data);
export const reviewVenueBooking = (id, data) => api.patch(`/venue-bookings/${id}/review`, data);
export const withdrawVenueBooking = (id) => api.patch(`/venue-bookings/${id}/withdraw`);

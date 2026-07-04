import api from './api';

export const getMerchandise = (params) =>
  api.get('/merchandise', { params });

function toFormData(data) {
  const fd = new FormData();
  Object.entries(data).forEach(([k, v]) => {
    if (k === 'imageFile') { if (v) fd.append('image', v); }
    else if (v !== undefined && v !== null) {
      if (typeof v === 'boolean') {
        fd.append(k, v ? '1' : '0');
      } else {
        fd.append(k, String(v));
      }
    }
  });
  return fd;
}

export const createItem = (data) =>
  api.post('/merchandise', toFormData(data));

export const updateItem = (id, data) => {
  const fd = toFormData(data);
  fd.append('_method', 'PUT');
  return api.post(`/merchandise/${id}`, fd);
};

export const deleteItem = (id) =>
  api.delete(`/merchandise/${id}`);

export const adjustStock = (id, stock_quantity) =>
  api.patch(`/merchandise/${id}/stock`, { stock_quantity });

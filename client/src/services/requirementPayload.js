export function requirementPayload(payload, updating = false) {
  const { template, ...fields } = payload;
  if (!template) return fields;
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((item) => data.append(`${key}[]`, item));
    else data.append(key, typeof value === 'boolean' ? (value ? '1' : '0') : value);
  }
  data.append('template', template);
  if (updating) data.append('_method', 'PUT');
  return data;
}

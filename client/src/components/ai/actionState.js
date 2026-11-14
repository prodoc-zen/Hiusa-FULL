export const actionOf = (message) => (message?.payload && typeof message.payload.action === 'object' ? message.payload.action : null) || null;

export function isPastExpiry(action, now = Date.now()) {
  const expires = Date.parse(action?.expires_at ?? '');
  return Number.isFinite(expires) && now >= expires;
}

export function effectiveStatus(action, now = Date.now()) {
  if (action.status === 'awaiting_confirmation' && isPastExpiry(action, now)) return 'expired';
  return action.status;
}

// The id of the one card the person can still press: the newest action in the conversation, if it is still open.
export function liveActionId(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const action = actionOf(messages[i]);
    if (action) return action.status === 'awaiting_confirmation' ? messages[i].id ?? null : null;
  }
  return null;
}

// `values` are what the person has typed into the card; without them the stored field values are used.
export function actionDetailsText(action, values) {
  const lines = [action.title].filter(Boolean);
  (action.fields || []).forEach((field) => {
    const raw = values ? values[field.name] : field.value;
    const value = field.type === 'checkbox' ? (raw ? 'Yes' : 'No') : (raw ?? '');
    const shown = field.type === 'select'
      ? ((field.options || []).find((option) => String(option.value) === String(value))?.label ?? value)
      : value;
    lines.push(`${field.label}: ${shown}`);
  });
  return lines.join('\n');
}

export function actionCopyText(message, values) {
  const action = actionOf(message);
  if (!action) return message.content || '';
  return [message.content, actionDetailsText(action, values || undefined)].filter(Boolean).join('\n');
}

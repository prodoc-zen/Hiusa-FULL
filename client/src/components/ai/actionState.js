export const actionOf = (message) => (message?.payload && typeof message.payload.action === 'object' ? message.payload.action : null) || null;

export function isPastExpiry(action, now = Date.now()) {
  const expires = Date.parse(action?.expires_at ?? '');
  return Number.isFinite(expires) && now >= expires;
}

export function effectiveStatus(action, now = Date.now()) {
  if (action.status === 'awaiting_confirmation' && isPastExpiry(action, now)) return 'expired';
  return action.status;
}

// The id of the one card the person can still press: the newest one the server still holds open.
export function liveActionId(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const action = actionOf(messages[i]);
    if (action?.status === 'awaiting_confirmation' && messages[i].id != null) return messages[i].id;
  }
  return null;
}

export function actionCopyText(message) {
  const action = actionOf(message);
  if (!action) return message.content || '';
  const lines = [message.content, action.title].filter(Boolean);
  (action.fields || []).forEach((field) => {
    const value = field.type === 'checkbox' ? (field.value ? 'Yes' : 'No') : (field.value ?? '');
    const shown = field.type === 'select'
      ? ((field.options || []).find((option) => String(option.value) === String(value))?.label ?? value)
      : value;
    lines.push(`${field.label}: ${shown}`);
  });
  return lines.join('\n');
}

import api from '../services/api';

export async function openProtectedFile(openUrl) {
  const tab = window.open('', '_blank');
  if (!tab) throw Object.assign(new Error('Pop-ups are blocked'), { userMessage: 'Allow pop-ups to open this file.' });
  try {
    const response = await api.get(openUrl, { responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    tab.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    tab.close();
    throw error;
  }
}

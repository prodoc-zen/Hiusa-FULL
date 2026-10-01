// Saves an Axios blob response, preferring the server's Content-Disposition filename.
export default function downloadBlob(response, fallbackName) {
  const disposition = response.headers?.['content-disposition'] || '';
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackName;
  const url = URL.createObjectURL(response.data);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

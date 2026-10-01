const escapeXml = (value) => Array.from(String(value ?? ''))
  .filter((character) => character.charCodeAt(0) >= 32 || [9, 10, 13].includes(character.charCodeAt(0)))
  .join('')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

export function buildExcelXml(headers, rows) {
  const row = (cells) => `<Row>${cells.map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join('')}</Row>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Orders"><Table>${row(headers)}${rows.map(row).join('')}</Table></Worksheet></Workbook>`;
}

export function downloadExcelXml(filename, headers, rows) {
  const blob = new Blob([buildExcelXml(headers, rows)], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

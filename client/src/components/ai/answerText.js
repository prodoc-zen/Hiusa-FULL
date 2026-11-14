const BLOCK_TAGS = new Set([
  'ADDRESS', 'BLOCKQUOTE', 'DETAILS', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'LI', 'OL', 'P', 'PRE',
  'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'THEAD', 'TR', 'UL',
]);
const STAT_PART = /\bstat-(?:value|label)\b/;

const isBlock = (node) => node.nodeType === 1 && (BLOCK_TAGS.has(node.tagName) || STAT_PART.test(node.className || ''));

function inline(node) {
  if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
  if (node.nodeType !== 1 || node.tagName === 'PROGRESS' || node.tagName === 'INPUT') return '';
  if (node.tagName === 'BR') return '\n';
  return Array.from(node.childNodes).map(inline).join('');
}

function listText(list) {
  const ordered = list.tagName === 'OL';
  let number = Number(list.getAttribute('start')) || 1;
  return Array.from(list.children)
    .filter((item) => item.tagName === 'LI')
    .map((item) => {
      const marker = ordered ? `${number++}. ` : '- ';
      const [first = '', ...rest] = blocks(item).join('\n').split('\n');
      return [marker + first, ...rest.map((line) => `  ${line}`)].join('\n');
    })
    .join('\n');
}

function tableText(table) {
  return Array.from(table.querySelectorAll('tr'))
    .map((row) => Array.from(row.children).map((cell) => inline(cell).trim()).join('\t'))
    .join('\n');
}

function blockText(el) {
  if (el.tagName === 'UL' || el.tagName === 'OL') return listText(el);
  if (el.tagName === 'TABLE') return tableText(el);
  if (el.tagName === 'PRE') return el.textContent.replace(/\n+$/, '');
  if (el.tagName === 'HR') return '';
  return blocks(el).join('\n\n');
}

function blocks(parent) {
  const out = [];
  let run = '';
  const flush = () => {
    const text = run.trim();
    if (text) out.push(text);
    run = '';
  };
  Array.from(parent.childNodes).forEach((child) => {
    if (isBlock(child)) {
      flush();
      const text = blockText(child);
      if (text) out.push(text);
    } else {
      run += inline(child);
    }
  });
  flush();
  return out;
}

// What the person reads on screen, as plain text: no Markdown marks, no HTML.
export default function answerText(root) {
  return root ? blocks(root).join('\n\n') : '';
}

// A local stand-in for the Anthropic Messages API, for end-to-end checks of the streaming chat only.
// It writes a grounded Markdown answer from the facts JSON it is sent, with a thinking summary first.
const http = require('http');

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function chunks(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function answerFrom(userText) {
  let facts = {};
  const m = userText.match(/```json\n([\s\S]*?)\n```/);
  if (m) { try { facts = JSON.parse(m[1]); } catch { facts = {}; } }
  const question = (userText.split('Question:').pop() || '').trim();
  const name = facts.user_first_name || 'there';
  const sections = Array.isArray(facts.sections) ? facts.sections : [];
  const rows = sections.flatMap((s) => s.rows || []).slice(0, 4);
  const lines = [];
  if (/invent/i.test(question)) {
    lines.push(`Here is a made up figure: PHP 987,654.32 was spent on 4321 items.`);
    return lines.join('\n');
  }
  lines.push(`**${name}, here is what matters most right now.** ${String(facts.deterministic_answer || 'I looked through your records.').split('. ')[0]}.`);
  lines.push('');
  if (rows.length) {
    lines.push('### What to do first');
    lines.push('');
    rows.forEach((r) => {
      const link = r.href ? ` [${r.action_label || 'Open'}](${r.href})` : '';
      const badge = r.status ? ` <span class="badge badge-warning">${r.status}</span>` : '';
      lines.push(`- **${r.primary}**${badge}: ${r.secondary || ''}${link}`);
    });
    lines.push('');
    lines.push('| Item | Status |');
    lines.push('|---|---|');
    rows.forEach((r) => lines.push(`| ${r.primary} | ${r.status || 'Listed'} |`));
    lines.push('');
  }
  lines.push('<div class="callout callout-info">I only read the records your role can open. Open the linked page to confirm before you act.</div>');
  lines.push('');
  lines.push('<script>alert("x")</script>This sentence follows a tag that must never run. [An outside link](https://example.com/phish) stays as plain text.');
  return lines.join('\n');
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    let json = {};
    try { json = JSON.parse(body || '{}'); } catch { json = {}; }
    const last = (json.messages || []).filter((x) => x.role === 'user').pop();
    const userText = typeof last?.content === 'string' ? last.content : (last?.content || []).map((b) => b.text || '').join('\n');
    const text = answerFrom(userText || '');
    const model = json.model || 'claude-sonnet-5-5';
    if (!json.stream) {
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_local' });
      res.end(JSON.stringify({ id: 'msg_local', type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'Local stand-in answer.' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'request-id': 'req_local' });
    sse(res, 'message_start', { type: 'message_start', message: { id: 'msg_local', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
    const thinking = 'The user wants to know what needs attention. I will lead with the most urgent item, name who has to act, and link the page for each one. I will not add or compare any numbers.';
    const steps = [];
    steps.push(() => sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }));
    chunks(thinking, 24).forEach((c) => steps.push(() => sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: c } })));
    steps.push(() => sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } }));
    steps.push(() => sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 }));
    steps.push(() => sse(res, 'content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }));
    chunks(text, 18).forEach((c) => steps.push(() => sse(res, 'content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: c } })));
    steps.push(() => sse(res, 'content_block_stop', { type: 'content_block_stop', index: 1 }));
    steps.push(() => sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 120 } }));
    steps.push(() => sse(res, 'message_stop', { type: 'message_stop' }));
    let i = 0;
    const tick = setInterval(() => {
      if (i >= steps.length) { clearInterval(tick); res.end(); return; }
      steps[i++]();
    }, 25);
    res.on('close', () => clearInterval(tick));
  });
}).listen(8787, '127.0.0.1', () => console.log('fake anthropic on 8787'));

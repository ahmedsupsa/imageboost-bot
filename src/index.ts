interface Env {
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  IMAGES: ImagesBinding;
  SESSIONS: KVNamespace;
}

type TgMessage = {
  message_id: number;
  chat: { id: number };
  text?: string;
  photo?: { file_id: string; width: number; height: number }[];
  document?: { file_id: string; file_name?: string; mime_type?: string };
};
type TgUpdate = {
  message?: TgMessage;
  callback_query?: { id: string; data?: string; message?: TgMessage };
};
type Session = {
  fileId: string;
  scale: 2 | 3 | 4;
  mode: 'photo' | 'screenshot';
  format: 'png' | 'webp' | 'jpeg';
};

const api = (e: Env, m: string) => `https://api.telegram.org/bot${e.BOT_TOKEN}/${m}`;
async function tg(e: Env, method: string, body: BodyInit) {
  const r = await fetch(api(e, method), { method: 'POST', body });
  if (!r.ok) throw new Error(`${method}: ${r.status} ${await r.text()}`);
  return r.json<any>();
}
async function call(e: Env, method: string, data: Record<string, unknown>) {
  return tg(e, method, new URLSearchParams(Object.entries(data).map(([k,v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])));
}

function keyboard(s: Session) {
  const mark = (on: boolean, label: string) => `${on ? '✓ ' : ''}${label}`;
  return { inline_keyboard: [
    [
      { text: mark(s.scale === 2, '×2'), callback_data: 'scale:2' },
      { text: mark(s.scale === 3, '×3'), callback_data: 'scale:3' },
      { text: mark(s.scale === 4, '×4'), callback_data: 'scale:4' },
    ],
    [
      { text: mark(s.mode === 'photo', '📷 صورة'), callback_data: 'mode:photo' },
      { text: mark(s.mode === 'screenshot', '📱 Screenshot'), callback_data: 'mode:screenshot' },
    ],
    [
      { text: mark(s.format === 'png', 'PNG'), callback_data: 'format:png' },
      { text: mark(s.format === 'webp', 'WebP'), callback_data: 'format:webp' },
      { text: mark(s.format === 'jpeg', 'JPG'), callback_data: 'format:jpeg' },
    ],
    [{ text: '✨ تحسين الصورة', callback_data: 'enhance' }],
    [{ text: '🔄 إعادة الضبط', callback_data: 'reset' }],
  ]};
}
function panel(s: Session) {
  const type = s.mode === 'photo' ? '📷 صورة' : '📱 Screenshot';
  return `✨ ImageBoost\n\nاختر إعدادات التحسين بدون ذكاء اصطناعي:\n\n🔎 التكبير: ×${s.scale}\n🎛 النوع: ${type}\n📦 الصيغة: ${s.format.toUpperCase()}\n\nثم اضغط «تحسين الصورة».`;
}
async function showPanel(e: Env, chatId: number, s: Session, messageId?: number) {
  const data: Record<string, unknown> = { chat_id: String(chatId), text: panel(s), reply_markup: keyboard(s) };
  if (messageId) { data.message_id = String(messageId); await call(e, 'editMessageText', data); }
  else await call(e, 'sendMessage', data);
}
async function getSession(e: Env, chatId: number) { return e.SESSIONS.get<Session>(`s:${chatId}`, 'json'); }
async function saveSession(e: Env, chatId: number, s: Session) { await e.SESSIONS.put(`s:${chatId}`, JSON.stringify(s), { expirationTtl: 3600 }); }
async function fileBytes(e: Env, id: string) {
  const j = await call(e, 'getFile', { file_id: id });
  const p = j.result?.file_path;
  if (!p) throw new Error('Telegram file path missing');
  const r = await fetch(`https://api.telegram.org/file/bot${e.BOT_TOKEN}/${p}`);
  if (!r.ok || !r.body) throw new Error('Could not download image');
  return r;
}
async function enhance(e: Env, r: Response, s: Session) {
  const bytes = await r.arrayBuffer();
  const info = await e.IMAGES.info(bytes);
  const originalWidth = Math.max(Number(info.width || 1), 1);
  const width = Math.min(originalWidth * s.scale, 4096);
  const quality = s.mode === 'photo' ? 95 : 100;
  const format = s.format === 'jpeg' ? 'image/jpeg' : s.format === 'webp' ? 'image/webp' : 'image/png';
  const out = await e.IMAGES.input(bytes).transform({ width, fit: 'scale-up' }).output({ format, quality });
  return { response: out.response(), originalWidth, width };
}
async function sendDoc(e: Env, chatId: number, b: Blob, s: Session, from: number, to: number) {
  const ext = s.format === 'jpeg' ? 'jpg' : s.format;
  const f = new FormData();
  f.set('chat_id', String(chatId));
  f.set('caption', `✅ تم التحسين بدون AI\n🔎 ×${s.scale} • ${from}px → ${to}px\n🎛 ${s.mode === 'photo' ? 'صورة' : 'Screenshot'} • ${ext.toUpperCase()}\n\nأُرسلت كملف للمحافظة على الجودة.`);
  f.set('document', b, `imageboost-x${s.scale}.${ext}`);
  await tg(e, 'sendDocument', f);
}
async function onMessage(e: Env, m: TgMessage) {
  const chatId = m.chat.id;
  if (m.text === '/start' || m.text === '/help') {
    await call(e, 'sendMessage', { chat_id: String(chatId), text: '👋 أهلًا بك في ImageBoost\n\nأرسل صورة أو Screenshot كصورة أو ملف، وبعدها اختر مستوى التكبير والصيغة واضغط تحسين.\n\n⚙️ المعالجة تقليدية بالكامل — بدون ذكاء اصطناعي.' });
    return;
  }
  let fileId: string | undefined;
  if (m.photo?.length) fileId = m.photo[m.photo.length - 1].file_id;
  else if (m.document?.mime_type?.startsWith('image/')) fileId = m.document.file_id;
  if (!fileId) {
    await call(e, 'sendMessage', { chat_id: String(chatId), text: '📸 أرسل صورة أولًا، وبعدها سأعرض لك خيارات التحسين.' });
    return;
  }
  const s: Session = { fileId, scale: 2, mode: 'photo', format: 'png' };
  await saveSession(e, chatId, s);
  await showPanel(e, chatId, s);
}
async function onCallback(e: Env, q: NonNullable<TgUpdate['callback_query']>) {
  const m = q.message; if (!m || !q.data) return;
  const chatId = m.chat.id;
  let s = await getSession(e, chatId);
  if (!s) { await call(e, 'answerCallbackQuery', { callback_query_id: q.id, text: 'انتهت الجلسة. أرسل الصورة مرة أخرى.', show_alert: true }); return; }
  if (q.data === 'reset') s = { ...s, scale: 2, mode: 'photo', format: 'png' };
  else if (q.data.startsWith('scale:')) s.scale = Number(q.data.split(':')[1]) as 2|3|4;
  else if (q.data.startsWith('mode:')) s.mode = q.data.split(':')[1] as Session['mode'];
  else if (q.data.startsWith('format:')) s.format = q.data.split(':')[1] as Session['format'];
  else if (q.data === 'enhance') {
    await call(e, 'answerCallbackQuery', { callback_query_id: q.id, text: '⏳ جاري التحسين…' });
    await call(e, 'editMessageText', { chat_id: String(chatId), message_id: String(m.message_id), text: `⏳ جاري معالجة الصورة ×${s.scale}…\nقد تستغرق لحظات حسب حجم الصورة.` });
    try {
      const src = await fileBytes(e, s.fileId);
      const out = await enhance(e, src, s);
      await sendDoc(e, chatId, await out.response.blob(), s, out.originalWidth, out.width);
      await showPanel(e, chatId, s);
    } catch (err) {
      console.error(err);
      await call(e, 'sendMessage', { chat_id: String(chatId), text: '❌ تعذر تحسين هذه الصورة. جرّب صورة أصغر أو مستوى تكبير أقل.' });
    }
    return;
  }
  await saveSession(e, chatId, s);
  await call(e, 'answerCallbackQuery', { callback_query_id: q.id });
  await showPanel(e, chatId, s, m.message_id);
}

function setupPage(message = '') {
  const note = message ? `<div class="note">${message}</div>` : '';
  return new Response(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ImageBoost Setup</title><style>body{font-family:system-ui;background:#0b1020;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}.card{width:min(92%,440px);background:#151b2f;padding:28px;border-radius:22px;box-shadow:0 20px 60px #0006}h1{margin-top:0}p{color:#b9c1d9;line-height:1.7}input,button{box-sizing:border-box;width:100%;padding:14px;border-radius:12px;font-size:16px}input{background:#0d1325;color:#fff;border:1px solid #303955;margin:12px 0}button{border:0;background:#fff;color:#111;font-weight:700;cursor:pointer}.note{background:#202945;padding:12px;border-radius:12px;margin-bottom:14px}</style></head><body><main class="card"><h1>✨ ImageBoost</h1><p>ربط بوت Telegram بالـWorker. أدخل WEBHOOK_SECRET نفسه المحفوظ في Cloudflare. لا يتم وضع BOT_TOKEN في هذه الصفحة.</p>${note}<form method="post" action="/setup"><input type="password" name="secret" placeholder="WEBHOOK_SECRET" required autocomplete="off"><button type="submit">ربط Telegram</button></form></main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

async function setupWebhook(req: Request, e: Env) {
  const form = await req.formData();
  const secret = String(form.get('secret') || '');
  if (!secret || secret !== e.WEBHOOK_SECRET) return setupPage('❌ WEBHOOK_SECRET غير صحيح.');
  const origin = new URL(req.url).origin;
  const r = await fetch(api(e, 'setWebhook'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: `${origin}/telegram`, secret_token: e.WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'] }) });
  const result: any = await r.json();
  if (!r.ok || !result.ok) return setupPage(`❌ تعذر الربط: ${String(result.description || r.status)}`);
  return setupPage('✅ تم ربط Telegram بنجاح. افتح البوت واضغط Start ثم أرسل صورة.');
}

export default {
  async fetch(req: Request, e: Env): Promise<Response> {
    const u = new URL(req.url);
    if (u.pathname === '/health') return Response.json({ ok: true, service: 'ImageBoost Bot', version: '0.3.0' });
    if (u.pathname === '/setup' && req.method === 'GET') return setupPage();
    if (u.pathname === '/setup' && req.method === 'POST') return setupWebhook(req, e);
    if (req.method !== 'POST' || u.pathname !== '/telegram') return new Response('ImageBoost Bot v0.3', { status: 200 });
    if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== e.WEBHOOK_SECRET) return new Response('Forbidden', { status: 403 });
    try {
      const x = await req.json<TgUpdate>();
      if (x.callback_query) await onCallback(e, x.callback_query);
      else if (x.message) await onMessage(e, x.message);
    } catch (err) { console.error(err); }
    return new Response('ok');
  }
};

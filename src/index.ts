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
  photo?: { file_id: string; width: number; height: number; file_size?: number }[];
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
};
type TgUpdate = { message?: TgMessage; callback_query?: { id: string; data?: string; message?: TgMessage } };
type Session = {
  fileId: string;
  scale: 2 | 3 | 4;
  mode: 'photo' | 'screenshot';
  format: 'png' | 'webp' | 'jpeg';
  originalWidth?: number;
  originalHeight?: number;
  originalBytes?: number;
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
const fmtBytes = (n?: number) => !n ? 'غير معروف' : n >= 1048576 ? `${(n/1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n/1024))} KB`;
const fmtDims = (s: Session) => s.originalWidth && s.originalHeight ? `${s.originalWidth} × ${s.originalHeight}` : 'سيتم تحليلها عند المعالجة';

function choiceKeyboard() {
  return { inline_keyboard: [
    [{ text: '✨ تحسين تلقائي', callback_data: 'auto' }],
    [{ text: '🎛 تخصيص الجودة', callback_data: 'custom' }],
    [{ text: '🗑 إلغاء', callback_data: 'cancel' }]
  ]};
}
function customKeyboard(s: Session) {
  const mark = (on: boolean, label: string) => `${on ? '✓ ' : ''}${label}`;
  return { inline_keyboard: [
    [{ text: mark(s.mode === 'photo', '📷 صورة'), callback_data: 'mode:photo' }, { text: mark(s.mode === 'screenshot', '📱 Screenshot'), callback_data: 'mode:screenshot' }],
    [{ text: mark(s.scale === 2, '×2'), callback_data: 'scale:2' }, { text: mark(s.scale === 3, '×3'), callback_data: 'scale:3' }, { text: mark(s.scale === 4, '×4'), callback_data: 'scale:4' }],
    [{ text: mark(s.format === 'png', 'PNG'), callback_data: 'format:png' }, { text: mark(s.format === 'webp', 'WebP'), callback_data: 'format:webp' }, { text: mark(s.format === 'jpeg', 'JPG'), callback_data: 'format:jpeg' }],
    [{ text: '✨ ابدأ التحسين', callback_data: 'enhance' }],
    [{ text: '← رجوع', callback_data: 'back' }]
  ]};
}
function resultKeyboard() {
  return { inline_keyboard: [[{ text: '🔁 إعدادات أخرى', callback_data: 'custom' }], [{ text: '🖼️ صورة جديدة', callback_data: 'new' }]] };
}
function customPanel(s: Session) {
  return `🎛 تخصيص التحسين\n\nنوع الصورة: ${s.mode === 'photo' ? '📷 صورة' : '📱 Screenshot'}\nالدقة المطلوبة: ×${s.scale}\nصيغة الإخراج: ${s.format.toUpperCase()}\n\nاختر الإعدادات ثم اضغط «ابدأ التحسين».`;
}
async function edit(e: Env, chatId: number, messageId: number, text: string, reply_markup?: unknown) {
  const d: Record<string, unknown> = { chat_id: String(chatId), message_id: String(messageId), text };
  if (reply_markup) d.reply_markup = reply_markup;
  await call(e, 'editMessageText', d);
}
async function getSession(e: Env, id: number) { return e.SESSIONS.get<Session>(`s:${id}`, 'json'); }
async function saveSession(e: Env, id: number, s: Session) { await e.SESSIONS.put(`s:${id}`, JSON.stringify(s), { expirationTtl: 3600 }); }
async function fileBytes(e: Env, id: string) {
  const j = await call(e, 'getFile', { file_id: id });
  const p = j.result?.file_path;
  if (!p) throw new Error('Telegram file path missing');
  const r = await fetch(`https://api.telegram.org/file/bot${e.BOT_TOKEN}/${p}`);
  if (!r.ok) throw new Error('Could not download image');
  return r;
}
async function inspect(e: Env, r: Response) {
  const bytes = await r.arrayBuffer();
  const info = await e.IMAGES.info(bytes);
  return { bytes, width: Math.max(Number(info.width || 1),1), height: Math.max(Number(info.height || 1),1) };
}
async function enhanceBytes(e: Env, bytes: ArrayBuffer, s: Session, ow: number, oh: number) {
  const requested = ow * s.scale;
  const width = Math.min(requested, 4096);
  const ratio = width / ow;
  const height = Math.round(oh * ratio);
  const quality = s.mode === 'photo' ? 95 : 100;
  const format = s.format === 'jpeg' ? 'image/jpeg' : s.format === 'webp' ? 'image/webp' : 'image/png';
  const out = await e.IMAGES.input(bytes).transform({ width, fit: 'scale-up' }).output({ format, quality });
  return { response: out.response(), width, height, ratio, capped: requested > 4096 };
}
async function sendResult(e: Env, chatId: number, blob: Blob, s: Session, ow: number, oh: number, nw: number, nh: number, ratio: number, capped: boolean) {
  const ext = s.format === 'jpeg' ? 'jpg' : s.format;
  const caption = `🎉 جاهزة!\n\nقبل\n${ow} × ${oh} • ${fmtBytes(s.originalBytes)}\n\nبعد\n${nw} × ${nh} • ${fmtBytes(blob.size)}\n\n🔎 ${capped ? `أقصى دقة • ×${ratio.toFixed(2)} فعليًا` : `×${ratio.toFixed(2)}`}\n📦 ${ext.toUpperCase()}\n🧠 AI: لا\n\nأُرسلت كملف للحفاظ على الجودة.`;
  const f = new FormData(); f.set('chat_id', String(chatId)); f.set('caption', caption); f.set('document', blob, `imageboost-${nw}x${nh}.${ext}`); f.set('reply_markup', JSON.stringify(resultKeyboard()));
  await tg(e, 'sendDocument', f);
}
async function processImage(e: Env, chatId: number, messageId: number, s: Session, automatic = false) {
  await edit(e, chatId, messageId, `✨ جاري التحسين\n\n⬇️ تحميل الصورة الأصلية…\n⚙️ بعدها سنعالجها ونرسل النسخة النهائية.\n\n${automatic ? 'الوضع: ✨ تلقائي' : `الوضع: 🎛 مخصص ×${s.scale}`}`);
  try {
    const src = await fileBytes(e, s.fileId);
    const meta = await inspect(e, src);
    s.originalWidth = meta.width; s.originalHeight = meta.height;
    if (automatic) {
      s.mode = 'photo'; s.format = 'png';
      s.scale = meta.width <= 1024 ? 4 : meta.width <= 1600 ? 3 : 2;
    }
    await saveSession(e, chatId, s);
    await edit(e, chatId, messageId, `✨ جاري التحسين\n\n${meta.width} × ${meta.height}\n↓\n⚙️ معالجة الصورة بأفضل إعداد متاح…\n\nبدون AI • بدون تفاصيل وهمية`);
    const out = await enhanceBytes(e, meta.bytes, s, meta.width, meta.height);
    const blob = await out.response.blob();
    await edit(e, chatId, messageId, `📤 اكتملت المعالجة\n\nجاري إرسال النسخة النهائية كملف للحفاظ على الجودة…`);
    await sendResult(e, chatId, blob, s, meta.width, meta.height, out.width, out.height, out.ratio, out.capped);
    await edit(e, chatId, messageId, '✅ اكتملت العملية بنجاح.\n\nيمكنك استخدام الأزرار أسفل الملف لإعادة التحسين أو إرسال صورة جديدة.');
  } catch (err) {
    console.error(err);
    await edit(e, chatId, messageId, '❌ تعذر تحسين هذه الصورة.\n\nجرّب صورة أصغر أو إعداد تكبير أقل، ثم حاول مرة أخرى.', resultKeyboard());
  }
}
async function onMessage(e: Env, m: TgMessage) {
  const chatId = m.chat.id;
  if (m.text === '/start' || m.text === '/help') {
    await call(e, 'sendMessage', { chat_id: String(chatId), text: '✨ ImageBoost\n\nارفع جودة صورك بدون ذكاء اصطناعي وبدون إضافة تفاصيل وهمية.\n\n📸 أرسل صورة أو Screenshot للبدء.' }); return;
  }
  let fileId: string | undefined, w: number|undefined, h: number|undefined, size: number|undefined;
  if (m.photo?.length) { const p=m.photo[m.photo.length-1]; fileId=p.file_id; w=p.width; h=p.height; size=p.file_size; }
  else if (m.document?.mime_type?.startsWith('image/')) { fileId=m.document.file_id; size=m.document.file_size; }
  if (!fileId) { await call(e,'sendMessage',{chat_id:String(chatId),text:'📸 أرسل صورة أو Screenshot وسأجهزها لك.'}); return; }
  const s: Session={fileId,scale:2,mode:'photo',format:'png',originalWidth:w,originalHeight:h,originalBytes:size};
  await saveSession(e,chatId,s);
  await call(e,'sendMessage',{chat_id:String(chatId),text:`🖼️ وصلت الصورة\n\n📐 ${fmtDims(s)}\n📦 ${fmtBytes(size)}\n\nوش تبي نسوي فيها؟`,reply_markup:choiceKeyboard()});
}
async function onCallback(e: Env, q: NonNullable<TgUpdate['callback_query']>) {
  const m=q.message; if(!m||!q.data)return; const chatId=m.chat.id; let s=await getSession(e,chatId);
  if(!s){await call(e,'answerCallbackQuery',{callback_query_id:q.id,text:'انتهت الجلسة. أرسل الصورة مرة أخرى.',show_alert:true});return;}
  await call(e,'answerCallbackQuery',{callback_query_id:q.id});
  if(q.data==='auto'){await processImage(e,chatId,m.message_id,s,true);return;}
  if(q.data==='enhance'){await processImage(e,chatId,m.message_id,s,false);return;}
  if(q.data==='custom'){await edit(e,chatId,m.message_id,customPanel(s),customKeyboard(s));return;}
  if(q.data==='back'){await edit(e,chatId,m.message_id,`🖼️ الصورة جاهزة\n\n📐 ${fmtDims(s)}\n📦 ${fmtBytes(s.originalBytes)}\n\nاختر طريقة التحسين:`,choiceKeyboard());return;}
  if(q.data==='new'){await edit(e,chatId,m.message_id,'🖼️ أرسل الصورة الجديدة الآن.');return;}
  if(q.data==='cancel'){await e.SESSIONS.delete(`s:${chatId}`);await edit(e,chatId,m.message_id,'تم الإلغاء. أرسل صورة متى ما حبيت ✨');return;}
  if(q.data.startsWith('scale:'))s.scale=Number(q.data.split(':')[1]) as 2|3|4;
  else if(q.data.startsWith('mode:'))s.mode=q.data.split(':')[1] as Session['mode'];
  else if(q.data.startsWith('format:'))s.format=q.data.split(':')[1] as Session['format'];
  await saveSession(e,chatId,s); await edit(e,chatId,m.message_id,customPanel(s),customKeyboard(s));
}

function setupPage(message='') {
  const note=message?`<div class="note">${message}</div>`:'';
  return new Response(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ImageBoost Setup</title><style>body{font-family:system-ui;background:#0b1020;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}.card{width:min(92%,440px);background:#151b2f;padding:28px;border-radius:22px;box-shadow:0 20px 60px #0006}h1{margin-top:0}p{color:#b9c1d9;line-height:1.7}input,button{box-sizing:border-box;width:100%;padding:14px;border-radius:12px;font-size:16px}input{background:#0d1325;color:#fff;border:1px solid #303955;margin:12px 0}button{border:0;background:#fff;color:#111;font-weight:700;cursor:pointer}.note{background:#202945;padding:12px;border-radius:12px;margin-bottom:14px}</style></head><body><main class="card"><h1>✨ ImageBoost</h1><p>ربط بوت Telegram بالـWorker. أدخل WEBHOOK_SECRET نفسه المحفوظ في Cloudflare.</p>${note}<form method="post" action="/setup"><input type="password" name="secret" placeholder="WEBHOOK_SECRET" required autocomplete="off"><button type="submit">ربط Telegram</button></form></main></body></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
}
async function setupWebhook(req:Request,e:Env){const form=await req.formData();const secret=String(form.get('secret')||'');if(!secret||secret!==e.WEBHOOK_SECRET)return setupPage('❌ WEBHOOK_SECRET غير صحيح.');const origin=new URL(req.url).origin;const r=await fetch(api(e,'setWebhook'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:`${origin}/telegram`,secret_token:e.WEBHOOK_SECRET,allowed_updates:['message','callback_query']})});const result:any=await r.json();if(!r.ok||!result.ok)return setupPage(`❌ تعذر الربط: ${String(result.description||r.status)}`);return setupPage('✅ تم ربط Telegram بنجاح. افتح البوت وأرسل صورة.');}

export default { async fetch(req:Request,e:Env):Promise<Response>{const u=new URL(req.url);if(u.pathname==='/health')return Response.json({ok:true,service:'ImageBoost Bot',version:'0.4.0'});if(u.pathname==='/setup'&&req.method==='GET')return setupPage();if(u.pathname==='/setup'&&req.method==='POST')return setupWebhook(req,e);if(req.method!=='POST'||u.pathname!=='/telegram')return new Response('ImageBoost Bot v0.4',{status:200});if(req.headers.get('X-Telegram-Bot-Api-Secret-Token')!==e.WEBHOOK_SECRET)return new Response('Forbidden',{status:403});try{const x=await req.json<TgUpdate>();if(x.callback_query)await onCallback(e,x.callback_query);else if(x.message)await onMessage(e,x.message);}catch(err){console.error(err);}return new Response('ok');} };

const { BOT_TOKEN, WEBHOOK_SECRET, WORKER_URL } = process.env;

if (!BOT_TOKEN || !WEBHOOK_SECRET || !WORKER_URL) {
  console.error('Missing BOT_TOKEN, WEBHOOK_SECRET, or WORKER_URL.');
  process.exit(1);
}

const workerUrl = WORKER_URL.replace(/\/$/, '');
const webhookUrl = `${workerUrl}/telegram`;
const endpoint = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`;

const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false
  })
});

const result = await response.json();
if (!response.ok || !result.ok) {
  console.error('Failed to set Telegram webhook:', result);
  process.exit(1);
}

console.log(`Webhook configured: ${webhookUrl}`);

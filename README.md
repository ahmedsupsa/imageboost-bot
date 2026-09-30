# ImageBoost Bot ✨

Open-source Telegram image enhancement bot for Cloudflare Workers — **no AI**.

## v0.2 UI

Send an image and use the Telegram inline interface to choose:

- Upscale: ×2 / ×3 / ×4
- Profile: Photo / Screenshot
- Output: PNG / WebP / JPG
- Enhance / Reset buttons
- Loss-minimizing delivery as a Telegram document
- Temporary per-chat sessions in Cloudflare KV (1 hour)

> ImageBoost enlarges and re-encodes existing pixels. It does not invent missing detail.

## Stack

- Cloudflare Workers
- Cloudflare Images binding
- Cloudflare KV
- Telegram Bot API webhook
- TypeScript

## Deploy

```bash
npm install
npx wrangler kv namespace create SESSIONS
```

Copy the returned KV namespace ID into `wrangler.jsonc`.

Then add secrets:

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
```

Deploy:

```bash
npm run deploy
```

Set the webhook (replace the URL with your deployed `workers.dev` URL):

```bash
BOT_TOKEN="..." WEBHOOK_SECRET="..." WORKER_URL="https://imageboost-bot.<subdomain>.workers.dev" npm run webhook
```

No custom domain is required.

## Endpoints

- `POST /telegram` — Telegram webhook
- `GET /health` — health check

## License

MIT

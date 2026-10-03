# VLESS-WS Relay v4.6 — Render

نسخه Render از همان هسته VLESS + WebSocket نسخه v4.6 استفاده می‌کند.

## Deploy

1. پروژه را به GitHub منتقل کنید یا فایل‌ها را در یک repository قرار دهید.
2. در Render یک **Web Service** بسازید و repository را انتخاب کنید.
3. Runtime: Node
4. Build Command: `npm install`
5. Start Command: `npm start`
6. یک Environment Variable با نام `VLESS_UUID` بسازید و UUID کلاینت را قرار دهید.
7. Render مقدار `PORT` را خودش تعیین می‌کند؛ برنامه روی `0.0.0.0:$PORT` گوش می‌دهد.

## Endpoint

WebSocket endpoint:
`/api/ws`

Health endpoint:
`/api/health`

## v2rayNG

پس از Deploy، hostname سرویس Render را به عنوان Address و SNI/Host استفاده کنید و:

- Port: 443
- Network: WS
- Path: `/api/ws`
- TLS: ON
- Flow: خالی
- UUID: مقدار `VLESS_UUID`

اگر Render یک hostname مانند `example.onrender.com` بدهد، همان hostname برای Address، Host و SNI قابل استفاده است.

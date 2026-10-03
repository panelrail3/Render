# Vercel VLESS WebSocket v4.6

این نسخه برای رفع مشکل قطع/گم‌شدن فریم‌های ابتدایی در اتصال‌های متعدد مرورگر ساخته شده است.

## تغییر اصلی نسبت به v4.5
- هیچ فریم WebSocket هنگام برقراری اتصال TCP دور ریخته نمی‌شود.
- داده‌های اولیه و فریم‌های بعدی تا آماده‌شدن upstream در صف نگه داشته می‌شوند.
- مدیریت retry اتصال TCP و timeout پایدارتر شده است.
- backpressure بین TCP و WebSocket با صف کنترل می‌شود.
- `perMessageDeflate` خاموش است.
- TCP_NODELAY و keepalive فعال است.
- Node.js 22 به‌عنوان runtime هدف استفاده می‌شود.

## Deploy
1. ZIP را extract کنید و کل محتویات را در یک Vercel Project جدید/موجود قرار دهید.
2. Environment Variable زیر را بسازید:
   - `VLESS_UUID` = `d51cad89-5064-4db9-a49e-e09de5254673`
3. Deploy کنید.
4. سلامت سرویس:
   `https://YOUR-DOMAIN/api/health`

## v2rayNG
- Protocol: VLESS
- Address: دامنه Vercel
- Port: 443
- UUID: همان مقدار بالا
- Encryption: none
- Network: WS
- Path: `/api/ws`
- Host: دامنه Vercel
- TLS: ON
- SNI: دامنه Vercel
- ALPN: `http/1.1`
- Fingerprint: chrome
- Flow: خالی

## نکته
این نسخه VLESS + WebSocket است، نه XHTTP. هدف v4.6 ابتدا درست‌کردن مسیر TCP/WS موجود است؛ تبدیل به XHTTP باید با پیاده‌سازی واقعی پروتکل XHTTP انجام شود و صرفاً تغییر نام transport نیست.

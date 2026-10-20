# PS-Cafe — Mobile access over the local network (LAN)

> Arabic-first project doc. This file defines the LAN/mobile contract so the
> phone client, the desktop gateway, and the tests all agree.

## الهدف

فتح نفس بيانات الكافيه من متصفح الموبايل عبر شبكة الواي فاي المحلية —
**بدون إنترنت، وبدون قاعدة بيانات منفصلة**.

## البنية (TypeScript owns logic, Rust owns transport)

- كل منطق العمل (business rules) يبقى في TypeScript:
  `src/domain/*` + `src/repositories/*` + `src/hooks/useCafe.ts` — بدون أي
  تغيير. الموبايل يشغّل **نفس الكود** لأنه نفس الـ bundle.
- الفارق الوحيد هو الـ `DbPort` (`src/db/port.ts`):
  - الديسكتوب: `tauri-plugin-sql` ضد ملف `ps-cafe.db`.
  - الموبايل: `src/db/http.ts` يرسل نفس الـ SQL المُعامَل (parameterized)
    إلى بوابة Rust (`POST /api/select` و `POST /api/execute`).
- Rust (`src-tauri/src/lan/`) مجرد نقل: HTTP + مصادقة + تحقق من الـ Host +
  تقديم الملفات + تنفيذ SQL المسموح به ضد **نفس الملف**
  (`app_config_dir/ps-cafe.db`, وضع WAL) — لا قواعد عمل في Rust.
- الضمانات الصلبة (`uq_open_day`, `uq_active_session_per_station`) يفرضها
  الـ schema نفسه، فتسري على أي عميل يكتب.

## الأمان

1. **الوصول للشبكة ≠ تفويض.** كل `/api/select` و `/api/execute` يتطلب
   `Authorization: Bearer pscafe_…` صادراً من لوحة الإعدادات.
2. التوكن في الـ QR يعيش في **الفراجمنت** (`#k=`) وليس في المسار/الاستعلام،
   ويُخزَّن في `sessionStorage` (وليس `localStorage`) ثم يُمسح من شريط
   العنوان فور الالتقاط.
3. فصل القراءة عن الكتابة: `select` للقراءة فقط، و`execute` يتطلب أيضاً
   تفعيل «السماح للموبايل» من الكمبيوتر (إيقافه يلغي كل التوكنات فوراً).
4. حارس SQL (`src-tauri/src/lan/sql.rs`): جملة واحدة فقط، بلا قيم حرفية
   (كل القيم مربوطة)، بلا `PRAGMA/ATTACH/DROP/CREATE/…`، وجداول التطبيق فقط.
5. تحقق صارم من `Host` (يرفض DNS-rebinding)، ولا توجد CORS headers أبداً
   (نفس الأصل)، وحد أقصى لحجم الطلب 256KB ومهلة 25 ثانية.
6. يُعلَن عنوان **IPv4 خاص فعلي** فقط (10/8، 172.16/12، 192.168/16) —
   لا localhost ولا IP ثابت ولا سيرفر التطوير.

## التشغيل

1. من الإعدادات على الكمبيوتر: فعّل «تشغيل الخادم المحلي».
2. اختر الشبكة إن ظهر أكثر من واحدة، ثم «عرض رمز QR للاقتران».
3. امسح الكود بالموبايل (نفس الواي فاي). التوكن يُلتقط تلقائياً.
4. «إلغاء اقتران كل الأجهزة» أو إيقاف الخادم يُبطل كل الرموز فوراً.

## الاختبارات

- Rust: `cargo test --bin ps-cafe lan::` (عناوين، توكنات، QR، حارس SQL،
  تنفيذ SQLite).
- Frontend: `npx vitest run src/db/http.test.ts src/lan/client.test.ts`.

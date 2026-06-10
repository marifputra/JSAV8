# Panduan Hosting JSA di Niagahoster

Paket ini disiapkan untuk hosting berbayar yang mendukung Node.js App.

## 1. Pastikan Paket Hosting

Sebelum upload, pastikan paket Niagahoster/Hostinger yang dipakai mendukung:

- Node.js Web App
- Environment Variables
- Start command `npm start`

Kalau paket hanya untuk website statis/PHP biasa, backend checkout tidak akan jalan.

## 2. Supabase

Di Supabase SQL Editor, jalankan berurutan:

1. `supabase_schema.sql`
2. `data-produk-import.sql`
3. `supabase_isi_gambar_otomatis.sql`

Kalau ingin cek hasilnya, jalankan juga file bantuan:

```txt
SUPABASE_CEK_DAN_PERBAIKI.sql
```

Hasil normal:

- `products` lebih dari 0
- `categories` lebih dari 0
- function `checkout_jsa` muncul

## 3. Upload ZIP ke Niagahoster

1. Login hPanel Niagahoster.
2. Buka menu Web Apps / Node.js App.
3. Pilih Upload ZIP.
4. Upload file:

```txt
JSA-online-niagahoster-upload.zip
```

5. Jika diminta framework, pilih Node.js / Express / Other.
6. Jika diminta Install Command:

```txt
npm install
```

7. Jika diminta Start Command:

```txt
npm start
```

8. Jika diminta entry file:

```txt
index.js
```

## 4. Environment Variables

Isi environment variables di panel hosting:

```txt
SUPABASE_URL=https://project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=isi_service_role_key_dari_supabase
ADMIN_USERNAME=adminjsa
ADMIN_PASSWORD=ganti_password_admin_yang_kuat
ADMIN_API_TOKEN=ganti_token_rahasia_panjang
ALLOWED_ORIGIN=*
```

Catatan:

- Jangan pakai password `admin123` untuk online.
- Jangan tulis `SUPABASE_SERVICE_ROLE_KEY` di `config.js`.
- `ADMIN_API_TOKEN` isi bebas, tapi panjang dan sulit ditebak.
- Jangan isi `PORT`; Hostinger akan menyediakan `process.env.PORT` otomatis.

## 5. Setelah Online

Buka:

```txt
https://domain-kamu/
```

Halaman admin:

```txt
https://domain-kamu/admin.html
```

Cek API:

```txt
https://domain-kamu/health
```

Kalau `/health` menampilkan JSON, server Node.js sudah hidup.

Cek koneksi API Supabase:

```txt
https://domain-kamu/api/categories
```

Kalau `/api/categories` menampilkan JSON, backend sudah jalan.

## 6. Tes Wajib

1. Login admin.
2. Cek produk muncul.
3. Klik Data Barang.
4. Cek gambar produk.
5. Tambah stok salah satu produk.
6. Login member.
7. Checkout.
8. Pastikan stok berkurang dan order masuk.

## 7. Kalau Error

Produk tidak muncul:

- Cek `SUPABASE_URL`
- Cek `SUPABASE_SERVICE_ROLE_KEY`
- Jalankan ulang SQL Supabase

Admin tidak bisa login:

- Cek `ADMIN_USERNAME`
- Cek `ADMIN_PASSWORD`
- Redeploy/restart app setelah ubah environment variables

Checkout gagal:

- Cek stok barang, jangan 0
- Jalankan ulang `supabase_schema.sql`
- Pastikan function `checkout_jsa` ada

503 Service Unavailable:

- Hapus environment variable `PORT`
- Pastikan entry file `index.js`
- Pastikan start command `npm start`
- Deploy ulang/restart app
- Cek `https://domain-kamu/health`

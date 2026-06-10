JSA Bahasa Sederhana - Versi Online Supabase

Isi folder:
- index.html, admin.html, app.js, style.css: frontend toko.
- server.js: API online untuk produk, member, transaksi, checkout.
- supabase_schema.sql: struktur database dan fungsi checkout aman.
- .env.example: contoh environment variable.

Kenapa versi ini lebih aman untuk online:
- Data disimpan di database Supabase/PostgreSQL.
- Checkout memakai fungsi SQL checkout_jsa().
- Produk yang dibeli dikunci dengan SELECT ... FOR UPDATE saat checkout.
- Halaman member membaca /api/public-state, sementara data penuh tetap di /api/state untuk admin.
- Daftar produk member memakai /api/products dengan pagination, search, kategori, dan merek.
- Harga checkout dihitung ulang di database, bukan dari harga yang dikirim browser.
- Kalau 10 orang checkout barang sama bersamaan, database memproses stok secara transaksional.

Langkah Supabase:
1. Buat project di Supabase.
2. Buka SQL Editor.
3. Jalankan semua isi supabase_schema.sql.
4. Ambil:
   - Project URL
   - service_role key

Environment:
SUPABASE_URL=https://PROJECT_ID.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service_role_key_anda
ADMIN_API_TOKEN=token_admin_opsional_untuk_api_state
ADMIN_USERNAME=admin_baru
ADMIN_PASSWORD=password_admin_baru
MEMBER_ACCOUNTS=[{"username":"member1","password":"member123","name":"Member 1","phone":"0811111111","level":"MEMBER 1"}]
PORT=4173

Jalankan lokal:
1. Salin .env.example menjadi .env, lalu isi.
2. Di terminal:
   export SUPABASE_URL="https://PROJECT_ID.supabase.co"
   export SUPABASE_SERVICE_ROLE_KEY="service_role_key_anda"
   node server.js
3. Buka:
   http://localhost:4173
   http://localhost:4173/admin.html

Deploy:
- Render/Railway/Fly.io bisa menjalankan:
  node server.js
- Set environment variable di dashboard hosting.
- Jangan taruh service_role key di frontend.

Import data awal:
1. Jalankan server online/lokal.
2. Buka admin.html.
3. Login admin.
4. Sistem akan mengirim data produk/kategori dari browser ke Supabase saat admin melakukan perubahan.
5. Cara paling rapi: gunakan tab Backup Data untuk export dari versi lama, lalu import di versi online.

Catatan keamanan:
- Login admin/member di frontend masih sederhana dan perlu tahap lanjutan untuk produksi serius.
- Untuk toko online publik, tahap berikutnya adalah membuat login backend/session, bukan password di JavaScript.
- Service role key hanya boleh ada di server hosting, tidak boleh dibagikan.
- Jika ADMIN_API_TOKEN diisi, request baca/tulis data penuh ke /api/state harus membawa header X-Admin-Token.
- Untuk produksi, isi ADMIN_USERNAME dan ADMIN_PASSWORD di environment hosting, jangan pakai demo admin/admin123.
- MEMBER_ACCOUNTS bisa diisi JSON array untuk akun member. Untuk sistem besar, tahap berikutnya adalah tabel akun member dan password hash.
- Halaman member tidak lagi memuat semua produk sekaligus; produk dimuat per halaman dari database.
- Harga tetap mengikuti akun member yang login, misalnya member1/member2/member3.
- Saat checkout, pembeli wajib mengisi nama dan nomor telepon untuk identifikasi order.
- Nomor telepon disimpan sebagai identitas pelanggan untuk mengelompokkan riwayat belanja di admin.

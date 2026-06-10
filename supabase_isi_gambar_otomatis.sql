-- Isi URL gambar otomatis untuk produk yang belum punya gambar.
-- Jalankan di Supabase SQL Editor setelah data produk masuk.

update products
set img =
  'https://placehold.co/600x400/' ||
  case
    when category in ('Minuman', 'Minuman Instant') then 'd8f5ff/123243'
    when category in ('Makanan', 'Makanan Instant') then 'fff2cf/4a2f00'
    when category = 'Snack' then 'ffe4e6/7f1d1d'
    when category = 'Sembako' then 'e8f5e9/163b20'
    when category in ('Bumbu', 'Kecap') then 'fff0db/5b2d08'
    when category = 'Saos' then 'ffe1df/7c1b16'
    when category in ('Tepung', 'Bahan Kue') then 'f4f0e8/3f3529'
    when category = 'SUSU' then 'edf7ff/173a5e'
    when category = 'Rokok' then 'e9eef2/172a35'
    when category = 'Obat-obatan' then 'eef7ff/163a5f'
    when category = 'Kosmetik' then 'fde7f3/6b1b46'
    when category = 'Detergen' then 'e8f7ff/17475f'
    when category = 'Peralatan' then 'eef2f7/263443'
    when category = 'Popok' then 'f0e9ff/3f2366'
    when category = 'Permen' then 'ffe8f0/7a1740'
    when category = 'Roti' then 'fff0dc/5a3211'
    else 'eefbff/123243'
  end ||
  '?text=' ||
  replace(
    left(
      regexp_replace(coalesce(nullif(brand, ''), nullif(sub, ''), nullif(category, ''), 'Produk'), '[^A-Za-z0-9 ]', '', 'g'),
      28
    ),
    ' ',
    '%20'
  )
where img is null or trim(img) = '';

select count(*) as produk_sudah_punya_gambar
from products
where img is not null and trim(img) <> '';

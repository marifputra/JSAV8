create table if not exists categories (
  id bigserial primary key,
  name text not null unique,
  subs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists products (
  id bigint primary key,
  name text not null,
  brand text,
  category text not null,
  sub text not null,
  big_unit text not null default 'karton',
  small_unit text not null default 'pcs',
  content_per_big numeric not null default 1,
  stock_small numeric not null default 0,
  cost numeric not null default 0,
  price_small numeric not null default 0,
  price_big numeric not null default 0,
  price_member1_small numeric not null default 0,
  price_member1_big numeric not null default 0,
  price_member2_small numeric not null default 0,
  price_member2_big numeric not null default 0,
  threshold_small numeric not null default 5,
  img text,
  updated_at timestamptz not null default now()
);

create index if not exists products_search_idx on products using gin (
  to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(category,'') || ' ' || coalesce(sub,''))
);
create index if not exists products_category_idx on products (category);
create index if not exists products_brand_idx on products (brand);
create index if not exists products_category_brand_idx on products (category, brand);

create table if not exists members (
  username text primary key,
  name text not null,
  phone text,
  level text,
  joined_at text,
  updated_at timestamptz not null default now()
);

create table if not exists orders (
  id bigserial primary key,
  date text not null,
  member_name text not null,
  member_phone text,
  member_level text,
  total numeric not null default 0,
  modal numeric not null default 0,
  profit numeric not null default 0,
  points integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists order_items (
  id bigserial primary key,
  order_id bigint not null references orders(id) on delete cascade,
  product_id bigint,
  name text not null,
  sale_type text,
  display_qty numeric not null default 0,
  display_unit text,
  display_price numeric not null default 0,
  qty_small numeric not null default 0,
  small_unit text,
  price_small numeric not null default 0,
  cost_small numeric not null default 0,
  subtotal numeric not null default 0,
  modal numeric not null default 0,
  profit numeric not null default 0
);

create or replace function checkout_jsa(member_data jsonb, cart_data jsonb)
returns jsonb
language plpgsql
as $$
declare
  item jsonb;
  p products%rowtype;
  stock_check record;
  new_order_id bigint;
  order_total numeric := 0;
  order_modal numeric := 0;
  item_sale_type text;
  item_display_qty numeric;
  item_display_unit text;
  item_display_price numeric;
  item_qty_small numeric;
  item_subtotal numeric;
  item_modal numeric;
  items_result jsonb := '[]'::jsonb;
begin
  if member_data is null then
    raise exception 'Silakan login member dulu.';
  end if;

  if cart_data is null or jsonb_array_length(cart_data) = 0 then
    raise exception 'Keranjang kosong.';
  end if;

  for item in select * from jsonb_array_elements(cart_data)
  loop
    select * into p
    from products
    where id = (item->>'id')::bigint
    for update;

    if not found then
      raise exception 'Produk % sudah dihapus admin.', coalesce(item->>'name', item->>'id');
    end if;

    item_sale_type := coalesce(item->>'saleType', 'kecil');
    item_display_qty := coalesce((item->>'displayQty')::numeric, 0);

    if item_display_qty <= 0 then
      raise exception 'Jumlah produk % tidak valid.', p.name;
    end if;

    if item_sale_type = 'besar' then
      item_qty_small := item_display_qty * p.content_per_big;
    elsif item_sale_type = 'kecil' then
      item_qty_small := item_display_qty;
    else
      raise exception 'Jenis pembelian produk % tidak valid.', p.name;
    end if;

    if item_qty_small > p.stock_small then
      raise exception 'Stok % tidak cukup. Tersedia % %.', p.name, p.stock_small, p.small_unit;
    end if;
  end loop;

  for stock_check in
    select
      locked_products.id as product_id,
      sum(
        case
          when coalesce(cart_item.item->>'saleType', 'kecil') = 'besar'
            then coalesce((cart_item.item->>'displayQty')::numeric, 0) * locked_products.content_per_big
          else coalesce((cart_item.item->>'displayQty')::numeric, 0)
        end
      ) as qty_small
    from jsonb_array_elements(cart_data) as cart_item(item)
    join products locked_products on locked_products.id = (cart_item.item->>'id')::bigint
    group by locked_products.id
  loop
    select * into p
    from products
    where id = stock_check.product_id
    for update;

    if stock_check.qty_small > p.stock_small then
      raise exception 'Stok % tidak cukup. Tersedia % %.', p.name, p.stock_small, p.small_unit;
    end if;
  end loop;

  insert into members (username, name, phone, level, joined_at, updated_at)
  values (
    coalesce(nullif(member_data->>'username', ''), nullif(member_data->>'phone', ''), member_data->>'name'),
    coalesce(member_data->>'name', ''),
    coalesce(member_data->>'phone', ''),
    coalesce(member_data->>'level', 'MEMBER 3'),
    coalesce(member_data->>'joinedAt', to_char(now(), 'DD/MM/YYYY HH24:MI:SS')),
    now()
  )
  on conflict (username) do update
  set name = excluded.name,
      phone = excluded.phone,
      level = excluded.level,
      updated_at = now();

  insert into orders (
    date, member_name, member_phone, member_level,
    total, modal, profit, points
  ) values (
    to_char(now(), 'DD/MM/YYYY HH24:MI:SS'),
    member_data->>'name',
    member_data->>'phone',
    member_data->>'level',
    0,
    0,
    0,
    0
  )
  returning id into new_order_id;

  for item in select * from jsonb_array_elements(cart_data)
  loop
    select * into p
    from products
    where id = (item->>'id')::bigint
    for update;

    item_sale_type := coalesce(item->>'saleType', 'kecil');
    item_display_qty := coalesce((item->>'displayQty')::numeric, 0);

    if item_sale_type = 'besar' then
      item_qty_small := item_display_qty * p.content_per_big;
      item_display_unit := p.big_unit;
      item_display_price := case
        when member_data->>'level' = 'MEMBER 1' and p.price_member1_big > 0 then p.price_member1_big
        when member_data->>'level' = 'MEMBER 2' and p.price_member2_big > 0 then p.price_member2_big
        else p.price_big
      end;
    else
      item_qty_small := item_display_qty;
      item_display_unit := p.small_unit;
      item_display_price := case
        when member_data->>'level' = 'MEMBER 1' and p.price_member1_small > 0 then p.price_member1_small
        when member_data->>'level' = 'MEMBER 2' and p.price_member2_small > 0 then p.price_member2_small
        else p.price_small
      end;
    end if;

    update products
    set stock_small = stock_small - item_qty_small,
        updated_at = now()
    where id = p.id;

    item_subtotal := item_display_price * item_display_qty;
    item_modal := p.cost * item_qty_small;
    order_total := order_total + item_subtotal;
    order_modal := order_modal + item_modal;

    insert into order_items (
      order_id, product_id, name, sale_type, display_qty, display_unit,
      display_price, qty_small, small_unit, price_small, cost_small,
      subtotal, modal, profit
    ) values (
      new_order_id,
      p.id,
      p.name,
      item_sale_type,
      item_display_qty,
      item_display_unit,
      item_display_price,
      item_qty_small,
      p.small_unit,
      p.price_small,
      p.cost,
      item_subtotal,
      item_modal,
      item_subtotal - item_modal
    );

    items_result := items_result || jsonb_build_array(jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'saleType', item_sale_type,
      'displayQty', item_display_qty,
      'displayUnit', item_display_unit,
      'displayPrice', item_display_price,
      'qtySmall', item_qty_small,
      'smallUnit', p.small_unit,
      'priceSmall', p.price_small,
      'costSmall', p.cost,
      'subtotal', item_subtotal,
      'modal', item_modal,
      'profit', item_subtotal - item_modal
    ));
  end loop;

  update orders
  set total = order_total,
      modal = order_modal,
      profit = order_total - order_modal,
      points = floor(order_total / 100000)
  where id = new_order_id;

  return jsonb_build_object(
    'id', new_order_id,
    'date', to_char(now(), 'DD/MM/YYYY HH24:MI:SS'),
    'memberName', member_data->>'name',
    'memberPhone', member_data->>'phone',
    'memberLevel', member_data->>'level',
    'items', items_result,
    'total', order_total,
    'modal', order_modal,
    'profit', order_total - order_modal,
    'points', floor(order_total / 100000)
  );
end;
$$;

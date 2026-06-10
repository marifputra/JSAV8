const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || '';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_SESSION_TTL_MS = Number(process.env.ADMIN_SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const MEMBER_ACCOUNTS = safeJsonParse(process.env.MEMBER_ACCOUNTS || 'null', null) || [
  { username:'member1', password:'member123', name:'Member 1', phone:'0811111111', level:'MEMBER 1' },
  { username:'member2', password:'member123', name:'Member 2', phone:'0822222222', level:'MEMBER 2' },
  { username:'member3', password:'member123', name:'Member 3', phone:'0833333333', level:'MEMBER 3' }
];
const rateBuckets = new Map();
const adminSessions = new Map();
const BAHAN_POKOK_CATEGORIES = [
  'Sembako', 'Bahan Pokok', 'Bahan Kue', 'Bumbu', 'Garam', 'Kacang',
  'Kecap', 'Makanan', 'Makanan Instant', 'Minyak', 'Penyedap',
  'Saos', 'Tepung', 'SUSU'
];

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

function requireConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi.');
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token, Authorization'
  });
  res.end(JSON.stringify(body));
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10_000_000) {
        reject(new Error('Body terlalu besar'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(safeJsonParse(body || '{}', {})));
    req.on('error', reject);
  });
}

function createAdminSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  adminSessions.set(token, expiresAt);
  return { token, expiresAt };
}

function pruneAdminSessions() {
  const now = Date.now();
  for (const [token, expiresAt] of adminSessions.entries()) {
    if (expiresAt <= now) adminSessions.delete(token);
  }
}

function adminTokenFromReq(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(req.headers['x-admin-token'] || '').trim();
}

function hasAdminAccess(req) {
  pruneAdminSessions();
  const token = adminTokenFromReq(req);
  if (!token) return false;
  if (ADMIN_API_TOKEN && token === ADMIN_API_TOKEN) return true;
  const expiresAt = adminSessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

function cleanInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function encodeFilterValue(value) {
  return encodeURIComponent(String(value || '').replaceAll('"', '\\"'));
}

function encodeInList(values) {
  return values.map(value => `"${String(value || '').replaceAll('"', '\\"')}"`).join(',');
}

function publicMember(m) {
  return {
    id: m.username,
    username: m.username,
    name: m.name,
    phone: m.phone,
    level: m.level || 'MEMBER',
    joinedAt: new Date().toLocaleString('id-ID')
  };
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local').split(',')[0].trim();
}

function checkRateLimit(req, key, maxHits, windowMs) {
  const now = Date.now();
  const bucketKey = `${key}:${clientIp(req)}`;
  const bucket = rateBuckets.get(bucketKey) || { hits: 0, resetAt: now + windowMs };
  if (now > bucket.resetAt) {
    bucket.hits = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.hits += 1;
  rateBuckets.set(bucketKey, bucket);
  return bucket.hits <= maxHits;
}

async function sb(pathname, options = {}) {
  requireConfig();
  const res = await fetch(`${SUPABASE_URL}/rest/v1${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  const json = text ? safeJsonParse(text, text) : null;
  if (!res.ok) {
    const message = typeof json === 'string' ? json : (json.message || JSON.stringify(json));
    throw new Error(message);
  }
  return json;
}

async function sbAll(pathname, pageSize = 1000) {
  const all = [];
  let offset = 0;
  while (true) {
    const separator = pathname.includes('?') ? '&' : '?';
    const page = await sb(`${pathname}${separator}limit=${pageSize}&offset=${offset}`);
    if (!Array.isArray(page) || !page.length) break;
    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function sbWithMeta(pathname, options = {}) {
  requireConfig();
  const res = await fetch(`${SUPABASE_URL}/rest/v1${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'count=exact',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  const json = text ? safeJsonParse(text, text) : null;
  if (!res.ok) {
    const message = typeof json === 'string' ? json : (json.message || JSON.stringify(json));
    throw new Error(message);
  }
  const range = res.headers.get('content-range') || '';
  const total = Number(range.split('/')[1] || 0);
  return { data: json || [], total: Number.isFinite(total) ? total : 0 };
}

async function sbDelete(pathname) {
  return sb(pathname, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });
}

async function rpc(name, body) {
  requireConfig();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  const json = text ? safeJsonParse(text, text) : null;
  if (!res.ok) {
    const message = typeof json === 'string' ? json : (json.message || JSON.stringify(json));
    throw new Error(message);
  }
  return json;
}

function toDbProduct(p) {
  return {
    id: Number(p.id),
    name: p.name || '',
    brand: p.brand || '',
    category: p.category || 'Umum',
    sub: p.sub || 'Umum',
    big_unit: p.bigUnit || 'karton',
    small_unit: p.smallUnit || 'pcs',
    content_per_big: Number(p.contentPerBig || 1),
    stock_small: Number(p.stockSmall || 0),
    cost: Number(p.cost || 0),
    price_small: Number(p.priceSmall || 0),
    price_big: Number(p.priceBig || 0),
    price_member1_small: Number(p.priceMember1Small || 0),
    price_member1_big: Number(p.priceMember1Big || 0),
    price_member2_small: Number(p.priceMember2Small || 0),
    price_member2_big: Number(p.priceMember2Big || 0),
    threshold_small: Number(p.thresholdSmall ?? 5),
    img: p.img || ''
  };
}

function fromDbProduct(p) {
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    sub: p.sub,
    bigUnit: p.big_unit,
    smallUnit: p.small_unit,
    contentPerBig: Number(p.content_per_big || 1),
    stockSmall: Number(p.stock_small || 0),
    cost: Number(p.cost || 0),
    priceSmall: Number(p.price_small || 0),
    priceBig: Number(p.price_big || 0),
    priceMember1Small: Number(p.price_member1_small || 0),
    priceMember1Big: Number(p.price_member1_big || 0),
    priceMember2Small: Number(p.price_member2_small || 0),
    priceMember2Big: Number(p.price_member2_big || 0),
    thresholdSmall: Number(p.threshold_small ?? 5),
    img: p.img || ''
  };
}

function fromDbPublicProduct(p) {
  const product = fromDbProduct(p);
  delete product.cost;
  return product;
}

function toDbMember(m) {
  return {
    username: m.username || m.id || m.name,
    name: m.name || '',
    phone: m.phone || '',
    level: m.level || 'MEMBER',
    joined_at: m.joinedAt || ''
  };
}

function toDbOrder(o) {
  return {
    id: Number(o.id),
    date: o.date || new Date().toLocaleString('id-ID'),
    member_name: o.memberName || '',
    member_phone: o.memberPhone || '',
    member_level: o.memberLevel || 'MEMBER',
    total: Number(o.total || 0),
    modal: Number(o.modal || 0),
    profit: Number(o.profit || 0),
    points: Number(o.points || 0)
  };
}

function toDbOrderItem(orderId, item) {
  return {
    order_id: Number(orderId),
    product_id: item.id ? Number(item.id) : null,
    name: item.name || '',
    sale_type: item.saleType || '',
    display_qty: Number(item.displayQty || item.qty || 0),
    display_unit: item.displayUnit || item.smallUnit || '',
    display_price: Number(item.displayPrice || item.price || 0),
    qty_small: Number(item.qtySmall || item.qty || 0),
    small_unit: item.smallUnit || '',
    price_small: Number(item.priceSmall || 0),
    cost_small: Number(item.costSmall || 0),
    subtotal: Number(item.subtotal || 0),
    modal: Number(item.modal || 0),
    profit: Number(item.profit || 0)
  };
}

function idsForFilter(ids) {
  return ids.map(id => String(id).replace(/[^0-9]/g, '')).filter(Boolean).join(',');
}

function fromDbOrder(order, items) {
  return {
    id: order.id,
    date: order.date,
    memberName: order.member_name,
    memberPhone: order.member_phone,
    memberLevel: order.member_level,
    items: items.filter(i => String(i.order_id) === String(order.id)).map(i => ({
      id: i.product_id,
      name: i.name,
      saleType: i.sale_type,
      displayQty: Number(i.display_qty || 0),
      displayUnit: i.display_unit,
      displayPrice: Number(i.display_price || 0),
      qtySmall: Number(i.qty_small || 0),
      smallUnit: i.small_unit,
      priceSmall: Number(i.price_small || 0),
      costSmall: Number(i.cost_small || 0),
      subtotal: Number(i.subtotal || 0),
      modal: Number(i.modal || 0),
      profit: Number(i.profit || 0)
    })),
    total: Number(order.total || 0),
    modal: Number(order.modal || 0),
    profit: Number(order.profit || 0),
    points: Number(order.points || 0)
  };
}

async function getState() {
  const [products, categories, members, orders, items] = await Promise.all([
    sbAll('/products?select=*&order=id.asc'),
    sb('/categories?select=*&order=name.asc'),
    sb('/members?select=*&order=username.asc'),
    sb('/orders?select=*&order=id.desc'),
    sb('/order_items?select=*&order=id.asc')
  ]);

  return {
    products: products.map(fromDbProduct),
    categories: categories.map(c => ({ name: c.name, subs: Array.isArray(c.subs) ? c.subs : [] })),
    members: members.map(m => ({
      username: m.username,
      id: m.username,
      name: m.name,
      phone: m.phone,
      level: m.level,
      joinedAt: m.joined_at
    })),
    orders: orders.map(o => fromDbOrder(o, items))
  };
}

async function getPublicState() {
  const [categories] = await Promise.all([
    sb('/categories?select=*&order=name.asc')
  ]);

  return {
    products: [],
    categories: categories.map(c => ({ name: c.name, subs: Array.isArray(c.subs) ? c.subs : [] }))
  };
}

async function getPublicProducts(req) {
  const url = new URL(req.url, 'http://localhost');
  const page = cleanInt(url.searchParams.get('page'), 1, 1, 100000);
  const limit = cleanInt(url.searchParams.get('limit'), 60, 1, 100);
  const offset = (page - 1) * limit;
  const q = String(url.searchParams.get('q') || '').trim();
  const category = String(url.searchParams.get('category') || '').trim();
  const brand = String(url.searchParams.get('brand') || '').trim();

  const params = [
    'select=*',
    'order=id.asc',
    `limit=${limit}`,
    `offset=${offset}`
  ];

  if (category && category !== 'Semua') {
    if (category === 'Bahan Pokok') params.push(`category=in.(${encodeURIComponent(encodeInList(BAHAN_POKOK_CATEGORIES))})`);
    else params.push(`category=eq.${encodeFilterValue(category)}`);
  }
  if (brand && brand !== 'Semua') params.push(`brand=eq.${encodeFilterValue(brand)}`);
  if (q) {
    const like = encodeURIComponent(`*${q.replace(/[(),]/g, ' ')}*`);
    params.push(`or=(name.ilike.${like},brand.ilike.${like},category.ilike.${like},sub.ilike.${like})`);
  }

  const result = await sbWithMeta(`/products?${params.join('&')}`);

  return {
    products: result.data.map(fromDbPublicProduct),
    page,
    limit,
    total: result.total
  };
}

async function getPublicCategories() {
  const [categories, products] = await Promise.all([
    sb('/categories?select=*&order=name.asc'),
    sbAll('/products?select=category,brand&order=category.asc')
  ]);

  return {
    categories: categories.map(c => ({ name: c.name, subs: Array.isArray(c.subs) ? c.subs : [] })),
    productCategories: ['Semua', ...new Set(products.map(p => p.category).filter(Boolean))],
    brands: ['Semua', ...new Set(products.map(p => p.brand).filter(Boolean))].sort((a,b) => a === 'Semua' ? -1 : b === 'Semua' ? 1 : a.localeCompare(b))
  };
}

async function upsertState(body) {
  if (Array.isArray(body.products)) {
    await sb('/products?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(body.products.map(toDbProduct))
    });
  }

  if (Array.isArray(body.categories)) {
    await sb('/categories?on_conflict=name', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(body.categories.map(c => ({ name: c.name, subs: c.subs || ['Umum'] })))
    });
  }

  if (Array.isArray(body.members)) {
    const members = body.members.map(toDbMember).filter(m => m.username);
    if (!members.length) await sbDelete('/members?username=not.is.null');

    if (members.length) {
      await sb('/members?on_conflict=username', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(members)
      });
    }
  }

  if (Array.isArray(body.orders)) {
    if (!body.orders.length) {
      await sbDelete('/order_items?id=not.is.null');
      await sbDelete('/orders?id=not.is.null');
    } else {
      const orderIds = idsForFilter(body.orders.map(o => o.id));
      await sbDelete(`/order_items?order_id=not.in.(${orderIds})`);
      await sbDelete(`/orders?id=not.in.(${orderIds})`);
      await sb('/orders?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(body.orders.map(toDbOrder))
      });

      const items = body.orders.flatMap(o => (o.items || []).map(item => toDbOrderItem(o.id, item)));
      await sbDelete(`/order_items?order_id=in.(${orderIds})`);
      if (items.length) {
        await sb('/order_items', {
          method: 'POST',
          body: JSON.stringify(items)
        });
      }
    }
  }

  return getState();
}

async function handleApi(req, res) {
  if (req.method === 'GET' && req.url === '/api/public-state') {
    return sendJson(res, 200, await getPublicState());
  }

  if (req.method === 'GET' && req.url.startsWith('/api/products')) {
    return sendJson(res, 200, await getPublicProducts(req));
  }

  if (req.method === 'GET' && req.url === '/api/categories') {
    return sendJson(res, 200, await getPublicCategories());
  }

  if (req.method === 'POST' && req.url === '/api/member-login') {
    if (!checkRateLimit(req, 'member-login', 20, 60_000)) {
      return sendJson(res, 429, { ok: false, error: 'Terlalu banyak percobaan login. Coba lagi sebentar.' });
    }
    const body = await readBody(req);
    const account = MEMBER_ACCOUNTS.find(m => m.username === body.username && m.password === body.password);
    if (!account) return sendJson(res, 401, { ok: false, error: 'Username atau password member salah.' });
    return sendJson(res, 200, { ok: true, member: publicMember(account) });
  }

  if (req.method === 'POST' && req.url === '/api/admin-login') {
    if (!checkRateLimit(req, 'admin-login', 10, 60_000)) {
      return sendJson(res, 429, { ok: false, error: 'Terlalu banyak percobaan login. Coba lagi sebentar.' });
    }
    const body = await readBody(req);
    if (body.username !== ADMIN_USERNAME || body.password !== ADMIN_PASSWORD) {
      return sendJson(res, 401, { ok: false, error: 'Login salah' });
    }
    return sendJson(res, 200, { ok: true, ...createAdminSession() });
  }

  if (req.method === 'GET' && req.url === '/api/state') {
    if (!hasAdminAccess(req)) {
      return sendJson(res, 401, { ok: false, error: 'Akses admin ditolak.' });
    }
    return sendJson(res, 200, await getState());
  }

  if (req.method === 'POST' && req.url === '/api/state') {
    if (!hasAdminAccess(req)) {
      return sendJson(res, 401, { ok: false, error: 'Akses admin ditolak.' });
    }
    const body = await readBody(req);
    return sendJson(res, 200, { ok: true, state: await upsertState(body) });
  }

  if (req.method === 'POST' && req.url === '/api/checkout') {
    if (!checkRateLimit(req, 'checkout', 30, 60_000)) {
      return sendJson(res, 429, { ok: false, error: 'Terlalu banyak checkout. Coba lagi sebentar.' });
    }
    const body = await readBody(req);
    try {
      const order = await rpc('checkout_jsa', {
        member_data: body.member,
        cart_data: body.cart || []
      });
      return sendJson(res, 200, { ok: true, order, state: await getState() });
    } catch (err) {
      return sendJson(res, 409, { ok: false, error: err.message });
    }
  }

  sendJson(res, 404, { ok: false, error: 'API tidak ditemukan' });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const clean = path.normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(ROOT, clean);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

function appHandler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token, Authorization'
  });
    res.end();
    return;
  }

  if (req.url === '/health' || req.url === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      app: 'JSA online',
      supabaseConfigured: !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
    });
  }

  if (req.url.startsWith('/api/')) {
    handleApi(req, res).catch(err => sendJson(res, 500, { ok: false, error: err.message }));
    return;
  }
  serveStatic(req, res);
}

if (require.main === module) {
  const server = http.createServer(appHandler);
  server.on('error', err => {
    console.error('JSA server gagal start:', err);
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    console.log(`JSA online server berjalan di ${HOST}:${PORT}`);
  });
}

module.exports = {
  appHandler,
  handleApi,
  sendJson
};

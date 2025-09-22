const pool = require('../services/db');
const { getConfig, cleanText, toInt, clamp, getSession, formatRp } = require('../utils');


// --- helpers lokal untuk broadcast (hindari crash & rate limit) ---
function fitTelegramText(input, limit = 4000) {
  // Telegram limit text 4096, sisakan margin
  const s = String(input || '').trim();
  return s.length > limit ? s.slice(0, limit) : s;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ===== Guard admin =====
const admins = new Set(getConfig().adminUserIds);
function guard(ctx) {
  if (!admins.has(ctx.from.id)) {
    ctx.reply('Menu khusus admin.');
    return false;
  }
  return true;
}

// ===== Helpers parsing stok terstruktur (tanpa deskripsi) =====
function detectDelimiter(line) {
  if (line.includes('|')) return '|';
  if (line.includes(';')) return ';';
  if (line.includes(',')) return ',';
  return null;
}

function looksLikeHeader(cols) {
  const keys = cols.map((c) => c.trim().toLowerCase());
  return keys.includes('email');
}

function mapRowToFields(cols, header) {
  const pickByDefault = { email: 0, password: 1, pin: 2, profil: 3 };
  const pick = (key) => {
    if (header) {
      const i = header.indexOf(key);
      return i >= 0 ? (cols[i] ?? '').trim() : '';
    }
    return (cols[pickByDefault[key]] ?? '').trim();
  };
  return {
    email: pick('email'),
    password: pick('password'),
    pin: pick('pin'),
    profil: pick('profil'),
  };
}

function normalizeStockLine(line) {
  return (line ?? '').replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
}

function validateStockObj(o) {
  const emailOk = !!o.email && /@/.test(o.email);
  return emailOk;
}

function stockObjToJson(o) {
  return JSON.stringify({
    email: o.email,
    password: o.password || '',
    pin: o.pin || '',
    profil: o.profil || '',
    v: 2,
  });
}

function jsonOrRawToPretty(content) {
  try {
    const obj = JSON.parse(content);
    if (obj && typeof obj === 'object' && (obj.email || obj.password || obj.pin || obj.profil)) {
      const lines = [];
      if (obj.email) lines.push(`Email: ${obj.email}`);
      if (obj.password) lines.push(`Password: ${obj.password}`);
      if (obj.pin) lines.push(`PIN: ${obj.pin}`);
      if (obj.profil) lines.push(`Profil: ${obj.profil}`);
      return lines.join('\n');
    }
  } catch (_) { /* not JSON */ }
  return content;
}

// ===== Masuk ke "mode" admin dari tombol/teks =====
exports.enterMode = async (ctx, mode) => {
  if (!guard(ctx)) return;
  const s = getSession(ctx.from.id);
  s.admin = s.admin || {};
  s.admin.mode = mode;

  const hints = {
    ADMIN_ADDSALDO: 'Kirim: userId spasi jumlah. Contoh: 12345678 20000',
    ADMIN_MINSALDO: 'Kirim: userId spasi jumlah. Contoh: 12345678 10000',

    ADMIN_ADDPRODUK:
`Kirim: KODE|Nama|Harga|Deskripsi
Contoh: NET1|NETFLIX 1 BULAN|20000|GARANSI`,

    ADMIN_DELPRODUK: 'Kirim: KODE. Contoh: NET1',

    ADMIN_ADDSTOK:
`Kirim multi-baris:
BARIS-1: KODE
BARIS-2 (opsional): header "email,password,pin,profil"
BARIS-3 dst: data stok (delimiter: "|" atau ";" atau ",")
Minimal kolom: email`,

    ADMIN_AMBILSTOK: 'Kirim: KODE spasi jumlah(opsional). Contoh: NET1 2',
    ADMIN_SETDESK: 'Kirim: KODE spasi deskripsi baru',
    ADMIN_SETHARGA: 'Kirim: KODE spasi hargaBaru. Contoh: NET1 25000',
    ADMIN_SETNAMA: 'Kirim: KODE spasi Nama Baru',
    ADMIN_SETKODE: 'Kirim: KODE_LAMA spasi KODE_BARU',
    // <= NOTE boleh multiline/copy-paste
    ADMIN_SETNOTE: 'Kirim: KODE spasi NOTE (boleh multi-baris / copy-paste).',
    ADMIN_PROMOSI: 'Kirim teks broadcast publik.',
    ADMIN_PROMOSI2: 'Kirim teks broadcast (varian 2).',
    ADMIN_DELUSER: 'Kirim: userId. Contoh: 12345678'
  };

  await ctx.reply(`Mode: ${mode.replace('ADMIN_','')}\n${hints[mode] || ''}`);
};

// ===== Router teks admin =====
exports.textRouter = async (ctx, next) => {
  const s = getSession(ctx.from.id);

  const t = (ctx.message?.text || '').trim();
  if (/^(List Produk|Batal|⬅️ Kembali ke Daftar)$/i.test(t)) {
    s.admin = null;
    return next();
  }

  if (!s.admin || !s.admin.mode) return next();

  const mode = s.admin.mode;
  try {
    switch (mode) {
      case 'ADMIN_ADDSALDO':      return addSaldoFlow(ctx);
      case 'ADMIN_MINSALDO':      return minSaldoFlow(ctx);
      case 'ADMIN_ADDPRODUK':     return addProdukFlow(ctx);
      case 'ADMIN_DELPRODUK':     return delProdukFlow(ctx);
      case 'ADMIN_ADDSTOK':       return addStokFlow(ctx);
      case 'ADMIN_AMBILSTOK':     return ambilStokFlow(ctx);
      case 'ADMIN_SETDESK':       return setDeskFlow(ctx);
      case 'ADMIN_SETHARGA':      return setHargaFlow(ctx);
      case 'ADMIN_SETNAMA':       return setNamaFlow(ctx);
      case 'ADMIN_SETKODE':       return setKodeFlow(ctx);
      case 'ADMIN_SETNOTE':       return setNoteFlow(ctx);
      case 'ADMIN_PROMOSI':       return broadcastFlow(ctx, false);
      case 'ADMIN_PROMOSI2':      return broadcastFlow(ctx, true);
      case 'ADMIN_DELUSER':       return delUserFlow(ctx);
      default: s.admin.mode = null; return next();
    }
  } catch (e) {
    console.error(e);
    s.admin.mode = null;
    return ctx.reply('Gagal memproses perintah admin.');
  }
};

// ===== Implementasi masing-masing flow =====
async function addSaldoFlow(ctx) {
  if (!guard(ctx)) return;
  const [uidRaw, amtRaw] = ctx.message.text.trim().split(/\s+/);
  const uid = toInt(uidRaw, 0);
  const amount = clamp(toInt(amtRaw, 0), 1, 1_000_000_000);
  if (!uid || !amount) return ctx.reply('Format salah. Contoh: 12345678 20000');
  await pool.query('UPDATE users SET balance=balance+? WHERE id=?', [amount, uid]);
  getSession(ctx.from.id).admin.mode = null;
  await ctx.reply(`Saldo user ${uid} ditambah ${formatRp(amount)}.`);
}

async function minSaldoFlow(ctx) {
  if (!guard(ctx)) return;
  const [uidRaw, amtRaw] = ctx.message.text.trim().split(/\s+/);
  const uid = toInt(uidRaw, 0);
  const amount = clamp(toInt(amtRaw, 0), 1, 1_000_000_000);
  if (!uid || !amount) return ctx.reply('Format salah. Contoh: 12345678 10000');
  await pool.query('UPDATE users SET balance=GREATEST(balance-?,0) WHERE id=?', [amount, uid]);
  getSession(ctx.from.id).admin.mode = null;
  await ctx.reply(`Saldo user ${uid} dikurangi ${formatRp(amount)}.`);
}

async function addProdukFlow(ctx) {
  if (!guard(ctx)) return;
  const parts = ctx.message.text.split('|').map((s) => cleanText(s, 2000));
  const [code, name, priceRaw, ...descArr] = parts;
  const price = clamp(toInt(priceRaw, 0), 1, 1_000_000_000);
  const description = (descArr.join('|') || '').trim();

  if (!code || !name || !price || !description) {
    return ctx.reply('Format: KODE|Nama|Harga|Deskripsi (semua wajib). Contoh: NET1|NETFLIX 1 BULAN|20000|GARANSI');
  }

  await pool.query(
    'INSERT INTO products(code,name,price,description) VALUES (?,?,?,?)',
    [code.toUpperCase(), name, price, description.slice(0, 2000)]
  );
  getSession(ctx.from.id).admin.mode = null;
  await ctx.reply('Produk ditambahkan.');
}

async function delProdukFlow(ctx) {
  if (!guard(ctx)) return;
  const code = cleanText(ctx.message.text || '', 64).toUpperCase();
  if (!code) return ctx.reply('Kirim KODE.');
  await pool.query('DELETE FROM products WHERE code=?', [code]);
  getSession(ctx.from.id).admin.mode = null;
  await ctx.reply('Produk dihapus.');
}

async function addStokFlow(ctx) {
  if (!guard(ctx)) return;
  const lines = (ctx.message.text || '')
    .split('\n')
    .map((s)=>s.trim())
    .filter(Boolean);

  const code = cleanText(lines.shift() || '', 64).toUpperCase();
  if (!code) return ctx.reply('Baris pertama harus KODE.');

  const [[prod]] = await pool.query('SELECT id FROM products WHERE code=?', [code]);
  if (!prod) return ctx.reply(`Produk ${code} tidak ditemukan.`);

  if (!lines.length) return ctx.reply('Tidak ada data stok.');

  let header = null;
  let delimiter = null;

  const firstData = normalizeStockLine(lines[0]);
  delimiter = detectDelimiter(firstData) || '|';
  const colsFirst = firstData.split(delimiter).map((x)=>x.trim());
  if (looksLikeHeader(colsFirst)) {
    header = colsFirst.map((x)=>x.toLowerCase());
    lines.shift();
  }

  const MAX_BATCH = 2000;
  const todo = [];
  for (const raw of lines.slice(0, MAX_BATCH)) {
    const ln = normalizeStockLine(raw);
    if (!ln) continue;
    const dlm = detectDelimiter(ln) || delimiter;
    const cols = ln.split(dlm).map((x)=>x.trim());
    const o = mapRowToFields(cols, header);
    if (!validateStockObj(o)) continue;
    todo.push(stockObjToJson(o));
  }

  if (!todo.length) return ctx.reply('Tidak ada baris valid (wajib ada email).');

  const values = todo.map(()=> '(?,?)').join(',');
  const params = [];
  for (const c of todo) { params.push(prod.id, c); }
  await pool.query(`INSERT INTO product_stock(product_id, content) VALUES ${values}`, params);

  getSession(ctx.from.id).admin.mode = null;
  await ctx.reply(`Tambah stok: ${todo.length} item untuk ${code}.`);
}

async function ambilStokFlow(ctx) {
  if (!guard(ctx)) return;
  const [codeRaw, nRaw] = ctx.message.text.trim().split(/\s+/);
  const code = cleanText(codeRaw || '', 64).toUpperCase();
  const n = clamp(toInt(nRaw || '1', 1), 1, 100);

  const [[prod]] = await pool.query('SELECT id FROM products WHERE code=?', [code]);
  if (!prod) return ctx.reply('Produk tidak tersedia.');

  const [rows] = await pool.query(
    'SELECT content FROM product_stock WHERE product_id=? AND is_taken=0 LIMIT ?',
    [prod.id, n]
  );
  if (!rows.length) {
    getSession(ctx.from.id).admin.mode = null;
    return ctx.reply('Kosong');
  }

  const pretty = rows.map(r => jsonOrRawToPretty(r.content)).join('\n\n---\n\n');

  getSession(ctx.from.id).admin.mode = null;
  await ctx.reply(pretty.slice(0, 3500) || 'Kosong');
}

async function setDeskFlow(ctx) {
  if (!guard(ctx)) return;
  const [code, ...descA] = ctx.message.text.trim().split(/\s+/);
  const c = cleanText(code || '', 64).toUpperCase();
  const d = cleanText(descA.join(' '), 2000);
  if (!c || !d) return ctx.reply('Format: KODE spasi deskripsi');
  await pool.query('UPDATE products SET description=? WHERE code=?', [d, c]);
  getSession(ctx.from.id).admin.mode = null;
  await ctx.reply('Deskripsi diubah.');
}

async function setHargaFlow(ctx) {
  if (!guard(ctx)) return;
  const [codeRaw, priceRaw] = ctx.message.text.trim().split(/\s+/);
  const c = cleanText(codeRaw || '', 64).toUpperCase();
  const price = clamp(toInt(priceRaw, 0), 1, 1_000_000_000);
  if (!c || !price) return ctx.reply('Format: KODE spasi hargaBaru');
  await pool.query('UPDATE products SET price=? WHERE code=?', [price, c]);
  getSession(ctx.from.id).admin.mode = null;
  await ctx.reply('Harga diubah.');
}

async function setNamaFlow(ctx) {
  if (!guard(ctx)) return;
  const [code, ...nameA] = ctx.message.text.trim().split(/\s+/);
  const c = cleanText(code || '', 64).toUpperCase();
  const name = cleanText(nameA.join(' '), 255);
  if (!c || !name) return ctx.reply('Format: KODE spasi Nama Baru');
  await pool.query('UPDATE products SET name=? WHERE code=?', [name, c]);
  getSession(ctx.from.id).admin.mode = null;
  await ctx.reply('Nama diubah.');
}

async function setKodeFlow(ctx) {
  if (!guard(ctx)) return;
  const [oldcRaw, newcRaw] = ctx.message.text.trim().split(/\s+/);
  const oldc = cleanText(oldcRaw || '', 64).toUpperCase();
  const newc = cleanText(newcRaw || '', 64).toUpperCase();
  if (!oldc || !newc) return ctx.reply('Format: KODE_LAMA spasi KODE_BARU');
  await pool.query('UPDATE products SET code=? WHERE code=?', [newc, oldc]);
  getSession(ctx.from.id).admin.mode = null;
  await ctx.reply('Kode diubah.');
}

// ====== SET NOTE (KODE spasi NOTE, NOTE boleh multi-baris)
async function setNoteFlow(ctx) {
  if (!guard(ctx)) return;

  const raw = ctx.message?.text ?? '';
  const firstSpace = raw.indexOf(' ');
  const rawCode = firstSpace === -1 ? raw : raw.slice(0, firstSpace);
  const code = cleanText(rawCode || '', 64).toUpperCase();

  const noteRaw = firstSpace === -1 ? '' : raw.slice(firstSpace + 1);
  if (!code || !noteRaw.trim()) {
    return ctx.reply('Format: KODE spasi NOTE (boleh multi-baris).');
  }

  // Simpan apa adanya (normalisasi line break)
  const note = noteRaw.replace(/\r\n?/g, '\n').trim().slice(0, 64000);
  await pool.query('UPDATE products SET note=? WHERE code=?', [note, code]);

  getSession(ctx.from.id).admin.mode = null;
  await ctx.reply('Note produk diubah.');
}

// ===================== BROADCAST =====================
async function broadcastFlow(ctx, variant) {
  if (!guard(ctx)) return;

  // variant bisa boolean (false=PROMOSI, true=PROMOSI2) atau string label
  const modeLabel =
    variant === true  ? 'PROMOSI2' :
    variant === false ? 'PROMOSI'  :
    String(variant || 'PROMO');

  const raw = ctx.message?.text ?? '';
  const text = fitTelegramText(raw, 4000);
  if (!text) return ctx.reply('Kirim isi broadcast (teks).');

  const s = getSession(ctx.from.id);
  s.admin.mode = null;

  const [rows] = await pool.query('SELECT id FROM users WHERE is_banned=0');
  const targets = rows.map(r => Number(r.id)).filter(Boolean);

  if (!targets.length) {
    return ctx.reply('Tidak ada user untuk dikirimi broadcast.');
  }

  await ctx.reply(
    `🚀 Mulai broadcast *${modeLabel}*\n` +
    `Target: ${targets.length} user\n` +
    `Catatan: dibatasi per-batch agar aman dari rate limit.`,
    { parse_mode: 'Markdown' }
  );

  const BATCH = 25;
  const PAUSE_MS = 1100;
  let ok = 0, fail = 0;

  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH);

    const results = await Promise.allSettled(
      chunk.map(uid =>
        ctx.telegram.sendMessage(uid, text, { disable_notification: false })
      )
    );

    for (const r of results) {
      if (r.status === 'fulfilled') ok++; else fail++;
    }

    if (i + BATCH < targets.length) {
      await sleep(PAUSE_MS);
    }
  }

  await ctx.reply(`✅ Broadcast selesai.\nTerkirim: ${ok}\nGagal: ${fail}`);
}

async function delUserFlow(ctx) {
  if (!guard(ctx)) return;
  const uid = toInt(ctx.message.text.trim(), 0);
  if (!uid) return ctx.reply('Kirim userId.');
  await pool.query('DELETE FROM users WHERE id=?', [uid]);
  getSession(ctx.from.id).admin.mode = null;
  await ctx.reply('User dihapus.');
}

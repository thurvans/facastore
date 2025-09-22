// src/commands/user.js
const QRCode = require('qrcode');
const pool = require('../services/db');
const { directPaymentQris } = require('../services/ipaymu');
const {
  getConfig, toInt, clamp, formatRp, nowTimeStr,
  getSession, numberKeyboard, navInline, adjustInline, safeDeleteMsg,
  tplPending, addHours, contactKeyboard, replyTemp, mkNoteHtml, mkNoteText
} = require('../utils');
const { takeStock } = require('../services/order');

const PER_PAGE = 10;
const sref = () => Math.random().toString(36).slice(2,10);

// ===== helpers =====
function normalizePhone(p){
  if (!p) return '';
  let s = String(p).trim();
  s = s.replace(/[^\d+]/g,'');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('62')) return s;
  if (s.startsWith('0')) return '62' + s.slice(1);
  return s.match(/^\d+$/) ? '62' + s : s;
}

async function ensureBuyerInfo(ctx){
  const uid = ctx.from.id;
  const s = getSession(uid);
  const [[u]] = await pool.query('SELECT id, name, phone, email FROM users WHERE id=?',[uid]);
  let name = u?.name || ctx.from.first_name || '';
  let phone = normalizePhone(u?.phone || '');
  if (!phone) {
    s.awaitingPhone = true;
    await ctx.reply('Sebelum melanjutkan pembayaran, kirim nomor HP kamu (tap tombol di bawah).', contactKeyboard());
    return null;
  }
  return { name: name || '', phone, email: u?.email || '' };
}

// ===== DB helpers
async function fetchPage(page){
  const offset = (page-1)*PER_PAGE;
  const [[{ c: total }]] = await pool.query('SELECT COUNT(*) AS c FROM products WHERE is_active=1');
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const [items] = await pool.query(
    `SELECT id, code, name, price, COALESCE(description,"") AS description
     FROM products 
     WHERE is_active=1
     ORDER BY name ASC
     LIMIT ? OFFSET ?`, [PER_PAGE, offset]
  );
  if(items.length){
    const ids = items.map(r=>r.id);
    const [st] = await pool.query(
      `SELECT product_id,
              SUM(CASE WHEN is_taken=0 THEN 1 ELSE 0 END) AS sisa,
              SUM(CASE WHEN is_taken=1 THEN 1 ELSE 0 END) AS terjual
       FROM product_stock
       WHERE product_id IN (${ids.map(()=>'?').join(',')})
       GROUP BY product_id`, ids
    );
    const map = new Map(st.map(r=>[r.product_id, r]));
    for(const r of items){
      const m = map.get(r.id) || { sisa:0, terjual:0 };
      r.sisa = Number(m.sisa||0);
      r.terjual = Number(m.terjual||0);
    }
  }
  return { items, totalPages };
}

function listText(items, page, totalPages){
  const start = (page-1)*PER_PAGE + 1;
  const lines = items.map((p,i)=>`[${start+i}]. ${p.name} ( ${p.sisa} )`).join('\n');
  return `LIST PRODUCT\n\n${lines}\n\nHalaman ${page} / ${totalPages}\n🕒 ${nowTimeStr()}`;
}

// ===== holder keyboard stabil
async function refreshNumberKeyboard(ctx, itemsLen, page){
  const s = getSession(ctx.from.id);
  const isAdmin = getConfig().adminUserIds?.includes?.(ctx.from.id);

  const prev = s.kbdHolderId || null;
  const gen = (s.kbdGen || 0) + 1;
  s.kbdGen = gen;

  const sent = await replyTemp(
    ctx,
    'Pilih angka dari keyboard…',
    { ...numberKeyboard(itemsLen, page, PER_PAGE, isAdmin), disable_notification: true },
    180000
  );
  s.kbdHolderId = sent.message_id;

  if (prev) {
    setTimeout(async ()=>{
      if (s.kbdGen === gen && s.kbdHolderId === sent.message_id) {
        await safeDeleteMsg(ctx, prev);
      }
    }, 900);
  }
}

// ===== PUBLIC: tampilkan katalog
async function showCatalog(ctx, page=1, opts={}){
  const s = getSession(ctx.from.id);
  page = clamp(toInt(page,1),1,9999);

  const { items, totalPages } = await fetchPage(page);
  s.page = page; s.totalPages = totalPages; s.items = items;

  const text = listText(items, page, totalPages);

  if (opts.forceNew) s.listMsgId = null;

  try{
    if (s.listMsgId) {
      await ctx.telegram.editMessageText(ctx.chat.id, s.listMsgId, undefined, text, navInline(page,totalPages));
    } else {
      const m = await ctx.reply(text, navInline(page,totalPages));
      s.listMsgId = m.message_id;
    }
  }catch{
    const m = await ctx.reply(text, navInline(page,totalPages));
    s.listMsgId = m.message_id;
  }

  await refreshNumberKeyboard(ctx, items.length, page);
}

// ===== inline nav
async function navCallback(ctx){
  const [, dir, curStr] = ctx.match;
  const cur = parseInt(curStr,10) || 1;
  const target = dir === 'PREV' ? Math.max(1,cur-1) : cur+1;
  await showCatalog(ctx, target, { forceNew:false });
  await ctx.answerCbQuery('').catch(()=>{});
}

// ===== pilih produk via angka
async function pickProductByNumber(ctx){
  const s = getSession(ctx.from.id);
  if (!s.items || !s.items.length) return;

  try { ctx.deleteMessage().catch(()=>{}); } catch {}

  const n = toInt(ctx.message.text, 0);
  if (!n) return;

  const targetPage = Math.max(1, Math.ceil(n / PER_PAGE));
  const localIdx = (n-1) % PER_PAGE;

  if (targetPage !== s.page) {
    await showCatalog(ctx, targetPage, { forceNew:true });
  }
  const item = s.items?.[localIdx];
  if (!item) return;

  s.chosen = { id:item.id, code:item.code, name:item.name, price:item.price, description:item.description };
  s.qty = 1;
  s.ref = sref();

  const box =
`╭──────────────────────────────────
│  Tambahkan jumlah pembelian:
│  • Produk : ${item.name}
│  • Kode   : ${item.code}
│  • Sisa   : ${item.sisa}
│  • Terjual: ${item.terjual}
│  • Desk   : ${(item.description||'-').slice(0,200)}
╰──────────────────────────────────
Qty awal: 1
🕒 ${nowTimeStr()}`;

  try{
    if (s.detailMsgId) {
      await ctx.telegram.editMessageText(ctx.chat.id, s.detailMsgId, undefined, box, adjustInline(s.ref));
    } else {
      const m = await ctx.reply(box, adjustInline(s.ref));
      s.detailMsgId = m.message_id;
    }
  }catch{
    const m = await ctx.reply(box, adjustInline(s.ref));
    s.detailMsgId = m.message_id;
  }
}

// ===== tombol inline qty
async function adjustQtyAction(ctx){
  const [, op, ref] = ctx.match;
  const s = getSession(ctx.from.id);
  if (!s.chosen || s.ref !== ref) return ctx.answerCbQuery('Kadaluarsa');

  const maxReq = getConfig().maxQtyPerOrder || 10;

  const [[exists]] = await pool.query('SELECT id FROM products WHERE id=? AND is_active=1', [s.chosen.id]);
  if (!exists) return ctx.answerCbQuery('Produk tidak tersedia');

  const [r] = await pool.query('SELECT COUNT(*) AS c FROM product_stock WHERE product_id=? AND is_taken=0',[s.chosen.id]);
  const available = r[0]?.c || 0;

  if (op === '+') s.qty = clamp((s.qty||1)+1, 1, Math.min(maxReq, available));
  else            s.qty = clamp((s.qty||1)-1, 1, Math.min(maxReq, available));

  const total = (s.chosen.price||0) * (s.qty||1);
  const msg =
`╭──────────────── RINGKASAN ────────────────
│  Produk   : ${s.chosen.name}
│  Kode     : ${s.chosen.code}
│  Jumlah   : ${s.qty}
│  Harga    : ${formatRp(s.chosen.price)}
│  Total    : ${formatRp(total)}
│  Sisa Stok: ${available}
╰────────────────────────────────────────────
Pilih metode pembayaran:`;

  try{
    await ctx.telegram.editMessageText(ctx.chat.id, s.detailMsgId, undefined, msg, adjustInline(s.ref));
  }catch{}
  await ctx.answerCbQuery('OK').catch(()=>{});
}

// ===== kecilkan jejak UI saat bayar
async function cleanupUiOnPay(ctx){
  const s = getSession(ctx.from.id);
  await safeDeleteMsg(ctx, s.detailMsgId); s.detailMsgId = null;
  await safeDeleteMsg(ctx, s.kbdHolderId); s.kbdHolderId = null;
}

// ===== bayar
async function payAction(ctx){
  const [, how, ref] = ctx.match;
  const s = getSession(ctx.from.id);
  if (!s.chosen || !s.qty || s.ref !== ref) return ctx.answerCbQuery('Kadaluarsa');

  const chosen = { ...s.chosen };
  const qty = s.qty;
  await cleanupUiOnPay(ctx);

  if (how === 'SALDO') {
    await doBuyWithBalance(ctx, chosen, qty);
  } else {
    await doBuyNowQris(ctx, chosen, qty);
  }
}

// ===== kembali
async function backToList(ctx){
  const s = getSession(ctx.from.id);
  await safeDeleteMsg(ctx, s.detailMsgId); s.detailMsgId = null;
  await safeDeleteMsg(ctx, s.kbdHolderId); s.kbdHolderId = null;
  s.chosen=null; s.qty=null; s.ref=null;
  await showCatalog(ctx, s.page||1, { forceNew:true });
}
async function backToListAction(ctx){
  await backToList(ctx);
  await ctx.answerCbQuery('').catch(()=>{});
}

// ===== helpers beli saldo
async function doBuyWithBalance(ctx, chosen, qty){
  const uid = ctx.from.id;
  const s = getSession(uid);
  try{
    const [[prod]] = await pool.query('SELECT * FROM products WHERE id=? AND is_active=1',[chosen.id]);
    if(!prod) return ctx.answerCbQuery('Produk tidak tersedia');

    const [r] = await pool.query('SELECT COUNT(*) AS c FROM product_stock WHERE product_id=? AND is_taken=0',[prod.id]);
    const live = r[0]?.c || 0;
    if(qty>live){ return ctx.answerCbQuery('Stok kurang'); }

    const total = prod.price * qty;
    const [[u]] = await pool.query('SELECT balance FROM users WHERE id=?',[uid]);
    if((u?.balance||0) < total) return ctx.answerCbQuery('Saldo kurang');

    const take = await takeStock(prod.id, qty, uid);
    if(!take.ok) return ctx.answerCbQuery('Stok tidak cukup');

    await pool.query('UPDATE users SET balance=balance-? WHERE id=?',[total, uid]);
    await pool.query('INSERT INTO orders(user_id,product_id,qty,amount,status,buynow,reference_id,paid_at) VALUES (?,?,?,?, "PAID",0,?,NOW())',
      [uid, prod.id, qty, total, 'ORD'+Date.now()]);

    const isAdmin = getConfig().adminUserIds?.includes?.(uid);
    const kb = numberKeyboard(s.items?.length || 0, s.page || 1, PER_PAGE, isAdmin);

    await ctx.reply(
`✅ Berhasil beli (Saldo)

• Produk : ${prod.name}
• Jumlah : ${qty}
• Total  : ${formatRp(total)}

Detail:
${take.items.join('\n')}`, kb
    );

    // Kirim NOTE rapi (tanpa preview)
    if (prod.note && String(prod.note).trim()) {
      try {
        await ctx.reply(mkNoteHtml(prod.note), { parse_mode: 'HTML', disable_web_page_preview: true });
      } catch {
        await ctx.reply(mkNoteText(prod.note), { disable_web_page_preview: true });
      }
    }

    s.chosen=null; s.qty=null; s.ref=null;
  }catch(e){ console.error(e); await ctx.answerCbQuery('Gagal'); }
}

// ===== helpers beli QRIS 24 jam (MIN amount + fee ke buyer)
// ===== helpers beli QRIS 24 jam (MIN amount + fee ke buyer) =====
async function doBuyNowQris(ctx, chosen, qty){
  const uid = ctx.from.id;
  const s = getSession(uid);

  // pesan "sedang dibuat"
  let waitMsgId = null;
  try { waitMsgId = (await ctx.reply('qris sedang di buat mohon tunggu')).message_id; } catch {}

  try{
    // ambil produk live
    const [[prod]] = await pool.query('SELECT * FROM products WHERE id=? AND is_active=1',[chosen.id]);
    if(!prod) {
      if (waitMsgId) await safeDeleteMsg(ctx, waitMsgId);
      return ctx.answerCbQuery('Produk tidak tersedia');
    }

    // stok
    const [r] = await pool.query('SELECT COUNT(*) AS c FROM product_stock WHERE product_id=? AND is_taken=0',[prod.id]);
    const live = r[0]?.c || 0;
    if(qty>live){
      if (waitMsgId) await safeDeleteMsg(ctx, waitMsgId);
      return ctx.answerCbQuery('Stok kurang');
    }

    // minta data buyer; kalau tak ada, tetap buat fallback agar tidak 406 Suspicious buyer
    let buyer = await ensureBuyerInfo(ctx); // kalau user belum kirim kontak, fungsi ini akan minta kontak & return null
    if (!buyer) {
      // user belum kirim nomor → hentikan proses (nanti lanjut otomatis setelah kirim kontak)
      if (waitMsgId) await safeDeleteMsg(ctx, waitMsgId);
      return;
    }

    // ==== Fallback aman agar iPaymu tidak "Suspicious buyer"
    const safePhone = (buyer.phone || '').replace(/[^\d]/g, '');
    const fallbackPhone = '62' + String(uid).replace(/[^\d]/g, '').slice(-10 || 0); // 62 + 10 digit akhir uid
    const buyerSafe = {
      name: (buyer.name && String(buyer.name).trim()) || (ctx.from.first_name || 'Customer'),
      phone: safePhone || fallbackPhone,
      email: (buyer.email && String(buyer.email).trim()) || (`u${uid}@noemail.local`)
    };
    // ==============================================

    // hitung total & kebijakan min QRIS
    const total = (prod.price || 0) * qty;
    const MIN_QRIS = Number(process.env.IPAYMU_MIN_QRIS || 1000); // default 1.000
    const BUYER_FEE_FLAT = Number(process.env.QRIS_BUYER_FEE_FLAT || 0); // opsional (0)

    let chargeAmount = total;
    let buyerFee = 0;

    if (chargeAmount < MIN_QRIS) {
      buyerFee += (MIN_QRIS - chargeAmount);
      chargeAmount = MIN_QRIS;
    }
    if (BUYER_FEE_FLAT > 0) {
      buyerFee += BUYER_FEE_FLAT;
      chargeAmount += BUYER_FEE_FLAT;
    }

    const refId = (process.env.REF_PREFIX || 'BUY') + Date.now();
    const expiresAt = addHours(new Date(), 24);

    // simpan order (amount = harga produk saja, tanpa surcharge)
    const [ins] = await pool.execute(
      `INSERT INTO orders(user_id,product_id,qty,amount,status,buynow,reference_id,expires_at)
       VALUES (?,?,?,?, 'PENDING',1,?, ?)`,
      [uid, prod.id, qty, total, refId, expiresAt]
    );

    const notifyUrl = `${process.env.PUBLIC_BASE_URL}${getConfig().webhookPath}`;
    const linkBase  = process.env.PUBLIC_BASE_URL;

    // >>> panggil iPaymu dengan buyerSafe (selalu terisi valid)
    const pay = await directPaymentQris({
      amount: chargeAmount,
      referenceId: refId,
      buyer: buyerSafe,
      description: `BuyNow ${prod.code} x${qty} by ${uid}`,
      notifyUrl, returnUrl: linkBase, cancelUrl: linkBase
    });

    if (waitMsgId) await safeDeleteMsg(ctx, waitMsgId);

    s.chosen=null; s.qty=null; s.ref=null;

    if (!pay.ok) {
      await ctx.reply(`Gagal membuat pembayaran (iPaymu): ${pay.message || 'unknown'}`);
      return;
    }

    // pakai amount nyata dari iPaymu jika tersedia
    if (Number(pay.chargedAmount || 0) > 0) {
      buyerFee = Math.max(0, Number(pay.chargedAmount) - total);
      chargeAmount = Number(pay.chargedAmount);
    }

    const pendingText = tplPending({
      idPayment: refId,
      totalHarga: total,
      qty,
      fee: buyerFee,
      note: prod.code,
      totalBayar: chargeAmount,
      createdAt: new Date(),
      bayarSebelum: expiresAt,
      service: 'QRIS'
    });

    const link = pay.url || linkBase;
    const caption = (pendingText + `\n\n🔗 *Bayar via link:* ${link}`).slice(0, 900);

    const isAdmin = getConfig().adminUserIds?.includes?.(uid);
    const kb = numberKeyboard(s.items?.length || 0, s.page || 1, PER_PAGE, isAdmin);

    const QRSource = pay.qrString || link;
    let dataUrl = null;
    try { dataUrl = await QRCode.toDataURL(QRSource, { errorCorrectionLevel:'M', margin:1, scale:6 }); } catch {}

    let oneMsgId = null;
    if (dataUrl) {
      const sent = await ctx.replyWithPhoto(
        { source: Buffer.from(dataUrl.split(',')[1], 'base64') },
        { caption, parse_mode:'Markdown', ...kb }
      ).catch(()=>null);
      oneMsgId = sent?.message_id || null;
    } else {
      const sent = await ctx.reply(caption, { parse_mode:'Markdown', ...kb }).catch(()=>null);
      oneMsgId = sent?.message_id || null;
    }

    await pool.query(
      'UPDATE orders SET pending_msg_id=?, pending_qr_msg_id=? WHERE id=?',
      [oneMsgId, oneMsgId, ins.insertId]
    );

  }catch(e){
    console.error(e);
    if (waitMsgId) try { await safeDeleteMsg(ctx, waitMsgId); } catch {}
    await ctx.answerCbQuery('Gagal');
  }
}

// ===== Handler untuk contact (share nomor HP)
async function onContact(ctx){
  const uid = ctx.from.id;
  const s = getSession(uid);

  const contact = ctx.message?.contact;
  if (!contact || !contact.phone_number) {
    return ctx.reply('Nomor HP tidak terbaca. Coba lagi ya.', contactKeyboard());
  }

  const phone = normalizePhone(contact.phone_number);
  const name  = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || ctx.from.first_name || '';

  // simpan ke DB
  await pool.query(
    'INSERT INTO users (id, name, phone) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), phone=VALUES(phone)',
    [uid, name, phone]
  );

  await replyTemp(ctx, `Nomor HP tersimpan: +${phone.replace(/^62/,'62 ')}`, {}, 20000);

  // jika sebelumnya user sedang proses BuyNow dan menunggu phone, lanjutkan
  if (s.awaitingPhone && s.chosen && s.qty){
    s.awaitingPhone = false;
    await doBuyNowQris(ctx, s.chosen, s.qty);
  } else {
    s.awaitingPhone = false;
  }
}

module.exports = {
  showCatalog,
  navCallback,
  pickProductByNumber,
  adjustQtyAction,
  payAction,
  backToList,
  backToListAction,
  onContact
};

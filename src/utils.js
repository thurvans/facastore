const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// ---- config ----
const cfg = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'config.json'), 'utf-8')
);

// ---- helpers umum ----
function getConfig(){ return cfg; }
function cleanText(s, max=256){ return (s ?? '').toString().replace(/[\r\n\t]+/g,' ').trim().slice(0,max); }
function toInt(n, d=0){ const v = parseInt(String(n).replace(/[^\d]/g,''),10); return Number.isFinite(v)?v:d; }
function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }
function formatRp(n){ return 'Rp ' + Number(n||0).toLocaleString('id-ID'); }
function toIDR(n){ return 'Rp ' + Number(n||0).toLocaleString('id-ID'); }
function nowTimeStr(){ return new Date().toLocaleTimeString('id-ID', { hour12:true }); }
function formatTanggalJam(d = new Date()){ return new Date(d).toLocaleString('id-ID', { hour12:false }); }
function addHours(date, h){ const d=new Date(date); d.setHours(d.getHours()+h); return d; }

async function safeDeleteMsg(ctx, msgId){
  if(!msgId) return;
  try{ await ctx.telegram.deleteMessage(ctx.chat.id, msgId); }catch{}
}

// ---- session sederhana (in-memory) ----
const SESS = new Map();
function getSession(uid){ if(!SESS.has(uid)) SESS.set(uid, {}); return SESS.get(uid); }

// ---- rate limit sederhana ----
const RL = new Map();
function rateLimit(uid, limit=10, windowMs=4000){
  const now = Date.now();
  const rec = RL.get(uid) || { ts: now, count: 0 };
  if (now - rec.ts > windowMs){ rec.ts = now; rec.count = 0; }
  rec.count++;
  RL.set(uid, rec);
  return rec.count <= limit;
}

// ---- reply keyboard: angka daftar produk ----
function numberKeyboard(itemsLen, page, perPage, isAdmin=false){
  const rows=[];
  const start = (Math.max(1,page)-1)*Math.max(1,perPage)+1;
  const end   = start + Math.max(0, itemsLen) - 1;

  const top=[{ text:'List Produk' }];
  if (isAdmin) top.push({ text:'Menu Admin' });
  rows.push(top);

  let row=[];
  for(let n=start; n<=end; n++){
    row.push({ text: String(n) });
    if (row.length===5){ rows.push(row); row=[]; }
  }
  if (row.length) rows.push(row);

  rows.push([{ text:'⬅️ Kembali ke Daftar' }, { text:'Batal' }]);

  return {
    reply_markup: {
      keyboard: rows,
      resize_keyboard: true,
      one_time_keyboard: false,
      is_persistent: false,
      input_field_placeholder: 'Pilih angka…'
    }
  };
}

// ---- reply keyboard: Admin ----
function adminKeyboard(){
  return {
    reply_markup:{
      keyboard:[
        [{text:'ADDSALDO'},{text:'MINSALDO'}],
        [{text:'ADDPRODUK'},{text:'DELPRODUK'}],
        [{text:'ADDSTOK'},{text:'AMBILSTOK'}],
        [{text:'SETDESK'},{text:'SETHARGA'}],
        [{text:'SETNAMA'},{text:'SETKODE'}],
        [{text:'SETNOTE'}],
        [{text:'PROMOSI'},{text:'PROMOSI2'}],
        [{text:'DELUSER'}],
        [{text:'⬅️ Kembali ke User'},{text:'Batal'}]
      ],
      resize_keyboard:true,
      one_time_keyboard:false,
      is_persistent:false
    }
  };
}

// ---- keyboard: Minta Nomor HP (request_contact) ----
function contactKeyboard(){
  return {
    reply_markup: {
      keyboard: [
        [{ text: '📱 Kirim Nomor HP', request_contact: true }],
        [{ text: 'Batal' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
      is_persistent: false
    }
  };
}

// ---- inline: nav daftar ----
function navInline(page,totalPages){
  const row=[];
  if(page>1) row.push({ text:'⬅️ Sebelumnya', callback_data:`NAV:PREV:${page}` });
  if(page<totalPages) row.push({ text:'➡️ Selanjutnya', callback_data:`NAV:NEXT:${page}` });
  if(!row.length) row.push({ text:'—', callback_data:'NAV:NOP' });
  return { reply_markup: { inline_keyboard: [row] } };
}

// ---- inline: adjust qty & bayar ----
function adjustInline(ref){
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text:'➖', callback_data:`QTY:-:${ref}` }, { text:'➕', callback_data:`QTY:+:${ref}` }],
        [{ text:'Buy ( Saldo )', callback_data:`PAY:SALDO:${ref}` }, { text:'Bayar QRIS (24 jam)', callback_data:`PAY:QRIS:${ref}` }],
        [{ text:'⬅️ Kembali ke Daftar', callback_data:'BACK:LIST' }]
      ]
    }
  };
}

// ===== Templating UI =====
function tplPending({
  idPayment, totalHarga, qty, fee=0, note='-', totalBayar, createdAt, bayarSebelum, service='QRIS'
}){
  return (
`╭────〔 TRANSAKSI PENDING  〕─
┊・ID payment: ${idPayment}
┊・Service Payment: ${service}
┊・Harga Total: ${toIDR(totalHarga)}
┊・Jumlah: ${qty}
┊・Fee: ${toIDR(fee)}
┊・Note: ${note}
┊・Total Dibayar: ${toIDR(totalBayar)}
┊・Jam/Tanggal: ${formatTanggalJam(createdAt)}
┊・Bayar sebelum: ${formatTanggalJam(bayarSebelum)}
╰┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈`
  );
}

function tplSuccess({
  payId, kodeUnik='-', namaProduk, idBuyer, noBuyer='-', jumlahBeli=1,
  jumlahAkun, harga, fee=0, total, metode='QRIS', waktu,
  accountDetail
}){
  return (
`╭────〔 TRANSAKSI SUKSES 〕─
┊・Pay ID : ${payId}
┊・Kode Unik : ${kodeUnik}
┊・Nama Produk : ${namaProduk}
┊・ID Buyer : ${idBuyer}
┊・Nomor Buyer : ${noBuyer}
┊・Jumlah Beli :${jumlahBeli}
┊・Jumlah Akun didapat : ${jumlahAkun}
┊・Harga : ${toIDR(harga)}
┊・Fee : ${toIDR(fee)}
┊・Total Dibayar : ${toIDR(total)}
┊・Methode Pay : ${metode}
┊・Tanggal/Jam Transaksi : ${formatTanggalJam(waktu)}
╰┈┈┈┈┈
〔 *ACCOUNT DETAIL* 〕

${accountDetail || '-'}`
  );
}

// ===== Telegram HTTP helpers (lempar error bila ok:false) =====
async function tgSendMessage(chatId, text, extra={}){
  const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text, ...extra };
  if (!('parse_mode' in body)) body.parse_mode = 'Markdown';
  if (!('disable_web_page_preview' in body)) body.disable_web_page_preview = true;
  const res = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (data?.ok !== true) throw new Error(data?.description || 'telegram sendMessage failed');
  return data.result;
}
async function tgSendPhoto(chatId, fileOrUrl, extra={}){
  const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendPhoto`;
  const res = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ chat_id: chatId, photo: fileOrUrl, ...extra }) });
  const data = await res.json();
  if (data?.ok !== true) throw new Error(data?.description || 'telegram sendPhoto failed');
  return data.result;
}
async function tgDeleteMessage(chatId, messageId){
  const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/deleteMessage`;
  await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ chat_id:chatId, message_id:messageId }) });
}

// ---- timestamp untuk iPaymu (YYYYMMDDHHmmss)
function pad(n){ return String(n).padStart(2,'0'); }
function timestamp(){
  const d = new Date();
  const YYYY = d.getFullYear();
  const MM   = pad(d.getMonth()+1);
  const DD   = pad(d.getDate());
  const hh   = pad(d.getHours());
  const mm   = pad(d.getMinutes());
  const ss   = pad(d.getSeconds());
  return `${YYYY}${MM}${DD}${hh}${mm}${ss}`;
}

// ======== helpers kebersihan chat ========
function unrefTimeout(fn, ms){
  const t = setTimeout(fn, ms);
  if (typeof t.unref === 'function') t.unref();
  return t;
}
async function replyTemp(ctx, text, extra={}, ttlMs=45000){
  const m = await ctx.reply(text, extra);
  if (ttlMs > 0) unrefTimeout(()=>safeDeleteMsg(ctx, m.message_id), ttlMs);
  return m;
}
async function replyPhotoTemp(ctx, photo, extra={}, ttlMs=45000){
  const m = await ctx.replyWithPhoto(photo, extra);
  if (ttlMs > 0) unrefTimeout(()=>safeDeleteMsg(ctx, m.message_id), ttlMs);
  return m;
}
async function deleteUserInput(ctx, delayMs=400){
  try { unrefTimeout(()=>ctx.deleteMessage().catch(()=>{}), delayMs); } catch {}
}

/* ===================== NOTE FORMATTER ===================== */

// Normalisasi hasil copy–paste supaya rapi:
// - 1 baris per bullet/checkbox (✅/☑️/✔/•/-)
// - URL di baris sendiri
// - hapus zero-width chars, spasi ganda
function normalizeNote(raw) {
  let txt = String(raw || '');

  txt = txt
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

  // Bullet/checkbox -> baris baru
  txt = txt.replace(/ *([✅☑️✔️✔•\-])\s*/g, '\n$1 ');

  // URL di baris sendiri
  txt = txt.replace(/(?:\s*)(https?:\/\/[^\s]+)/gi, '\n$1\n');

  // Rapikan newline berlebih
  txt = txt.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').trim();
  return txt;
}

function mkNoteHtml(note, title='〔 NOTE 〕') {
  const esc = normalizeNote(note)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .slice(0,3800);
  return `<b>${title}</b>\n${esc}`;
}

function mkNoteText(note, title='〔 NOTE 〕') {
  return `${title}\n${normalizeNote(note)}`.slice(0,4000);
}

module.exports = {
  getConfig, cleanText, toInt, clamp, formatRp, nowTimeStr, safeDeleteMsg,
  getSession, rateLimit, numberKeyboard, adminKeyboard, navInline, adjustInline,
  tplPending, tplSuccess, toIDR, formatTanggalJam, addHours,
  tgSendMessage, tgSendPhoto, tgDeleteMessage, timestamp,
  contactKeyboard,
  replyTemp, replyPhotoTemp, deleteUserInput, unrefTimeout,
  mkNoteHtml, mkNoteText, normalizeNote
};

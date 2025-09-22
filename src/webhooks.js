// src/webhooks.js
const express = require('express');
const pool = require('./services/db');
const {
  tplSuccess, tgSendMessage, tgDeleteMessage,
  numberKeyboard, getConfig, mkNoteHtml, mkNoteText
} = require('./utils');

const router = express.Router();
const PER_PAGE = 10;

// Ambil stok & ubah ke pretty text
function prettyStock(content){
  try{
    const o = JSON.parse(content);
    const L=[];
    if(o.email) L.push(`Email: ${o.email}`);
    if(o.password) L.push(`Password: ${o.password}`);
    if(o.pin) L.push(`PIN: ${o.pin}`);
    if(o.profil) L.push(`Profil: ${o.profil}`);
    return L.join('\n');
  }catch{ return content; }
}

async function buildReplyKeyboardForUser(userId){
  try{
    const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM products WHERE is_active=1');
    const itemsLen = Math.max(0, Math.min(PER_PAGE, Number(c || 0)));
    const isAdmin = !!getConfig().adminUserIds?.includes?.(userId);
    return numberKeyboard(itemsLen, 1, PER_PAGE, isAdmin);
  }catch{
    return {
      reply_markup: {
        keyboard: [
          [{ text:'List Produk' }],
          [{ text:'⬅️ Kembali ke Daftar' }, { text:'Batal' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false,
        is_persistent: false
      }
    };
  }
}

router.post('/ipaymu/unotify', express.json(), async (req, res) => {
  const b = req.body || {};
  const ref = b.referenceId || b.ReferenceId || '';
  try{
    if (!ref) return res.status(400).json({ ok:false, msg:'No referenceId' });

    // ====== Deposit
    const [[dep]] = await pool.query('SELECT * FROM deposits WHERE reference_id=?', [ref]);
    if (dep && dep.status==='PENDING') {
      const success = (String(b.status || b.Status).toLowerCase() === 'berhasil') || b.Status === 200;
      if (success) {
        await pool.query('UPDATE deposits SET status="PAID", ipaymu_trx_id=?, paid_at=NOW() WHERE id=?',
          [b.transactionId || b.TransactionId || null, dep.id]);
        await pool.query('UPDATE users SET balance=balance+? WHERE id=?', [dep.amount, dep.user_id]);
      } else {
        await pool.query('UPDATE deposits SET status="FAILED" WHERE id=?', [dep.id]);
      }
    }

    // ====== BuyNow
    const [[ord]] = await pool.query('SELECT * FROM orders WHERE reference_id=?', [ref]);
    if (ord && ord.status==='PENDING' && ord.buynow===1) {
      const success = (String(b.status || b.Status).toLowerCase() === 'berhasil') || b.Status === 200;

      // Hapus pesan pending (jika ada)
      if (ord.pending_msg_id)  await tgDeleteMessage(ord.user_id, ord.pending_msg_id).catch(()=>{});
      if (ord.pending_qr_msg_id) await tgDeleteMessage(ord.user_id, ord.pending_qr_msg_id).catch(()=>{});
      await pool.query('UPDATE orders SET pending_msg_id=NULL, pending_qr_msg_id=NULL WHERE id=?',[ord.id]);

      const kb = await buildReplyKeyboardForUser(ord.user_id);

      if (success) {
        const [stk] = await pool.query(
          'SELECT id,content FROM product_stock WHERE product_id=? AND is_taken=0 LIMIT ?',
          [ord.product_id, ord.qty]
        );
        if (stk.length >= ord.qty) {
          for (const row of stk) {
            await pool.query(
              'UPDATE product_stock SET is_taken=1, taken_by=?, taken_at=NOW() WHERE id=?',
              [ord.user_id, row.id]
            );
          }
          await pool.query('UPDATE orders SET status="PAID", ipaymu_trx_id=?, paid_at=NOW() WHERE id=?',
            [b.transactionId || b.TransactionId || null, ord.id]);

          const [[prod]] = await pool.query('SELECT name,price,code,note FROM products WHERE id=?',[ord.product_id]);
          const accounts = stk.map(r => prettyStock(r.content)).join('\n\n---\n\n');

          // jumlah yang dibayar buyer (fallback: ord.amount)
          const paid = Number(b.Amount || b.amount || b.Total || b.total || ord.amount) || Number(ord.amount);
          const buyerFee = Math.max(0, paid - Number(ord.amount || 0));

          const text = tplSuccess({
            payId: ref,
            kodeUnik: '-',
            namaProduk: prod?.name || '-',
            idBuyer: ord.user_id,
            jumlahBeli: ord.qty,
            jumlahAkun: ord.qty,
            harga: prod?.price || ord.amount/ord.qty,
            fee: buyerFee,
            total: paid,
            metode: 'QRIS',
            waktu: new Date(),
            accountDetail: accounts
          });

          await tgSendMessage(ord.user_id, text, { parse_mode:'Markdown', ...kb });

          // NOTE dipisah & rapi (tanpa preview)
          if (prod?.note && String(prod.note).trim()) {
            try {
              await tgSendMessage(ord.user_id, mkNoteHtml(prod.note), { parse_mode: 'HTML', disable_web_page_preview: true });
            } catch {
              await tgSendMessage(ord.user_id, mkNoteText(prod.note), { disable_web_page_preview: true });
            }
          }

        } else {
          await pool.query('UPDATE orders SET status="FAILED" WHERE id=?', [ord.id]);
          await tgSendMessage(ord.user_id, 'Transaksi gagal: stok tidak cukup. Dana akan otomatis direkonsiliasi oleh penyedia pembayaran bila diperlukan.', { ...kb });
        }
      } else {
        await pool.query('UPDATE orders SET status="FAILED" WHERE id=?', [ord.id]);
        await tgSendMessage(ord.user_id, `Transaksi *gagal* atau dibatalkan.\nRef: ${ref}`, { parse_mode:'Markdown', ...kb });
      }
    }

    res.json({ ok:true });
  }catch(e){
    console.error(e);
    res.status(500).json({ ok:false });
  }
});

module.exports = router;

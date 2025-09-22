const pool = require('./db');

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
  } catch (_) {}
  return content;
}

async function takeStock(productId, qty, userId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT id, content FROM product_stock WHERE product_id=? AND is_taken=0 LIMIT ? FOR UPDATE',
      [productId, qty]
    );
    if (!rows.length || rows.length < qty) {
      await conn.rollback();
      return { ok: false, items: [], count: rows.length || 0 };
    }
    const ids = rows.map(r => r.id);
    const now = new Date();
    await conn.query(
      `UPDATE product_stock
         SET is_taken=1, taken_by=?, taken_at=?
       WHERE id IN (${ids.map(()=>'?').join(',')})`,
      [userId, now, ...ids]
    );
    await conn.commit();
    const items = rows.map(r => jsonOrRawToPretty(r.content));
    return { ok: true, items, count: rows.length };
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    console.error('takeStock error', e);
    return { ok: false, items: [], count: 0 };
  } finally {
    conn.release();
  }
}

module.exports = { takeStock, jsonOrRawToPretty };

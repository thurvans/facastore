const { Telegraf } = require('telegraf');
const pool = require('./services/db');
const userCmd = require('./commands/user');     // katalog & transaksi
const adminCmd = require('./commands/admin');   // admin & broadcast
const { getConfig, rateLimit, getSession, adminKeyboard, safeDeleteMsg, deleteUserInput } = require('./utils');

const bot = new Telegraf(process.env.BOT_TOKEN);

// ---- middleware: session + rate limit ----
bot.use(async (ctx, next) => {
  const uid = ctx.from?.id;
  if (!uid) return;
  ctx.session = getSession(uid);
  if (!rateLimit(uid)) return;
  await next();
});

// /start
bot.start(async (ctx)=>{
  const uid = ctx.from.id;
  const uname = ctx.from.username ? '@'+ctx.from.username : ctx.from.first_name;
  await pool.execute('INSERT IGNORE INTO users(id, username) VALUES (?,?)',[uid, ctx.from.username||null]);

  const isAdmin = getConfig().adminUserIds.includes(uid);
  await ctx.reply(isAdmin ? `hai admin ${uname}` : `hai ${uname}`, { reply_markup: { remove_keyboard: true } });

  await userCmd.showCatalog(ctx, 1, { forceNew:true });
});

// USER text
bot.on('text', async (ctx, next) => {
  const s = getSession(ctx.from.id);

  if (s.admin?.mode) return adminCmd.textRouter(ctx, next);

  const t = (ctx.message?.text || '').trim();

  if (t === 'List Produk') {
    deleteUserInput(ctx);
    return userCmd.backToList(ctx);
  }
  if (t === '⬅️ Kembali ke Daftar') {
    deleteUserInput(ctx);
    return userCmd.backToList(ctx);
  }
  if (/^Batal$/i.test(t)) {
    deleteUserInput(ctx);
    return userCmd.backToList(ctx);
  }
  if (/^\d+$/.test(t)) {
    deleteUserInput(ctx);
    return userCmd.pickProductByNumber(ctx);
  }

  return next();
});

// Inline actions
bot.action(/^NAV:(PREV|NEXT):(\d+)$/, (ctx)=>userCmd.navCallback(ctx));
bot.action('NAV:NOP', (ctx)=>ctx.answerCbQuery(''));
bot.action(/^QTY:(\+|-):([A-Za-z0-9_-]+)$/, (ctx)=>userCmd.adjustQtyAction(ctx));
bot.action(/^PAY:(SALDO|QRIS):([A-Za-z0-9_-]+)$/, (ctx)=>userCmd.payAction(ctx));
bot.action('BACK:LIST', (ctx)=>userCmd.backToListAction(ctx));

// Contact handler
bot.on('contact', userCmd.onContact);

// ===== ADMIN keyboard toggle =====
bot.hears(/^Menu Admin$/i, async (ctx)=>{
  const uid = ctx.from.id;
  if (!getConfig().adminUserIds.includes(uid)) return ctx.reply('Menu khusus admin.');

  const s = getSession(uid);
  await safeDeleteMsg(ctx, s.kbdHolderId); s.kbdHolderId = null;
  s.listMsgId = null;
  s.admin = s.admin || {}; s.admin.mode = null;

  await ctx.reply('Menu Admin:', adminKeyboard());
});

bot.hears(/^⬅️ Kembali ke User$/i, async (ctx)=>{
  const s = getSession(ctx.from.id);
  s.admin = null;
  await ctx.reply('Kembali ke menu user.', { reply_markup: { remove_keyboard: true } });
  await userCmd.showCatalog(ctx, s.page || 1, { forceNew:true });
});

// ADMIN actions
const adminButtons = {
  'ADDSALDO':'ADMIN_ADDSALDO','MINSALDO':'ADMIN_MINSALDO',
  'ADDPRODUK':'ADMIN_ADDPRODUK','DELPRODUK':'ADMIN_DELPRODUK',
  'ADDSTOK':'ADMIN_ADDSTOK','AMBILSTOK':'ADMIN_AMBILSTOK',
  'SETDESK':'ADMIN_SETDESK','SETHARGA':'ADMIN_SETHARGA',
  'SETNAMA':'ADMIN_SETNAMA','SETKODE':'ADMIN_SETKODE',
  'SETNOTE':'ADMIN_SETNOTE','PROMOSI':'ADMIN_PROMOSI',
  'PROMOSI2':'ADMIN_PROMOSI2','DELUSER':'ADMIN_DELUSER'
};
for (const [label, mode] of Object.entries(adminButtons)) {
  bot.hears(label, (ctx)=>adminCmd.enterMode(ctx, mode));
}

module.exports = bot;

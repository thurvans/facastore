require('dotenv').config();
const express = require('express');
const bot = require('./src/bot');
const webhooks = require('./src/webhooks');

const app = express();
app.use(webhooks);

// Jalankan bot
bot.launch();

// HTTP server (untuk webhook iPaymu)
const port = process.env.PORT || 3000;
app.listen(port, () => console.log('HTTP listening on', port));

// graceful stop
process.once('SIGINT', () => { try { bot.stop('SIGINT'); } catch {} process.exit(0); });
process.once('SIGTERM', () => { try { bot.stop('SIGTERM'); } catch {} process.exit(0); });

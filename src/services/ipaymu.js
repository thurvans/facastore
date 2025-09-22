// src/services/ipaymu.js
const crypto = require('crypto');
const fetch = require('node-fetch');
const { timestamp } = require('../utils');

const VA = process.env.IPAYMU_VA;
const API_KEY = process.env.IPAYMU_API_KEY;
// Sandbox: https://sandbox.ipaymu.com  |  Live: https://my.ipaymu.com
const BASE = (process.env.IPAYMU_BASE_URL || 'https://sandbox.ipaymu.com').replace(/\/+$/,'');

function hmacSHA256Hex(data, key){
  return crypto.createHmac('sha256', key).update(data).digest('hex'); // hex lower
}

/**
 * Direct Payment QRIS (v2)
 *
 * StringToSign = METHOD:VA:lowercase(sha256(bodyJson)):API_KEY
 * signature    = HMAC-SHA256(StringToSign, API_KEY)
 *
 * Return bentuk konsisten:
 * { ok, message, url, qrString, chargedAmount, fee }
 */
async function directPaymentQris({ amount, referenceId, buyer={}, description, notifyUrl, returnUrl, cancelUrl }){
  const amt = Math.round(Number(amount || 0)); // integer IDR

  const payload = {
    name:  buyer.name  || undefined,
    email: buyer.email || undefined,
    phone: buyer.phone || undefined,
    amount: amt,
    comments: description || 'Payment via Telegram',
    referenceId,
    notifyUrl,
    paymentMethod: 'qris',
    paymentChannel: 'qris',
    returnUrl, cancelUrl
  };

  // buang undefined agar konsisten hash
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

  const bodyJson  = JSON.stringify(payload);
  const bodyHash  = crypto.createHash('sha256').update(bodyJson).digest('hex').toLowerCase();
  const stringToSign = `POST:${VA}:${bodyHash}:${API_KEY}`;
  const signature = hmacSHA256Hex(stringToSign, API_KEY);

  const url = `${BASE}/api/v2/payment/direct`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':'application/json',
      'Accept':'application/json',
      va: VA,
      signature,
      timestamp: timestamp()
    },
    body: bodyJson
  });

  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); }
  catch {
    return { ok:false, message:'Invalid JSON from iPaymu', url:null, qrString:null, chargedAmount:amt, fee:0 };
  }

  const ok = data?.Status === 200;
  const out = {
    ok,
    message: data?.Message || (ok ? 'Success' : 'Failed'),
    url: data?.Data?.Url || data?.Data?.QrisUrl || null,
    qrString: data?.Data?.QrString || data?.Data?.QrisContent || null,
    chargedAmount: Number(data?.Data?.Amount || amt) || amt,
    fee: Number(data?.Data?.Fee || 0) || 0
  };

  if (!ok) {
    console.error('iPaymu Direct Payment error', {
      httpStatus: res.status, data,
      payload: { ...payload, name: undefined, email: undefined, phone: undefined }
    });
  }
  return out;
}

module.exports = { directPaymentQris };

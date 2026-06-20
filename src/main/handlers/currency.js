// Currency + crypto conversion handler.
// Fiat rates: exchangerate-api.com (USD-based, 30min cache)
// Crypto rates: CoinGecko (USD-denominated, 5min cache)

const https = require('https');
const { CRYPTO_CODES, CRYPTO_ID_MAP, isCrypto } = require('../constants');

const FX_CACHE = { rates: null, timestamp: 0 };
const FX_CACHE_TTL = 30 * 60 * 1000;
const FX_TIMEOUT = 10000;

const CRYPTO_CACHE = { rates: null, timestamp: 0 };
const CRYPTO_CACHE_TTL = 5 * 60 * 1000;
const CRYPTO_TIMEOUT = 10000;

function fetchJson(url, headers = {}, timeout = 10000) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers, timeout }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function getFxRates() {
  if (FX_CACHE.rates && Date.now() - FX_CACHE.timestamp < FX_CACHE_TTL) {
    return FX_CACHE.rates;
  }
  const parsed = await fetchJson('https://api.exchangerate-api.com/v4/latest/USD');
  if (parsed && parsed.rates) {
    FX_CACHE.rates = parsed.rates;
    FX_CACHE.timestamp = Date.now();
    return parsed.rates;
  }
  return null;
}

async function getCryptoRates() {
  if (CRYPTO_CACHE.rates && Date.now() - CRYPTO_CACHE.timestamp < CRYPTO_CACHE_TTL) {
    return CRYPTO_CACHE.rates;
  }
  const ids = Object.values(CRYPTO_ID_MAP).join(',');
  const parsed = await fetchJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
    { 'User-Agent': 'QuickBar/1.0 (macOS launcher)' },
    CRYPTO_TIMEOUT
  );
  if (!parsed) return null;

  const rates = {};
  for (const [symbol, id] of Object.entries(CRYPTO_ID_MAP)) {
    if (parsed[id] && parsed[id].usd) {
      rates[symbol] = parsed[id].usd;
    }
  }
  CRYPTO_CACHE.rates = rates;
  CRYPTO_CACHE.timestamp = Date.now();
  return rates;
}

async function convertCurrency(amount, fromCur, toCur) {
  const from = (fromCur || '').toUpperCase();
  const to = (toCur || '').toUpperCase();
  const amt = parseFloat(amount);
  if (isNaN(amt)) return { ok: false, error: 'Invalid amount' };

  const fromIsCrypto = isCrypto(from);
  const toIsCrypto = isCrypto(to);

  if (fromIsCrypto || toIsCrypto) {
    const cryptoRates = await getCryptoRates();
    if (!cryptoRates) return { ok: false, error: 'Crypto API unreachable' };

    if (fromIsCrypto && toIsCrypto) {
      const usdAmount = amt * cryptoRates[from];
      const result = usdAmount / cryptoRates[to];
      return { ok: true, result: Math.round(result * 100) / 100, from, to, amount: amt };
    }

    const fiatRates = await getFxRates();
    if (!fiatRates) return { ok: false, error: 'FX API unreachable' };

    if (fromIsCrypto) {
      const usdAmount = amt * cryptoRates[from];
      const result = usdAmount * fiatRates[to];
      return { ok: true, result: Math.round(result * 100) / 100, from, to, amount: amt };
    } else {
      const usdAmount = amt / fiatRates[from];
      const result = usdAmount / cryptoRates[to];
      return { ok: true, result: Math.round(result * 1e8) / 1e8, from, to, amount: amt };
    }
  }

  // Pure fiat
  const rates = await getFxRates();
  if (!rates) return { ok: false, error: 'FX API unreachable' };
  if (!rates[from]) return { ok: false, error: `Unknown currency: ${from}` };
  if (!rates[to]) return { ok: false, error: `Unknown currency: ${to}` };

  const usdAmount = amt / rates[from];
  const result = usdAmount * rates[to];
  return { ok: true, result: Math.round(result * 100) / 100, from, to, amount: amt };
}

function register(ipcMain) {
  ipcMain.handle('convert-currency', async (event, amount, fromCur, toCur) => {
    return convertCurrency(amount, fromCur, toCur);
  });
}

module.exports = { register, convertCurrency, getFxRates, getCryptoRates };
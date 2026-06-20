// Shared constants — used by main process handlers and renderer (via preload).

const FIAT_CODES = [
  'COP', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF',
  'CNY', 'MXN', 'BRL', 'ARS', 'CLP', 'PEN',
];

const CRYPTO_CODES = [
  'BTC', 'ETH', 'SOL', 'USDT', 'USDC', 'BNB', 'XRP', 'ADA',
  'DOGE', 'DOT', 'MATIC', 'AVAX', 'LINK', 'LTC', 'BCH', 'UNI',
  'ATOM', 'XLM', 'ICP', 'FIL',
];

const CRYPTO_ID_MAP = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', USDT: 'tether', USDC: 'usd-coin',
  BNB: 'binancecoin', XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', DOT: 'polkadot',
  MATIC: 'matic-network', AVAX: 'avalanche-2', LINK: 'chainlink', LTC: 'litecoin',
  BCH: 'bitcoin-cash', UNI: 'uniswap', ATOM: 'cosmos', XLM: 'stellar', ICP: 'internet-computer',
  FIL: 'filecoin',
};

function isCrypto(code) {
  return CRYPTO_CODES.includes(code.toUpperCase());
}

function isFiat(code) {
  return FIAT_CODES.includes(code.toUpperCase());
}

function isCurrency(code) {
  return isFiat(code) || isCrypto(code);
}

// Lowercase list for renderer-side fuzzy matching
const ALL_CURRENCY_CODES_LOWER = [...FIAT_CODES, ...CRYPTO_CODES].map(c => c.toLowerCase());

module.exports = {
  FIAT_CODES,
  CRYPTO_CODES,
  CRYPTO_ID_MAP,
  isCrypto,
  isFiat,
  isCurrency,
  ALL_CURRENCY_CODES_LOWER,
};
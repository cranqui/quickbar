// Unit conversion handler — pure math, no API needed.

const UNIT_CONVERSIONS = {
  m: { category: 'length', factor: 1, names: ['m', 'meter', 'meters', 'mt'] },
  km: { category: 'length', factor: 1000, names: ['km', 'kilometer', 'kilometers'] },
  cm: { category: 'length', factor: 0.01, names: ['cm', 'centimeter', 'centimeters'] },
  mm: { category: 'length', factor: 0.001, names: ['mm', 'millimeter', 'millimeters'] },
  mi: { category: 'length', factor: 1609.344, names: ['mi', 'mile', 'miles'] },
  ft: { category: 'length', factor: 0.3048, names: ['ft', 'feet', 'foot'] },
  in: { category: 'length', factor: 0.0254, names: ['in', 'inch', 'inches'] },
  yd: { category: 'length', factor: 0.9144, names: ['yd', 'yard', 'yards'] },
  kg: { category: 'weight', factor: 1, names: ['kg', 'kilo', 'kilos', 'kilogram', 'kilograms'] },
  g: { category: 'weight', factor: 0.001, names: ['g', 'gram', 'grams'] },
  lb: { category: 'weight', factor: 0.453592, names: ['lb', 'lbs', 'pound', 'pounds'] },
  oz: { category: 'weight', factor: 0.0283495, names: ['oz', 'ounce', 'ounces'] },
  ton: { category: 'weight', factor: 1000, names: ['ton', 'tons', 'tonne', 'tonnes'] },
  l: { category: 'volume', factor: 1, names: ['l', 'liter', 'liters', 'litre', 'litres'] },
  ml: { category: 'volume', factor: 0.001, names: ['ml', 'milliliter', 'milliliters'] },
  gal: { category: 'volume', factor: 3.78541, names: ['gal', 'gallon', 'gallons'] },
  qt: { category: 'volume', factor: 0.946353, names: ['qt', 'quart', 'quarts'] },
  cup: { category: 'volume', factor: 0.236588, names: ['cup', 'cups'] },
  floz: { category: 'volume', factor: 0.0295735, names: ['floz', 'fluidounce', 'fluidounces'] },
  ms: { category: 'speed', factor: 1, names: ['ms', 'm/s'] },
  kmh: { category: 'speed', factor: 0.277778, names: ['kmh', 'km/h', 'kph'] },
  mph: { category: 'speed', factor: 0.44704, names: ['mph', 'mi/h'] },
  knot: { category: 'speed', factor: 0.514444, names: ['knot', 'knots', 'kn'] },
  b: { category: 'data', factor: 1, names: ['b', 'byte', 'bytes'] },
  kb: { category: 'data', factor: 1024, names: ['kb', 'kilobyte', 'kilobytes'] },
  mb: { category: 'data', factor: 1048576, names: ['mb', 'megabyte', 'megabytes'] },
  gb: { category: 'data', factor: 1073741824, names: ['gb', 'gigabyte', 'gigabytes'] },
  tb: { category: 'data', factor: 1099511627776, names: ['tb', 'terabyte', 'terabytes'] },
  s: { category: 'time', factor: 1, names: ['s', 'sec', 'second', 'seconds'] },
  min: { category: 'time', factor: 60, names: ['min', 'minute', 'minutes'] },
  hr: { category: 'time', factor: 3600, names: ['hr', 'hour', 'hours', 'hrs'] },
  day: { category: 'time', factor: 86400, names: ['day', 'days'] },
  week: { category: 'time', factor: 604800, names: ['week', 'weeks'] },
  year: { category: 'time', factor: 31536000, names: ['year', 'years', 'yr'] },
};

const UNIT_LOOKUP = {};
for (const [canonical, info] of Object.entries(UNIT_CONVERSIONS)) {
  for (const name of info.names) {
    UNIT_LOOKUP[name.toLowerCase()] = { canonical, ...info };
  }
}

const TEMP_NAMES = ['c', 'f', 'k', 'celsius', 'fahrenheit', 'kelvin'];

function isTempUnit(u) {
  return TEMP_NAMES.includes(u.toLowerCase());
}

function convertTemp(amount, from, to) {
  let celsius;
  if (from === 'c' || from === 'celsius') celsius = amount;
  else if (from === 'f' || from === 'fahrenheit') celsius = (amount - 32) * 5 / 9;
  else if (from === 'k' || from === 'kelvin') celsius = amount - 273.15;

  if (to === 'c' || to === 'celsius') return celsius;
  if (to === 'f' || to === 'fahrenheit') return celsius * 9 / 5 + 32;
  if (to === 'k' || to === 'kelvin') return celsius + 273.15;
  return null;
}

function parseUnitConversion(text) {
  const m = text.match(/^([\d.,]+)\s+([a-zA-Z/]+)\s+(?:to|in|as)\s+([a-zA-Z/]+)$/i);
  if (!m) return null;
  const amount = parseFloat(m[1].replace(/,/g, ''));
  const fromUnit = m[2].toLowerCase();
  const toUnit = m[3].toLowerCase();
  if (isNaN(amount)) return null;

  if (isTempUnit(fromUnit) && isTempUnit(toUnit)) {
    const result = convertTemp(amount, fromUnit, toUnit);
    if (result !== null) {
      return { ok: true, result: Math.round(result * 100) / 100, type: 'unit', label: `${m[1]} ${m[2]} = ${Math.round(result * 100) / 100} ${m[3]}` };
    }
    return null;
  }

  const from = UNIT_LOOKUP[fromUnit];
  const to = UNIT_LOOKUP[toUnit];
  if (!from || !to) return null;
  if (from.category !== to.category) return null;

  const result = (amount * from.factor) / to.factor;
  const rounded = result < 1 ? Math.round(result * 1e6) / 1e6 : Math.round(result * 100) / 100;
  return { ok: true, result: rounded, type: 'unit', label: `${m[1]} ${m[2]} = ${rounded} ${m[3]}` };
}

function register(ipcMain) {
  ipcMain.handle('convert-unit', async (event, text) => {
    return parseUnitConversion(text);
  });
}

module.exports = { register, parseUnitConversion };
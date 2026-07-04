const SystemConfig = require('./models/SystemConfig');

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const cache = {};
let rotateIndex = 0;

async function getConfigValue(key, fallback = '') {
    const now = Date.now();
    if (cache[key] && now - cache[key].ts < CACHE_TTL) {
        return cache[key].value;
    }
    try {
        const doc = await SystemConfig.findOne({ key });
        const value = doc?.value || fallback;
        cache[key] = { value, ts: now };
        return value;
    } catch {
        return fallback;
    }
}

async function getNextApiKey(fallback = '') {
    const raw = await getConfigValue('OPENROUTER_API_KEY', fallback);
    let keys;
    try {
        const parsed = JSON.parse(raw);
        keys = Array.isArray(parsed) ? parsed.filter(Boolean) : (raw ? [raw] : []);
    } catch {
        keys = raw ? [raw] : [];
    }
    if (!keys.length) return '';
    const key = keys[rotateIndex % keys.length];
    rotateIndex++;
    return key;
}

module.exports = { getConfigValue, getNextApiKey };

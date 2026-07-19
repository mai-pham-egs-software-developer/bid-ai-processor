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
    const idx = rotateIndex % keys.length;
    const key = keys[idx];
    const masked = key.length > 10 ? key.slice(0, 6) + '...' + key.slice(-4) : '***';
    console.log(`[ai] using key[${idx + 1}/${keys.length}] ${masked}`);
    rotateIndex++;
    return key;
}

async function getModel() {
    const raw = await getConfigValue('OPENROUTER_MODEL', process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite');
    try {
        const parsed = JSON.parse(raw);
        return (Array.isArray(parsed) ? parsed[0] : raw) || 'google/gemini-2.5-flash-lite';
    } catch { return raw || 'google/gemini-2.5-flash-lite'; }
}

let anthropicRotateIndex = 0; // separate counter from OpenRouter's `rotateIndex` — independent rotation

async function getNextAnthropicKey(fallback = '') {
    const raw = await getConfigValue('ANTHROPIC_API_KEY', fallback);
    let keys;
    try {
        const parsed = JSON.parse(raw);
        keys = Array.isArray(parsed) ? parsed.filter(Boolean) : (raw ? [raw] : []);
    } catch {
        keys = raw ? [raw] : [];
    }
    if (!keys.length) return '';
    const idx = anthropicRotateIndex % keys.length;
    const key = keys[idx];
    const masked = key.length > 10 ? key.slice(0, 6) + '...' + key.slice(-4) : '***';
    console.log(`[ai] using anthropic key[${idx + 1}/${keys.length}] ${masked}`);
    anthropicRotateIndex++;
    return key;
}

async function getAnthropicModel() {
    const raw = await getConfigValue('ANTHROPIC_MODEL', process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5');
    try {
        const parsed = JSON.parse(raw);
        return (Array.isArray(parsed) ? parsed[0] : raw) || 'claude-haiku-4-5';
    } catch { return raw || 'claude-haiku-4-5'; }
}

// Namespaced per-service (AI_PROVIDER_BID_AI_PROCESSOR) rather than a shared
// "AI_PROVIDER" key — all bid_crawler services point at the same MongoDB
// SystemConfig collection, so a flat key would flip every service's provider at once.
async function getAiProvider() {
    const raw = await getConfigValue('AI_PROVIDER_BID_AI_PROCESSOR', process.env.AI_PROVIDER || 'openrouter');
    const v = String(raw || 'openrouter').trim().toLowerCase();
    return v === 'anthropic' ? 'anthropic' : 'openrouter';
}

module.exports = { getConfigValue, getNextApiKey, getModel, getNextAnthropicKey, getAnthropicModel, getAiProvider };

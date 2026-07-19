const { getAllApiKeys, getAiProvider } = require('./config');

// OpenRouter's /api/v1/key endpoint reports *cumulative* usage for the
// authenticated key — snapshotting it before/after a run and diffing gives
// the real $ cost of that run without summing per-call pricing ourselves.
// Only meaningful for the openrouter provider: Anthropic's usage/cost API
// requires an org-level admin key, not a regular API key, so there's
// nothing to snapshot on that path.
async function getUsageSnapshot() {
    const provider = await getAiProvider();
    if (provider !== 'openrouter') return null;

    const keys = await getAllApiKeys(process.env.OPENROUTER_API_KEY || '');
    if (!keys.length) return null;

    let usage = 0, limit = null, limitRemaining = null;
    for (const key of keys) {
        try {
            const r = await fetch('https://openrouter.ai/api/v1/key', {
                headers: { Authorization: `Bearer ${key}` },
            });
            const json = await r.json();
            if (json?.data) {
                usage += json.data.usage || 0;
                if (limit == null) limit = json.data.limit;
                if (limitRemaining == null) limitRemaining = json.data.limit_remaining;
            }
        } catch (e) {
            console.warn(`[usage] failed to fetch key usage: ${e.message}`);
        }
    }
    return { usage, limit, limitRemaining };
}

module.exports = { getUsageSnapshot };

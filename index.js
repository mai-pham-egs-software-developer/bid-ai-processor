require('dotenv').config();

const path = require('path');
const express = require('express');
const schedule = require('node-schedule');
const { connectMongo } = require('./mongo');
const { processBids } = require('./pipeline');
const AiProcessRecord = require('./models/AiProcessRecord');
const Bid = require('./models/Bid');

const app = express();
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const PORT    = process.env.PORT    || 3002;
const AI_CRON = process.env.AI_CRON || '0 4 * * *';

// ── Admin UI ──────────────────────────────────────────────────────
app.get('/', async (req, res) => {
    try {
        const [total, done, error, noC5, pending] = await Promise.all([
            AiProcessRecord.countDocuments(),
            AiProcessRecord.countDocuments({ status: 'done' }),
            AiProcessRecord.countDocuments({ status: 'error' }),
            AiProcessRecord.countDocuments({ status: 'no_c5' }),
            AiProcessRecord.countDocuments({ status: 'pending' }),
        ]);
        res.render('index', { stats: { total, done, error, noC5, pending }, cron: AI_CRON });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// ── API ───────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => res.json({ status: 'ok', cron: AI_CRON }));

app.get('/api/stats', async (req, res) => {
    try {
        const [total, done, error, noC5, pending] = await Promise.all([
            AiProcessRecord.countDocuments(),
            AiProcessRecord.countDocuments({ status: 'done' }),
            AiProcessRecord.countDocuments({ status: 'error' }),
            AiProcessRecord.countDocuments({ status: 'no_c5' }),
            AiProcessRecord.countDocuments({ status: 'pending' }),
        ]);
        res.json({ total, done, error, noC5, pending });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// List records
app.get('/api/records', async (req, res) => {
    try {
        const { status, q, page = 1, limit = 50 } = req.query;
        const filter = {};
        if (status) filter.status = status;
        if (q) filter.$or = [
            { notifyNo: { $regex: q, $options: 'i' } },
            { bidName:  { $regex: q, $options: 'i' } },
            { lotName:  { $regex: q, $options: 'i' } },
        ];
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [records, total] = await Promise.all([
            AiProcessRecord.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(parseInt(limit)),
            AiProcessRecord.countDocuments(filter),
        ]);
        res.json({ records, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get full tech requirements for one record
app.get('/api/records/:id', async (req, res) => {
    try {
        const record = await AiProcessRecord.findById(req.params.id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Delete (re-queue)
app.delete('/api/records/:id', async (req, res) => {
    try {
        await AiProcessRecord.findByIdAndDelete(req.params.id);
        res.json({ message: 'deleted' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Re-process a single bid by notifyNo
app.post('/api/process/:notifyNo', async (req, res) => {
    const { notifyNo } = req.params;
    res.json({ message: `Processing ${notifyNo}` });
    processBids({ notifyNo }).catch(e => console.error('[ai] Error:', e.message));
});

// Retry all errored records
app.post('/api/retry-errors', async (req, res) => {
    try {
        const result = await AiProcessRecord.deleteMany({ status: 'error' });
        res.json({ deleted: result.deletedCount });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Manual full run
app.post('/api/run', async (req, res) => {
    res.json({ message: 'AI processing started' });
    processBids().catch(e => console.error('[ai] Run error:', e.message));
});

// List bids for the search-by-notifyNo trigger
app.get('/api/bids', async (req, res) => {
    try {
        const { q, limit = 20 } = req.query;
        const filter = q
            ? { $or: [{ notifyNo: { $regex: q, $options: 'i' } }, { bidName: { $regex: q, $options: 'i' } }] }
            : {};
        const bids = await Bid.find(filter)
            .select('notifyNo bidName investorName lotDTOList')
            .sort({ createdAt: -1 })
            .limit(parseInt(limit));
        res.json(bids);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

async function start() {
    await connectMongo();

    schedule.scheduleJob(AI_CRON, () => {
        console.log('[ai] Scheduled run starting...');
        processBids().catch(e => console.error('[ai] Scheduled run error:', e.message));
    });

    app.listen(PORT, () => {
        console.log(`[ai] Server running on port ${PORT}`);
        console.log(`[ai] Cron: ${AI_CRON}`);
    });
}

start().catch(e => {
    console.error('[ai] Startup failed:', e.message);
    process.exit(1);
});

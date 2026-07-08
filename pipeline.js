const Bid = require('./models/Bid');
const AiProcessRecord = require('./models/AiProcessRecord');
const { findC5File } = require('./c5finder');
const { getObjectText } = require('./minio');
const { extractTechRequirements } = require('./ai');

// Small delay between AI calls to avoid rate-limit bursts
const AI_DELAY_MS = parseInt(process.env.AI_DELAY_MS || '500');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function processBids(options = {}) {
    // options.notifyNo → single bid; options.limit → cap
    const filter = { isMedical: true, aiYcktStatus: { $ne: 'done' } };
    if (options.notifyNo) filter.notifyNo = options.notifyNo;

    const bids = await Bid.find(filter)
        .select('notifyNo bidName investorName lotDTOList files')
        .limit(options.limit || 500);

    console.log(`[ai] Processing ${bids.length} bids`);

    let processed = 0, skipped = 0, errors = 0, noC5 = 0;

    for (const bid of bids) {
        if (!bid.lotDTOList || bid.lotDTOList.length === 0) { skipped++; continue; }

        const result = await processBid(bid);
        processed += result.processed;
        skipped   += result.skipped;
        errors    += result.errors;
        if (result.noC5) noC5++;
    }

    const summary = { processed, skipped, errors, noC5, total: bids.length };
    console.log(`[ai] Done — processed: ${processed}, skipped: ${skipped}, errors: ${errors}, no_c5: ${noC5}`);
    return summary;
}

async function processBid(bid) {
    const bidName  = Array.isArray(bid.bidName) ? bid.bidName[0] : bid.bidName;
    const lotCount = bid.lotDTOList?.length || 0;
    let processed = 0, skipped = 0, errors = 0;

    // Skip entire bid if every lot already has a done record
    const doneCount = await AiProcessRecord.countDocuments({
        notifyNo: bid.notifyNo,
        status: 'done',
    });
    if (doneCount >= lotCount) {
        console.log(`[ai] skip ${bid.notifyNo} — all ${lotCount} lot(s) already done`);
        await Bid.updateOne({ _id: bid._id }, { aiYcktStatus: 'done' });
        return { processed: 0, skipped: lotCount, errors: 0, noC5: false };
    }

    // 1. Find Chapter V .md file in bid-ocr bucket
    const c5Key = await findC5File(bid.notifyNo);

    if (!c5Key) {
        console.log(`[ai] no C5 file for ${bid.notifyNo}`);
        // Mark all lots as no_c5 so we don't keep scanning
        await Promise.all(bid.lotDTOList.map(lot =>
            AiProcessRecord.findOneAndUpdate(
                { notifyNo: bid.notifyNo, lotId: lot.id || lot.lotNo },
                {
                    status: 'no_c5', bidId: bid._id,
                    bidName, investorName: bid.investorName,
                    lotNo: lot.lotNo, lotName: lot.lotName,
                },
                { upsert: true }
            )
        ));
        return { processed: 0, skipped: 0, errors: 0, noC5: true };
    }

    // A real attempt is starting now — count it against the bid regardless of outcome
    await Bid.updateOne({ _id: bid._id }, { $inc: { aiYcktAttempt: 1 } });

    // 2. Read C5 content (once per bid)
    let c5Content;
    try {
        c5Content = await getObjectText(c5Key);
    } catch (e) {
        console.error(`[ai] Failed to read C5 file ${c5Key}: ${e.message}`);
        await Bid.updateOne({ _id: bid._id }, { aiYcktStatus: 'error' });
        return { processed: 0, skipped: 0, errors: bid.lotDTOList.length, noC5: false };
    }

    // 3. Process each lot
    for (const lot of bid.lotDTOList) {
        const lotId = lot.id || lot.lotNo;

        // Skip if already done
        const done = await AiProcessRecord.findOne({ notifyNo: bid.notifyNo, lotId, status: 'done' });
        if (done) { skipped++; continue; }

        // Mark in-progress
        const record = await AiProcessRecord.findOneAndUpdate(
            { notifyNo: bid.notifyNo, lotId },
            {
                status: 'pending', bidId: bid._id,
                bidName, investorName: bid.investorName,
                lotNo: lot.lotNo, lotName: lot.lotName,
                c5FileKey: c5Key,
                $unset: { error: '' },
            },
            { upsert: true, new: true }
        );

        try {
            await sleep(AI_DELAY_MS);
            const result = await extractTechRequirements(bid, lot, c5Content);
            record.status = 'done';
            record.techRequirements = result;
            record.processedAt = new Date();
            await record.save();
            console.log(`[ai] ✓ ${bid.notifyNo} / Lot ${lot.lotNo} — ${result.items?.length ?? 0} items (key=${result.maskedKey})`);
            processed++;
        } catch (e) {
            record.status = 'error';
            record.error = e.message;
            await record.save();
            console.error(`[ai] ✗ ${bid.notifyNo} / Lot ${lot.lotNo}: ${e.message}`);
            errors++;
        }
    }

    await Bid.updateOne({ _id: bid._id }, { aiYcktStatus: errors > 0 ? 'error' : 'done' });

    return { processed, skipped, errors, noC5: false };
}

module.exports = { processBids, processBid };

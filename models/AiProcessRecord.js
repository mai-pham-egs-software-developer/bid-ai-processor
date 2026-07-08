const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    notifyNo: { type: String, required: true },
    bidId: mongoose.Schema.Types.ObjectId,
    bidName: String,
    investorName: String,
    lotId: String,
    lotNo: String,
    lotName: String,
    c5FileKey: String,
    status: {
        type: String,
        enum: ['pending', 'done', 'error', 'no_c5'],
        default: 'pending',
    },
    techRequirements: {
        found: Boolean,
        items: [{
            stt: String,
            name: String,
            technicalSpec: String,
            unit: String,
            quantity: mongoose.Schema.Types.Mixed,
        }],
        generalRequirements: String,
        summary: String,
        raw: String,
        truncated: { type: Boolean, default: false },
    },
    error: String,
    processedAt: Date,
}, { timestamps: true });

schema.index({ notifyNo: 1, lotId: 1 }, { unique: true });

module.exports = mongoose.model('AiProcessRecord', schema);

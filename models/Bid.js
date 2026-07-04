const mongoose = require('mongoose');

const bidSchema = new mongoose.Schema({
    id: String,
    keyword: String,
    notifyId: String,
    bidCloseDate: Date,
    bidName: [String],
    investField: [String],
    notifyNo: String,
    processApply: String,
    publicDate: Date,
    status: String,
    investorName: String,
    bidOpenDate: Date,
    bidPrice: [Number],
    lotDTOList: [{
        id: String,
        lotNo: String,
        lotName: String,
        lotEstimatePrice: Number,
        lotGuaranteeValue: String,
    }],
    files: [{
        fileId: String,
        fileName: String,
        type: { type: String },
    }],
    label: String,
    isMedical: Boolean,
    isTestKit: Boolean,
}, { timestamps: true });

module.exports = mongoose.models.Bid || mongoose.model('Bid', bidSchema);

const mongoose = require('mongoose');

const systemConfigSchema = new mongoose.Schema({
    key:   { type: String, required: true, unique: true, trim: true },
    value: { type: String, default: '' },
    label: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.models.SystemConfig || mongoose.model('SystemConfig', systemConfigSchema, 'systemconfigs');

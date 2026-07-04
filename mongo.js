const mongoose = require('mongoose');

async function connectMongo() {
    const uri = process.env.MONGODB_URI || 'mongodb://admin:admin@localhost:27017/bid_crawler?authSource=admin';
    await mongoose.connect(uri);
    console.log('[mongo] Connected to MongoDB');
}

module.exports = { connectMongo };

const Minio = require('minio');

const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000'),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'admin',
    secretKey: process.env.MINIO_SECRET_KEY || 'admin123',
});

const OCR_BUCKET = process.env.OCR_BUCKET || 'bid-ocr';

function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', c => chunks.push(c));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

async function listObjects(prefix) {
    return new Promise((resolve, reject) => {
        const items = [];
        const stream = minioClient.listObjects(OCR_BUCKET, prefix, true);
        stream.on('data', obj => items.push(obj));
        stream.on('end', () => resolve(items));
        stream.on('error', reject);
    });
}

async function getObjectText(key) {
    const stream = await minioClient.getObject(OCR_BUCKET, key);
    const buf = await streamToBuffer(stream);
    return buf.toString('utf-8');
}

module.exports = { minioClient, OCR_BUCKET, listObjects, getObjectText };

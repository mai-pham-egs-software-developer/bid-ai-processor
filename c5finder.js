const { listObjects, getObjectText } = require('./minio');

// Normalize Vietnamese filename to ASCII-ish for pattern matching.
// Collapse every run of non-alphanumeric characters to a single space (not an
// underscore) so the `\b` word-boundary checks below actually work — an
// underscore is itself a word character, so e.g. "chuong_v_pdf" (from
// "Chương V.pdf") has no boundary after "v" and every \b-anchored pattern
// below would silently never match.
function normalize(str) {
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')   // strip diacritics
        .replace(/đ/g, 'd')                 // ð → d
        .replace(/[^a-z0-9]+/g, ' ')        // non-alphanumeric run → single space
        .trim();
}

// Score a filename on how likely it is to be Chapter V
function scoreFilename(filename) {
    const n = normalize(filename);
    let score = 0;

    // Strong signals: explicit chapter V markers
    if (/chuong ?v\b/.test(n))                     score += 100;
    if (/chuong ?5\b/.test(n))                     score += 100;
    if (/chapter ?v\b/.test(n))                    score += 100;
    if (/chapter ?5\b/.test(n))                    score += 100;
    if (/phu ?luc ?(v\b|5\b)/.test(n))             score += 90;
    if (/\bc ?v\b/.test(n))                        score += 80;
    if (/\bch ?v\b/.test(n))                       score += 80;
    if (/\bc5\b/.test(n))                          score += 80;
    if (/\bch5\b/.test(n))                         score += 80;

    // Medium signals: content-type keywords
    if (/yeu ?cau ?ky ?thuat/.test(n))             score += 70;
    // "Yêu cầu KT" — abbreviating "kỹ thuật" as "KT" is a very common
    // real-world filename pattern for this same document (technical
    // requirements), seen more often in practice than the spelled-out form.
    if (/yeu ?cau ?kt\b/.test(n))                  score += 70;
    if (/yckt/.test(n))                             score += 70;
    if (/tieu ?chuan ?ky ?thuat/.test(n))          score += 60;
    if (/ky ?thuat/.test(n))                       score += 40;
    if (/technical ?(spec|req)/.test(n))           score += 70;

    // Weak signals: generic spec keywords
    if (/thong ?so/.test(n))                       score += 20;
    if (/spec/.test(n))                             score += 15;

    // Penalty: clearly not C5
    if (/chuong ?(i|1|ii|2|iii|3|iv|4|vi|6|vii|7)\b/.test(n)) score -= 200;
    if (/hop ?dong/.test(n))                       score -= 100;
    if (/chao ?gia/.test(n))                       score -= 100;

    return score;
}

// Peek at the first ~400 chars of an .md file to check for a Chương V heading
async function peekContentScore(key) {
    try {
        const text = await getObjectText(key);
        const head = text.slice(0, 400).toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

        if (/chuong\s*(v|5)\b/.test(head))             return 80;
        if (/chapter\s*(v|5)\b/.test(head))            return 80;
        if (/yeu cau ky thuat|yckt/.test(head))        return 60;
        return 0;
    } catch {
        return 0;
    }
}

async function findC5File(notifyNo) {
    const prefix = `${notifyNo}/`;
    const objects = await listObjects(prefix);
    const mdFiles = objects.filter(o => o.name.endsWith('.md'));

    if (mdFiles.length === 0) return null;

    // Score each file by filename
    const candidates = mdFiles.map(o => ({
        key: o.name,
        score: scoreFilename(o.name),
    }));

    // Sort descending by score
    candidates.sort((a, b) => b.score - a.score);

    // If top candidate has a strong name signal, use it without reading content
    if (candidates[0].score >= 70) {
        return candidates[0].key;
    }

    // Otherwise peek at content of the top 5 candidates to find best match
    const top = candidates.slice(0, 5);
    const withContent = await Promise.all(
        top.map(async c => ({
            key: c.key,
            score: c.score + await peekContentScore(c.key),
        }))
    );
    withContent.sort((a, b) => b.score - a.score);

    return withContent[0].score > 0 ? withContent[0].key : null;
}

module.exports = { findC5File };

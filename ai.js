const { getNextApiKey } = require('./config');

function buildPrompt(bid, lot) {
    const bidName = Array.isArray(bid.bidName) ? bid.bidName[0] : bid.bidName;
    const price = lot.lotEstimatePrice
        ? Number(lot.lotEstimatePrice).toLocaleString('vi-VN') + ' VND'
        : 'N/A';

    return `You are an expert at analyzing Vietnamese government procurement bid documents (Hồ sơ mời thầu).

## Bid Information
- Bid Name: ${bidName || 'N/A'}
- Investor: ${bid.investorName || 'N/A'}
- Notify No: ${bid.notifyNo}

## Lot Being Analyzed
- Lot Number: ${lot.lotNo || 'N/A'}
- Lot Name: ${lot.lotName || 'N/A'}
- Estimated Price: ${price}

The attached file is Chapter V (Chương V) — Technical Requirements of this bid document.

## Task
From the attached Chapter V document, extract the technical requirements that apply to **Lot ${lot.lotNo} — ${lot.lotName}**.

Instructions:
- If the document covers multiple lots, extract only the items for this specific lot.
- If the document has no lot separation, extract all items (they apply to all lots).
- Preserve exact technical specifications — do not paraphrase or summarize specs.
- For table data, each row represents one item.

Return ONLY valid JSON (no markdown fences, no extra text):
{
  "lotNo": "${lot.lotNo}",
  "lotName": "${lot.lotName}",
  "found": true,
  "items": [
    {
      "stt": 1,
      "name": "Item/product name",
      "technicalSpec": "Full technical specification text",
      "unit": "unit of measurement",
      "quantity": null
    }
  ],
  "generalRequirements": "Any general requirements that apply to all items, or empty string",
  "summary": "1-2 sentence summary of the main technical requirements"
}

If no technical requirements are found for this lot, return:
{ "lotNo": "${lot.lotNo}", "lotName": "${lot.lotName}", "found": false, "items": [], "generalRequirements": "", "summary": "No technical requirements found for this lot." }`;
}

async function callOpenRouter(apiKey, model, maxTokens, fileBase64, promptText) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            temperature: 0.1,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: promptText },
                    { type: 'image_url', image_url: { url: `data:text/plain;base64,${fileBase64}` } },
                ],
            }],
        }),
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
}

async function extractTechRequirements(bid, lot, c5Content) {
    const apiKey = await getNextApiKey(process.env.OPENROUTER_API_KEY || '');
    const model  = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite';

    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured (set it in the be admin panel)');

    // Encode C5 markdown as base64 — sent as inline text/plain via image_url data URI
    // (Gemini accepts text/plain data URIs through OpenRouter's multimodal pipeline)
    const fileBase64 = Buffer.from(c5Content, 'utf-8').toString('base64');
    const promptText = buildPrompt(bid, lot);
    let maxTokens    = parseInt(process.env.AI_MAX_TOKENS || '2000');

    let { response, data } = await callOpenRouter(apiKey, model, maxTokens, fileBase64, promptText);

    // If OpenRouter says we can't afford the requested tokens, retry with what we can afford
    if (!response.ok) {
        const msg        = data.error?.message || '';
        const affordable = parseInt(msg.match(/can only afford (\d+)/)?.[1]);
        if (affordable > 0 && affordable < maxTokens) {
            console.log(`[ai] Retrying with reduced max_tokens: ${affordable} (was ${maxTokens})`);
            ({ response, data } = await callOpenRouter(apiKey, model, affordable, fileBase64, promptText));
        }
    }

    if (!response.ok) {
        throw new Error(data.error?.message || `OpenRouter error ${response.status}`);
    }

    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error('Empty response from AI');

    // Strip markdown code fences if the model wrapped JSON anyway
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let parsed;
    try {
        parsed = JSON.parse(jsonStr);
    } catch {
        return { found: false, items: [], generalRequirements: '', summary: 'AI response could not be parsed as JSON.', raw };
    }

    return { ...parsed, raw };
}

module.exports = { extractTechRequirements };

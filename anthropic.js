const Anthropic = require('@anthropic-ai/sdk');
const { getNextAnthropicKey, getAnthropicModel } = require('./config');

async function getClient() {
    const apiKey = await getNextAnthropicKey(process.env.ANTHROPIC_API_KEY || '');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured (set it via the be admin panel)');
    return new Anthropic({ apiKey });
}

class AnthropicTruncatedError extends Error {}
class AnthropicRefusalError extends Error {}

// claude-sonnet-5 / claude-opus-4-6+ / claude-fable-5 / claude-mythos-5 run adaptive
// thinking by default when `thinking` is omitted — unwanted latency/cost for a
// single-shot extraction call. They accept an explicit {type:'disabled'}.
// claude-haiku-4-5 (our default) has no adaptive mode and needs no override.
function supportsExplicitThinkingDisable(model) {
    return /^claude-(sonnet-5|opus-4-[6-9]|fable-5|mythos-5)/.test(model);
}

// Single-shot JSON-schema-constrained completion — the Anthropic counterpart to
// this codebase's OpenRouter `response_format:{type:'json_object'}` + JSON.parse
// pattern. Schema validation means callers don't need a salvage-parser here.
async function completeJson({ system, userContent, jsonSchema, maxTokens, model }) {
    const client = await getClient();
    const resolvedModel = model || await getAnthropicModel();

    const params = {
        model: resolvedModel,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: userContent }],
        output_config: { format: { type: 'json_schema', schema: jsonSchema } },
    };
    if (system) params.system = system;
    if (supportsExplicitThinkingDisable(resolvedModel)) params.thinking = { type: 'disabled' };

    const response = await client.messages.create(params);

    if (response.stop_reason === 'refusal') {
        throw new AnthropicRefusalError(
            response.stop_details?.explanation || 'Anthropic declined the request (refusal)'
        );
    }
    if (response.stop_reason === 'max_tokens') {
        throw new AnthropicTruncatedError(`Anthropic response truncated at max_tokens=${maxTokens}`);
    }

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || !textBlock.text) throw new Error('Empty response from Anthropic');
    return JSON.parse(textBlock.text);
}

module.exports = { completeJson, AnthropicTruncatedError, AnthropicRefusalError };

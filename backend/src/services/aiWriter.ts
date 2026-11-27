// Added for Mistwarden on 2026-11-27.
/**
 * Writing help for a GM: an NPC, a passage to read aloud, or notes, from what
 * the GM typed. The server calls the provider; the browser never does, and
 * the key never leaves the server.
 *
 * Configured only from the server's environment, so a GM who is not an admin
 * cannot point the server at an address of their choosing:
 *
 *   AI_PROVIDER   anthropic | openai (any OpenAI-compatible chat endpoint,
 *                 such as a model served in the LAN)
 *   AI_API_KEY    the provider's key; optional for openai
 *   AI_MODEL      anthropic: defaults to claude-opus-5-5; openai: required
 *   AI_BASE_URL   openai: required, e.g. http://192.168.1.20:8080/v1;
 *                 anthropic: optional, for a proxy
 *
 * What is sent: the GM's request, the kind of text, and the campaign's name
 * and game system. Nothing about players, maps or documents.
 */

import Anthropic from '@anthropic-ai/sdk';

export const AI_KINDS = ['npc', 'read-aloud', 'note'] as const;
export type AiKind = (typeof AI_KINDS)[number];

export interface AiConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/** Under nginx's 60 seconds for /api/, so a slow provider answers 504 from us, not from the proxy. */
export const AI_TIMEOUT_MS = 55_000;

/** The models that accept server-side refusal fallbacks (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

export class AiNotConfiguredError extends Error {}
/** The provider declined or failed; `message` is safe to show the GM. */
export class AiProviderError extends Error {}

/** The configuration, or null when writing help is off on this server. */
export function aiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  const provider = env.AI_PROVIDER?.trim().toLowerCase();
  const apiKey = env.AI_API_KEY?.trim() ?? '';
  const model = env.AI_MODEL?.trim() ?? '';
  const baseUrl = env.AI_BASE_URL?.trim() || undefined;
  if (provider === 'anthropic' && apiKey) return { provider, apiKey, model: model || 'claude-opus-5-5', baseUrl };
  if (provider === 'openai' && baseUrl && model) return { provider, apiKey, model, baseUrl: baseUrl.replace(/\/+$/, '') };
  return null;
}

const SHAPE: Record<AiKind, string> = {
  npc:
    'Describe one non-player character the GM can use at the table: appearance, manner and voice, what they want, ' +
    'and one secret. About 150 words of prose, then three short bullet points the GM can glance at mid-scene.',
  'read-aloud':
    'Write a passage the GM reads aloud to the players: present tense, addressed to the players as a group, concrete ' +
    'sensory detail, 80 to 150 words. Describe only what the characters can perceive; no rules, numbers or secrets.',
  note: 'Write concise notes for the GM in Markdown: short headings and bullet points, no preamble.',
};

function systemPrompt(kind: AiKind, campaign: { name: string; gameSystem: string | null }): string {
  return [
    'You help the game master of a tabletop role-playing game prepare a session.',
    `The campaign is "${campaign.name}"${campaign.gameSystem ? `, played with ${campaign.gameSystem}` : ''}.`,
    SHAPE[kind],
    'Answer in the language the request is written in. Give only the text itself, without an introduction or closing remark.',
  ].join('\n');
}

/** Reasoning some local models write before their answer. */
const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

async function viaAnthropic(config: AiConfig, system: string, prompt: string): Promise<string> {
  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl, timeout: AI_TIMEOUT_MS, maxRetries: 0 });
  const fallback = FALLBACK_MODELS.has(config.model);
  const response = await client.beta.messages.create({
    model: config.model,
    max_tokens: 8000,
    // Short prose: low effort keeps the answer inside the proxy's minute.
    output_config: { effort: 'low' },
    ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    system,
    messages: [{ role: 'user', content: prompt }],
  });
  if (response.stop_reason === 'refusal') throw new AiProviderError('The model declined this request. Try wording it differently.');
  return response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('').trim();
}

async function viaOpenAiCompatible(config: AiConfig, system: string, prompt: string): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 2000,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
  if (!response.ok) throw new AiProviderError(`The AI server answered ${response.status}.`);
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new AiProviderError('The AI server sent no text.');
  return stripThinking(content);
}

/** The text for `kind` from the GM's `prompt`. Throws AiNotConfiguredError or AiProviderError. */
export async function writeForGm(
  kind: AiKind,
  prompt: string,
  campaign: { name: string; gameSystem: string | null },
  config: AiConfig | null = aiConfig()
): Promise<string> {
  if (!config) throw new AiNotConfiguredError('AI writing is not set up on this server.');
  const system = systemPrompt(kind, campaign);
  let text: string;
  try {
    text = config.provider === 'anthropic' ? await viaAnthropic(config, system, prompt) : await viaOpenAiCompatible(config, system, prompt);
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (error instanceof Anthropic.APIConnectionTimeoutError || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))) {
      throw new AiProviderError('The AI provider took too long to answer.');
    }
    if (error instanceof Anthropic.APIError && error.status) throw new AiProviderError(`The AI provider answered ${error.status}.`);
    throw new AiProviderError('The AI provider could not be reached.');
  }
  if (!text) throw new AiProviderError('The AI provider sent no text.');
  return text;
}

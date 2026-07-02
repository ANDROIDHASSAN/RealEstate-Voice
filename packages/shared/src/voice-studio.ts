/**
 * Voice Agent Studio catalog — the Vapi-style option set the builder exposes.
 * Config-driven data (not hardcoded logic): the API returns these to the UI as
 * dropdown/toggle choices, and validates saved values against them.
 */

export interface Choice {
  value: string;
  label: string;
}

/** Transcriber (speech-to-text) providers + models. */
export const STT_PROVIDERS: Choice[] = [
  { value: 'deepgram', label: 'Deepgram' },
  { value: 'openai', label: 'OpenAI Whisper' },
  { value: 'assembly', label: 'AssemblyAI' },
  { value: 'gladia', label: 'Gladia' },
  { value: 'azure', label: 'Azure' },
];
export const STT_MODELS: Record<string, Choice[]> = {
  deepgram: [
    { value: 'nova-3', label: 'Nova 3' },
    { value: 'nova-2', label: 'Nova 2' },
    { value: 'enhanced', label: 'Enhanced' },
  ],
  openai: [{ value: 'whisper-1', label: 'whisper-1' }],
  assembly: [{ value: 'best', label: 'Best' }, { value: 'nano', label: 'Nano' }],
  gladia: [{ value: 'default', label: 'Default' }],
  azure: [{ value: 'default', label: 'Default' }],
};

/** In-call model (LLM) providers + models. */
export const LLM_PROVIDERS: Choice[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'groq', label: 'Groq' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
];
export const LLM_MODELS: Record<string, Choice[]> = {
  openai: [
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { value: 'o4-mini', label: 'o4-mini' },
  ],
  groq: [
    { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
    { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (fast)' },
    { value: 'moonshotai/kimi-k2-instruct', label: 'Kimi K2' },
  ],
  anthropic: [
    { value: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
    { value: 'claude-3-5-haiku', label: 'Claude 3.5 Haiku' },
  ],
  google: [
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  ],
};

/** Voice (text-to-speech) providers + a few named voices each. */
export const TTS_PROVIDERS: Choice[] = [
  { value: '11labs', label: 'ElevenLabs' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'cartesia', label: 'Cartesia' },
  { value: 'playht', label: 'PlayHT' },
  { value: 'azure', label: 'Azure' },
];
export const TTS_VOICES: Record<string, Choice[]> = {
  '11labs': [
    { value: 'aria', label: 'Aria (warm F)' },
    { value: 'roger', label: 'Roger (calm M)' },
    { value: 'sarah', label: 'Sarah (pro F)' },
    { value: 'bill', label: 'Bill (deep M)' },
  ],
  openai: [
    { value: 'alloy', label: 'Alloy' },
    { value: 'shimmer', label: 'Shimmer' },
    { value: 'nova', label: 'Nova' },
    { value: 'onyx', label: 'Onyx' },
  ],
  cartesia: [{ value: 'sonic-en', label: 'Sonic EN' }, { value: 'sonic-multilingual', label: 'Sonic Multilingual' }],
  playht: [{ value: 'jennifer', label: 'Jennifer' }, { value: 'will', label: 'Will' }],
  azure: [{ value: 'en-US-JennyNeural', label: 'Jenny (Neural)' }, { value: 'en-US-GuyNeural', label: 'Guy (Neural)' }],
};

/** Tools an agent can be equipped with (Vapi-style capabilities). */
export interface ToolDef {
  value: string;
  label: string;
  description: string;
}
export const AGENT_TOOLS: ToolDef[] = [
  { value: 'bookAppointment', label: 'Book appointment', description: 'Create a calendar booking during the call.' },
  { value: 'transferCall', label: 'Transfer call', description: 'Warm-transfer to a human or another number.' },
  { value: 'endCall', label: 'Hang up', description: 'End the call politely when the goal is met.' },
  { value: 'leaveVoicemail', label: 'Leave voicemail', description: 'Detect voicemail and leave a scripted message.' },
  { value: 'dtmf', label: 'Press keys (DTMF)', description: 'Navigate phone menus by sending tones.' },
  { value: 'sendSms', label: 'Send text', description: 'Text a follow-up, link, or confirmation.' },
  { value: 'queryKnowledge', label: 'Query knowledge base', description: 'Retrieve grounded facts from your KB (RAG).' },
  { value: 'apiRequest', label: 'API request', description: 'Call an external API mid-conversation.' },
  { value: 'tagLead', label: 'Tag / update lead', description: 'Score and update the CRM record live.' },
];

export const AGENT_LANGUAGES: Choice[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'ar', label: 'العربية' },
  { value: 'pt', label: 'Português' },
  { value: 'ht', label: 'Kreyòl' },
];

/** Default builder values used when a preset/override leaves a field unset. */
export const VOICE_STUDIO_DEFAULTS = {
  transcriberProvider: 'deepgram',
  transcriberModel: 'nova-3',
  modelProvider: 'openai',
  modelName: 'gpt-4o',
  temperature: 0.5,
  voiceProvider: '11labs',
  voiceId: 'aria',
} as const;

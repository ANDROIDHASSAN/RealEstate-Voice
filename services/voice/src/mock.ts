import type {
  CallEventHandler,
  TranscriptTurn,
  VoiceCallRequest,
  VoiceProvider,
} from './types.js';

/**
 * [MOCK] Voice provider used when no live provider is configured.
 * The pipeline is real (dial → scripted conversation → outcome → booking);
 * only the audio leg is simulated. Lead replies are generated per-locale so
 * multilingual acceptance tests exercise real localized flows.
 */
const LEAD_REPLIES: Record<string, string[]> = {
  en: [
    'Hi, yes this is me.',
    'I am looking to buy, yes.',
    'Somewhere around four to five hundred thousand.',
    'Ideally in the next two or three months.',
    'Sure, tomorrow afternoon works great.',
    'Thank you, bye!',
  ],
  es: [
    'Hola, sí, soy yo.',
    'Sí, quiero comprar una casa.',
    'Entre cuatrocientos y quinientos mil.',
    'En los próximos dos o tres meses.',
    'Claro, mañana por la tarde me viene bien.',
    '¡Gracias, adiós!',
  ],
  ar: [
    'مرحباً، نعم أنا معك.',
    'نعم، أرغب في شراء عقار.',
    'الميزانية حوالي مليوني ريال.',
    'خلال الشهرين القادمين إن شاء الله.',
    'نعم، يناسبني موعد الغد مساءً.',
    'شكراً جزيلاً، مع السلامة!',
  ],
  pt: [
    'Olá, sim, sou eu.',
    'Sim, quero comprar um imóvel.',
    'Entre quatrocentos e quinhentos mil.',
    'Nos próximos dois ou três meses.',
    'Claro, amanhã à tarde funciona.',
    'Obrigado, tchau!',
  ],
  ht: [
    'Bonjou, wi se mwen.',
    'Wi, mwen vle achte yon kay.',
    'Anviwon kat san mil dola.',
    'Nan de twa mwa kap vini yo.',
    'Wi, demen apremidi bon pou mwen.',
    'Mèsi anpil, orevwa!',
  ],
};

export class MockVoiceProvider implements VoiceProvider {
  readonly name = 'mock';
  readonly live = false;
  readonly reason = 'No voice provider configured (DOGRAH_BASE_URL / VAPI_API_KEY / GEMINI_LIVE_API_KEY)';
  private handler: CallEventHandler | null = null;
  /** Simulated call duration; kept tiny so tests are fast. */
  private simulatedDelayMs = Number(process.env.MOCK_CALL_DELAY_MS ?? 1200);

  onCallComplete(handler: CallEventHandler): void {
    this.handler = handler;
  }

  async startOutboundCall(req: VoiceCallRequest): Promise<{ providerCallId: string }> {
    const providerCallId = `mockcall_${Math.random().toString(36).slice(2, 10)}`;
    const replies = LEAD_REPLIES[req.locale] ?? LEAD_REPLIES.en!;

    setTimeout(async () => {
      const transcript: TranscriptTurn[] = [];
      let ts = 0;
      req.resolvedScript.forEach((line, i) => {
        transcript.push({ role: 'agent', text: line, ts });
        ts += 6;
        const reply = replies[Math.min(i, replies.length - 1)]!;
        transcript.push({ role: 'lead', text: reply, ts });
        ts += 5;
      });
      // Show RAG grounding: if the agent was given knowledge, cite a fact from it.
      if (req.knowledge) {
        const fact = req.knowledge.split('\n')[0]?.replace(/^-\s*\([^)]*\)\s*/, '').slice(0, 160);
        if (fact) {
          transcript.push({ role: 'agent', text: `From what I have on file: ${fact}`, ts });
          ts += 6;
        }
      }
      const canBook = req.tools.includes('bookAppointment');
      await this.handler?.({
        callRef: req.callRef,
        providerCallId,
        status: 'completed',
        durationSec: ts,
        transcript,
        summary: `[MOCK CALL] ${req.agentKey}: lead engaged, budget ~$450k, timeline 2-3 months${canBook ? ', appointment requested for tomorrow afternoon' : ''}.`,
        outcome: canBook ? 'booked' : 'qualified',
        extracted: {
          budget: '$400k-$500k',
          timeline: '2-3 months',
          ...(canBook ? { requestedSlot: 'tomorrow 15:00' } : {}),
        },
      });
    }, this.simulatedDelayMs);

    return { providerCallId };
  }
}

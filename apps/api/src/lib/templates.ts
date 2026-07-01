import type { Locale } from '@closeflow/shared';

/** Localized outbound templates. Lead locale drives channel language (§8). */
export const TEMPLATES: Record<
  'instantReply' | 'followup1' | 'followup2' | 'bookingConfirm',
  Record<Locale, string>
> = {
  instantReply: {
    en: "Hi {{lead.firstName}}, this is {{account.name}} — thanks for reaching out about {{interest}}! I'm on it right now. When is a good time for a quick call? Reply STOP to opt out.",
    es: 'Hola {{lead.firstName}}, soy de {{account.name}} — ¡gracias por su interés en {{interest}}! Estoy revisándolo ahora mismo. ¿Cuándo le viene bien una llamada rápida? Responda ALTO para cancelar.',
    ar: 'مرحباً {{lead.firstName}}، معك {{account.name}} — شكراً لتواصلك بخصوص {{interest}}! أعمل على طلبك الآن. متى يناسبك اتصال سريع؟ أرسل توقف لإلغاء الاشتراك.',
    pt: 'Olá {{lead.firstName}}, aqui é da {{account.name}} — obrigado pelo interesse em {{interest}}! Já estou cuidando disso. Quando podemos fazer uma ligação rápida? Responda PARAR para sair.',
    ht: 'Bonjou {{lead.firstName}}, se {{account.name}} — mèsi paske ou kontakte nou pou {{interest}}! M ap travay sou li kounye a. Ki lè ou disponib pou yon ti apèl? Reponn SISPANN pou w kanpe mesaj yo.',
  },
  followup1: {
    en: 'Hi {{lead.firstName}}, just checking in — still interested in {{interest}}? I have a few options that match what you described.',
    es: 'Hola {{lead.firstName}}, ¿sigue interesado en {{interest}}? Tengo algunas opciones que encajan con lo que busca.',
    ar: 'مرحباً {{lead.firstName}}، هل ما زلت مهتماً بـ {{interest}}؟ لدي بعض الخيارات المناسبة لك.',
    pt: 'Olá {{lead.firstName}}, ainda tem interesse em {{interest}}? Tenho algumas opções que combinam com o que você procura.',
    ht: 'Bonjou {{lead.firstName}}, ou toujou enterese nan {{interest}}? Mwen gen kèk opsyon ki matche ak sa w ap chèche a.',
  },
  followup2: {
    en: "Hi {{lead.firstName}}, {{account.ownerName}} here. The market is moving fast — want me to send you this week's best matches?",
    es: 'Hola {{lead.firstName}}, soy {{account.ownerName}}. El mercado se mueve rápido — ¿le envío las mejores opciones de esta semana?',
    ar: 'مرحباً {{lead.firstName}}، معك {{account.ownerName}}. السوق يتحرك بسرعة — هل أرسل لك أفضل الخيارات هذا الأسبوع؟',
    pt: 'Olá {{lead.firstName}}, aqui é {{account.ownerName}}. O mercado está rápido — quer que eu envie as melhores opções desta semana?',
    ht: 'Bonjou {{lead.firstName}}, se {{account.ownerName}}. Mache a ap bouje vit — ou vle m voye pi bon opsyon semèn sa a ba ou?',
  },
  bookingConfirm: {
    en: 'You are booked with {{account.ownerName}} for {{slot}}. You will get a reminder before the call. Reply STOP to opt out.',
    es: 'Su cita con {{account.ownerName}} quedó agendada para {{slot}}. Recibirá un recordatorio antes de la llamada. Responda ALTO para cancelar.',
    ar: 'تم حجز موعدك مع {{account.ownerName}} في {{slot}}. ستصلك رسالة تذكير قبل الموعد. أرسل توقف لإلغاء الاشتراك.',
    pt: 'Sua reunião com {{account.ownerName}} está marcada para {{slot}}. Você receberá um lembrete antes. Responda PARAR para sair.',
    ht: 'Randevou w ak {{account.ownerName}} pwograme pou {{slot}}. W ap resevwa yon rapèl anvan apèl la. Reponn SISPANN pou w kanpe mesaj yo.',
  },
};

export function template(key: keyof typeof TEMPLATES, locale: Locale): string {
  return TEMPLATES[key][locale] ?? TEMPLATES[key].en;
}

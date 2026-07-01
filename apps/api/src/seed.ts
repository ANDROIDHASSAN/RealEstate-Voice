/**
 * Seeds the demo Empire account so the deployed link looks alive immediately.
 * Login: demo@closeflow.io / Demo1234!
 */
import './env.js';
import bcrypt from 'bcryptjs';
import { modulesForPlan } from '@closeflow/shared';
import { connectDb, disconnectDb } from './db.js';
import {
  Account,
  Appointment,
  Call,
  Compliance,
  Conversation,
  Lead,
  Sequence,
  User,
} from './models.js';

export async function seedDemo(): Promise<{ accountId: string }> {
  const email = 'demo@closeflow.io';
  const existing = await User.findOne({ email });
  if (existing) return { accountId: String(existing.accountId) };

  const account = await Account.create({
    name: 'Miami Luxe Realty',
    email,
    phone: '+13055550100',
    timezone: 'America/New_York',
    locale: 'en',
    plan: 'empire',
    enabledModules: modulesForPlan('empire'),
    ownerName: 'Alexandra Reyes',
    websiteSlug: 'miami-luxe',
  });
  await Compliance.create({ accountId: account._id });
  await User.create({
    accountId: account._id,
    name: 'Alexandra Reyes',
    email,
    passwordHash: await bcrypt.hash('Demo1234!', 12),
    role: 'owner',
  });

  const daysAgo = (d: number, h = 10) => {
    const dt = new Date(Date.now() - d * 24 * 3600 * 1000);
    dt.setHours(h, 15, 0, 0);
    return dt;
  };

  const leadSeed = [
    { firstName: 'Carlos', lastName: 'Mendez', phone: '+13055551001', email: 'carlos@example.com', locale: 'es', source: 'zillow', status: 'appointment', intent: 'buyer', urgency: '1-3mo', budget: '$450k-$550k', location: 'Brickell', score: 92, frs: 8, d: 1 },
    { firstName: 'Sarah', lastName: 'Klein', phone: '+13055551002', email: 'sarah.k@example.com', locale: 'en', source: 'facebook', status: 'qualified', intent: 'seller', urgency: 'now', location: 'Coral Gables', score: 88, frs: 12, d: 1 },
    { firstName: 'Faisal', lastName: 'Al-Otaibi', phone: '+966505551003', email: 'faisal@example.com', locale: 'ar', source: 'website', status: 'contacted', intent: 'investor', urgency: '1-3mo', budget: '$2M+', location: 'Riyadh / Miami', score: 75, frs: 6, d: 2 },
    { firstName: 'Beatriz', lastName: 'Souza', phone: '+13055551004', email: 'bea@example.com', locale: 'pt', source: 'instagram', status: 'nurture', intent: 'buyer', urgency: '3-6mo', budget: '$350k', location: 'Doral', score: 55, frs: 15, d: 3 },
    { firstName: 'Marc', lastName: 'Baptiste', phone: '+13055551005', email: 'marc.b@example.com', locale: 'ht', source: 'website', status: 'won', intent: 'buyer', urgency: 'now', budget: '$300k', location: 'North Miami', score: 100, frs: 9, d: 20 },
    { firstName: 'Jennifer', lastName: 'Wu', phone: '+13055551006', email: 'jwu@example.com', locale: 'en', source: 'zillow', status: 'new', intent: 'buyer', urgency: 'unknown', location: 'Miami Beach', score: 40, frs: 7, d: 0 },
    { firstName: 'Diego', lastName: 'Fernandez', phone: '+13055551007', email: 'diego.f@example.com', locale: 'es', source: 'facebook', status: 'contacted', intent: 'renter', urgency: 'now', budget: '$3k/mo', location: 'Wynwood', score: 62, frs: 11, d: 4 },
    { firstName: 'Emily', lastName: 'Carter', phone: '+13055551008', email: 'emilyc@example.com', locale: 'en', source: 'website', status: 'lost', intent: 'seller', urgency: '6mo+', location: 'Kendall', score: 20, frs: 30, d: 9 },
  ] as const;

  const leads = [];
  for (const s of leadSeed) {
    const createdAt = daysAgo(s.d);
    const lead = await Lead.create({
      accountId: account._id,
      firstName: s.firstName,
      lastName: s.lastName,
      phone: s.phone,
      email: s.email,
      locale: s.locale,
      source: s.source,
      status: s.status,
      intent: s.intent,
      urgency: s.urgency,
      budget: 'budget' in s ? s.budget : undefined,
      location: s.location,
      score: s.score,
      firstResponseSeconds: s.frs,
      consent: { sms: true, call: true, whatsapp: true, email: true },
      lastContactedAt: createdAt,
    });
    await Lead.updateOne({ _id: lead._id }, { $set: { createdAt } }, { timestamps: false });
    leads.push(lead);
  }

  const [carlos, sarah, faisal] = leads;

  await Call.create({
    accountId: account._id,
    leadId: carlos!._id,
    direction: 'outbound',
    provider: 'mock',
    agentKey: 'buyer-qualifier-es',
    status: 'completed',
    durationSec: 212,
    transcript: [
      { role: 'agent', text: 'Hola Carlos, le habla la asistente de Miami Luxe Realty. ¿Sigue buscando comprar?', ts: 0 },
      { role: 'lead', text: 'Sí, busco un apartamento en Brickell.', ts: 6 },
      { role: 'agent', text: '¿Cuál es su presupuesto aproximado?', ts: 12 },
      { role: 'lead', text: 'Entre 450 y 550 mil.', ts: 18 },
      { role: 'agent', text: 'Perfecto, le agendo una consulta con Alexandra mañana a las 3 PM.', ts: 24 },
      { role: 'lead', text: '¡Excelente, gracias!', ts: 30 },
    ],
    summary: 'Spanish buyer qualified: Brickell condo, $450k-$550k, booked consult for tomorrow 3 PM.',
    outcome: 'booked',
  });

  const apptStart = new Date(Date.now() + 24 * 3600 * 1000);
  apptStart.setHours(15, 0, 0, 0);
  await Appointment.create({
    accountId: account._id,
    leadId: carlos!._id,
    startsAt: apptStart,
    endsAt: new Date(apptStart.getTime() + 30 * 60_000),
    type: 'buyer-consult',
  });

  await Conversation.create({
    accountId: account._id,
    leadId: sarah!._id,
    channel: 'sms',
    status: 'human',
    lastInboundAt: daysAgo(0, 9),
    messages: [
      { direction: 'outbound', text: 'Hi Sarah, this is Miami Luxe Realty — thanks for reaching out about selling in Coral Gables!', ts: daysAgo(1, 9), status: 'mock-sent' },
      { direction: 'inbound', text: 'Yes! We want to list before the school year.', ts: daysAgo(0, 9), status: 'delivered' },
    ],
  });

  await Conversation.create({
    accountId: account._id,
    leadId: faisal!._id,
    channel: 'whatsapp',
    status: 'ai',
    lastInboundAt: daysAgo(1, 20),
    messages: [
      { direction: 'inbound', text: 'هل لديكم عقارات استثمارية في ميامي؟', ts: daysAgo(1, 19), status: 'delivered' },
      { direction: 'outbound', text: 'أهلاً فيصل! نعم، لدينا فرص استثمارية مميزة في بريكل وميامي بيتش. هل تفضل الوحدات الجاهزة أم قيد الإنشاء؟', ts: daysAgo(1, 20), status: 'mock-sent' },
    ],
  });

  await Sequence.create({
    accountId: account._id,
    name: 'New Buyer Nurture (EN)',
    locale: 'en',
    steps: [
      { delayHours: 0, channel: 'sms', template: 'Hi {{lead.firstName}}, great connecting! I will send a few matches shortly.' },
      { delayHours: 24, channel: 'sms', template: 'Hi {{lead.firstName}}, did you get a chance to look at the listings? Any favorites?' },
      { delayHours: 72, channel: 'email', template: 'Hi {{lead.firstName}}, here is this week\'s market update for {{interest}}. — {{account.ownerName}}' },
    ],
  });

  return { accountId: String(account._id) };
}

// Run directly: npm run seed
const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('seed.ts') || process.argv[1]?.replace(/\\/g, '/').endsWith('seed.js');
if (isMain) {
  connectDb()
    .then(seedDemo)
    .then(({ accountId }) => {
      console.log(`Seeded demo account ${accountId} (demo@closeflow.io / Demo1234!)`);
      return disconnectDb();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

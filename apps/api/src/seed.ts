/**
 * Seeds the demo Empire account so the deployed link looks alive immediately.
 * Login: demo@truecode.ai / Demo1234!
 */
import './env.js';
import bcrypt from 'bcryptjs';
import { computeTotals, docTemplate, modulesForPlan, orchestrate, quoteTemplate, type PropertyInput } from '@truecode/shared';
import { connectDb, disconnectDb } from './db.js';
import {
  Account,
  Appointment,
  Call,
  CmsContent,
  Compliance,
  Conversation,
  Deal,
  DocumentRecord,
  Invoice,
  Lead,
  LedgerEntry,
  PropertyAnalysis,
  Quote,
  Sequence,
  SiteConfig,
  User,
} from './models.js';

export async function seedDemo(): Promise<{ accountId: string }> {
  const email = 'demo@truecode.ai';
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
    // createdAt is immutable in Mongoose — backdate via the raw collection.
    await Lead.collection.updateOne({ _id: lead._id }, { $set: { createdAt, updatedAt: createdAt } });
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

  // Property Intelligence — a few pre-computed investment reports (deterministic
  // engine, no external calls) so the module is populated on first login.
  const sampleProperties: PropertyInput[] = [
    { address: '742 Brickell Bay Dr', city: 'Miami', state: 'FL', zip: '33131', propertyType: 'condo', askingPrice: 525_000, bedrooms: 2, bathrooms: 2, sqft: 1180, yearBuilt: 2016, estimatedRentMonthly: 3600, hoaMonthly: 650 },
    { address: '1820 Alton Rd', city: 'Miami Beach', state: 'FL', zip: '33139', propertyType: 'single-family', askingPrice: 890_000, bedrooms: 4, bathrooms: 3, sqft: 2450, yearBuilt: 1998 },
    { address: '355 NW 24th St', city: 'Wynwood', state: 'FL', zip: '33127', propertyType: 'multi-family', askingPrice: 415_000, bedrooms: 4, bathrooms: 4, sqft: 2100, yearBuilt: 1975, repairCost: 60_000, arv: 620_000 },
  ];
  for (const input of sampleProperties) {
    const report = orchestrate(input);
    await PropertyAnalysis.create({
      accountId: account._id,
      label: `${input.address}, ${input.city}`,
      address: input.address,
      city: input.city,
      state: input.state,
      input,
      report,
      investmentScore: report.investmentScore,
      grade: report.grade,
      recommendation: report.recommendation,
      riskLevel: report.risk.level,
      status: 'done',
      enriched: false,
    });
  }

  // Quotations — a couple of branded proposals in different states.
  const year = new Date().getUTCFullYear();
  const premium = quoteTemplate('listing-premium')!;
  const buyerRep = quoteTemplate('buyer-rep')!;
  const quoteSeed = [
    { tpl: premium, num: 1, title: 'Premium Listing Proposal — Coral Gables', client: { name: 'Sarah Klein', email: 'sarah.k@example.com', phone: '+13055551002' }, propertyAddress: 'Coral Gables, FL', taxRatePct: 7, status: 'accepted' as const },
    { tpl: buyerRep, num: 2, title: 'Buyer Representation — Brickell', client: { name: 'Carlos Mendez', email: 'carlos@example.com', phone: '+13055551001' }, propertyAddress: 'Brickell, FL', taxRatePct: 0, status: 'sent' as const },
    { tpl: premium, num: 3, title: 'Listing Proposal — Miami Beach', client: { name: 'Jennifer Wu', email: 'jwu@example.com' }, propertyAddress: 'Miami Beach, FL', taxRatePct: 7, status: 'draft' as const },
  ];
  for (const q of quoteSeed) {
    const totals = computeTotals(q.tpl.lineItems, { taxRatePct: q.taxRatePct });
    await Quote.create({
      accountId: account._id,
      number: `QT-${year}-${String(q.num).padStart(4, '0')}`,
      title: q.title,
      client: q.client,
      propertyAddress: q.propertyAddress,
      templateKey: q.tpl.key,
      lineItems: q.tpl.lineItems,
      currency: 'USD',
      taxRatePct: q.taxRatePct,
      discountType: 'none',
      discountValue: 0,
      totals,
      terms: q.tpl.terms,
      validUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      status: q.status,
      sentAt: q.status !== 'draft' ? new Date() : undefined,
      respondedAt: q.status === 'accepted' ? new Date() : undefined,
    });
  }

  // Team members (RBAC demo) + a platform super admin.
  await User.create({
    accountId: account._id, name: 'Jordan Lee', email: 'admin@truecode.ai',
    passwordHash: await bcrypt.hash('Demo1234!', 12), role: 'admin',
  });
  await User.create({
    accountId: account._id, name: 'Sam Rivera', email: 'agent@truecode.ai',
    passwordHash: await bcrypt.hash('Demo1234!', 12), role: 'agent',
  });
  await User.create({
    accountId: account._id, name: 'Riley Viewer', email: 'viewer@truecode.ai',
    passwordHash: await bcrypt.hash('Demo1234!', 12), role: 'viewer',
  });
  // Platform operator — sees the cross-tenant /admin surface. (super@truecode.ai / Super1234!)
  await User.create({
    accountId: account._id, name: 'Platform Admin', email: 'super@truecode.ai',
    passwordHash: await bcrypt.hash('Super1234!', 12), role: 'admin', platformRole: 'superadmin',
  });

  // A couple of extra tenants so the super-admin dashboard has a portfolio.
  const extraTenants = [
    { name: 'Sunset Realty Group', email: 'owner@sunsetrealty.example', plan: 'pro' as const, owner: 'Priya Anand' },
    { name: 'Downtown Property Partners', email: 'owner@downtownpp.example', plan: 'starter' as const, owner: 'Marcus Bell' },
  ];
  for (const tn of extraTenants) {
    if (await User.findOne({ email: tn.email })) continue;
    const acc = await Account.create({ name: tn.name, email: tn.email, plan: tn.plan, enabledModules: modulesForPlan(tn.plan), ownerName: tn.owner });
    await Compliance.create({ accountId: acc._id });
    await User.create({ accountId: acc._id, name: tn.owner, email: tn.email, passwordHash: await bcrypt.hash('Demo1234!', 12), role: 'owner' });
    await Lead.create([
      { accountId: acc._id, firstName: 'Sample', lastName: 'Buyer', phone: '+13055559001', source: 'website', status: 'new', intent: 'buyer' },
      { accountId: acc._id, firstName: 'Sample', lastName: 'Seller', phone: '+13055559002', source: 'zillow', status: 'contacted', intent: 'seller' },
    ]);
  }

  // Deal pipeline — a few transactions across stages.
  await Deal.create([
    { accountId: account._id, title: 'Brickell condo — Carlos', clientName: 'Carlos Mendez', propertyAddress: 'Brickell, FL', side: 'buyer', stage: 'under-contract', value: 520000, commissionPct: 3, tasks: [{ title: 'Order inspection', done: true }, { title: 'Appraisal', done: false }] },
    { accountId: account._id, title: 'Coral Gables listing — Klein', clientName: 'Sarah Klein', propertyAddress: 'Coral Gables, FL', side: 'seller', stage: 'closing', value: 890000, commissionPct: 2.5, tasks: [{ title: 'Final walkthrough', done: false }] },
    { accountId: account._id, title: 'North Miami — Baptiste', clientName: 'Marc Baptiste', propertyAddress: 'North Miami, FL', side: 'buyer', stage: 'closed-won', value: 305000, commissionPct: 3, closedAt: new Date() },
    { accountId: account._id, title: 'Wynwood rental — Diego', clientName: 'Diego Fernandez', propertyAddress: 'Wynwood, FL', side: 'buyer', stage: 'offer', value: 415000, commissionPct: 3 },
  ]);

  // Ledger — recent income + expenses.
  const ymd = (m: number, d: number) => new Date(Date.UTC(2026, m, d));
  await LedgerEntry.create([
    { accountId: account._id, type: 'income', category: 'commission', description: 'North Miami closing', amount: 9150, date: ymd(5, 12) },
    { accountId: account._id, type: 'income', category: 'referral', description: 'Lender referral', amount: 500, date: ymd(5, 20) },
    { accountId: account._id, type: 'expense', category: 'marketing', description: 'Instagram ads', amount: 800, date: ymd(5, 3) },
    { accountId: account._id, type: 'expense', category: 'staging', description: 'Coral Gables staging', amount: 1200, date: ymd(4, 28) },
    { accountId: account._id, type: 'expense', category: 'software', description: 'CRM + tools', amount: 297, date: ymd(5, 1) },
  ]);

  // Invoice — one sent, partially paid.
  const invItems = [{ description: 'Premium listing package', category: 'Marketing', quantity: 1, unitPrice: 2025 }];
  const invTotals = computeTotals(invItems, { taxRatePct: 7 });
  await Invoice.create({
    accountId: account._id, number: `INV-${year}-0001`, title: 'Listing Services — Coral Gables',
    client: { name: 'Sarah Klein', email: 'sarah.k@example.com' }, propertyAddress: 'Coral Gables, FL',
    lineItems: invItems, currency: 'USD', taxRatePct: 7, totals: invTotals,
    payments: [{ amount: 1000, method: 'card', ts: new Date() }], amountPaid: 1000, balance: Math.round((invTotals.total - 1000) * 100) / 100,
    status: 'partial', sentAt: new Date(), dueDate: new Date(Date.now() + 14 * 24 * 3600 * 1000),
  });

  // Document — a listing agreement out for signature.
  const la = docTemplate('listing-agreement')!;
  await DocumentRecord.create({
    accountId: account._id, number: `DOC-${year}-0001`, title: 'Exclusive Listing Agreement — Coral Gables',
    templateKey: la.key, client: { name: 'Sarah Klein', email: 'sarah.k@example.com' }, propertyAddress: 'Coral Gables, FL',
    body: la.body.replace(/\{\{brokerage\}\}/g, account.name).replace(/\{\{client\}\}/g, 'Sarah Klein').replace(/\{\{property\}\}/g, 'Coral Gables, FL').replace(/\{\{commission\}\}/g, '2.5'),
    status: 'sent', sentAt: new Date(),
  });

  // CMS — a published website with settings, a home page and a blog post.
  await SiteConfig.create({
    accountId: account._id,
    brandName: 'Miami Luxe Realty',
    tagline: 'Luxury waterfront living, expertly guided.',
    theme: { primaryColor: '#111111', accentColor: '#1F9D6B', bgColor: '#FBF8F4', font: 'sans' },
    contact: { phone: '+13055550100', email: 'hello@miamiluxe.example', address: 'Brickell, Miami, FL' },
    social: { instagram: 'https://instagram.com/miamiluxe', facebook: 'https://facebook.com/miamiluxe' },
    seo: { metaTitle: 'Miami Luxe Realty — Luxury Homes', metaDescription: 'Find your dream waterfront home in Miami.' },
    footerText: '© Miami Luxe Realty. All rights reserved.',
    published: true,
  });
  await CmsContent.create({
    accountId: account._id, type: 'page', title: 'Home', slug: 'home', status: 'published', isHome: true, showInNav: true, publishedAt: new Date(),
    blocks: [
      { id: 'h1', type: 'hero', data: { heading: 'Find your dream home in Miami', subheading: 'Luxury listings and white-glove service from Alexandra Reyes.', ctaLabel: 'Book a consultation', ctaHref: '#contact', align: 'center' } },
      { id: 's1', type: 'stats', data: { items: '$250M | Sold in 2025\n120+ | Families helped\n18 yrs | Local expertise' } },
      { id: 'f1', type: 'features', data: { heading: 'Why work with us', items: 'Fast closings | We close in under 30 days on average\nOff-market access | Exclusive listings you won\'t find elsewhere\nData-driven pricing | AI-powered valuations on every home' } },
      { id: 't1', type: 'testimonial', data: { quote: 'Alexandra found us the perfect Brickell condo in two weeks.', author: 'Carlos M.', role: 'Buyer · Brickell' } },
      { id: 'c1', type: 'contact', data: { heading: 'Ready to move?', note: 'Tell us what you\'re looking for and we\'ll be in touch today.' } },
    ],
  });
  await CmsContent.create({
    accountId: account._id, type: 'post', title: '5 tips for first-time buyers in Miami', slug: '5-tips-first-time-buyers',
    status: 'published', publishedAt: new Date(), excerpt: 'Everything you need to know before buying your first home in Miami.',
    tags: ['buyers', 'guide'],
    blocks: [{ id: 'b1', type: 'richtext', data: { heading: 'Start with pre-approval', body: 'Getting pre-approved tells you exactly what you can afford and makes your offer stronger.\n\nWork with a local lender who understands the Miami market.' } }],
  });

  return { accountId: String(account._id) };
}

// Run directly: npm run seed
const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('seed.ts') || process.argv[1]?.replace(/\\/g, '/').endsWith('seed.js');
if (isMain) {
  connectDb()
    .then(seedDemo)
    .then(({ accountId }) => {
      console.log(`Seeded demo account ${accountId} (demo@truecode.ai / Demo1234!)`);
      return disconnectDb();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { Appointment, Call, Conversation, Lead } from '../models.js';

export const statsRouter = Router();
statsRouter.use(requireAuth);

/** M10 dashboard analytics — powers every Recharts visualization. */
statsRouter.get('/dashboard', async (req: Request, res: Response) => {
  const accountId = new mongoose.Types.ObjectId(req.auth!.accountId);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000);

  const [speedTrend, leadsThisWeek, callsBooked, pipeline, followup, medianDoc] = await Promise.all([
    Lead.aggregate([
      { $match: { accountId, createdAt: { $gte: twoWeeksAgo }, firstResponseSeconds: { $exists: true } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          seconds: { $avg: '$firstResponseSeconds' },
          leads: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Lead.countDocuments({ accountId, createdAt: { $gte: weekAgo } }),
    Appointment.countDocuments({ accountId, createdAt: { $gte: weekAgo } }),
    Lead.aggregate([
      { $match: { accountId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Conversation.aggregate([
      { $match: { accountId } },
      { $unwind: '$messages' },
      {
        $group: {
          _id: null,
          sent: { $sum: { $cond: [{ $eq: ['$messages.direction', 'outbound'] }, 1, 0] } },
          replies: { $sum: { $cond: [{ $eq: ['$messages.direction', 'inbound'] }, 1, 0] } },
        },
      },
    ]),
    Lead.aggregate([
      { $match: { accountId, firstResponseSeconds: { $exists: true } } },
      { $sort: { firstResponseSeconds: 1 } },
      { $group: { _id: null, values: { $push: '$firstResponseSeconds' } } },
    ]),
  ]);

  const values: number[] = medianDoc[0]?.values ?? [];
  const speedToLeadP50 = values.length ? values[Math.floor(values.length / 2)]! : null;

  // Revenue proxy chart: booked appointments x avg commission placeholder is
  // dishonest — instead show won-deal counts per month (real data).
  const wonByMonth = await Lead.aggregate([
    { $match: { accountId, status: 'won' } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$updatedAt' } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $limit: 12 },
  ]);

  res.json({
    speedToLeadP50,
    speedToLeadTrend: speedTrend.map((r) => ({ date: r._id, seconds: Math.round(r.seconds), leads: r.leads })),
    leadsThisWeek,
    callsBooked,
    pipeline: pipeline.map((p) => ({ status: p._id, count: p.count })),
    followupPerformance: { sent: followup[0]?.sent ?? 0, replies: followup[0]?.replies ?? 0 },
    wonByMonth: wonByMonth.map((r) => ({ month: r._id, count: r.count })),
  });
});

/** Per-module chart data. */
statsRouter.get('/calls', async (req: Request, res: Response) => {
  const accountId = new mongoose.Types.ObjectId(req.auth!.accountId);
  const rows = await Call.aggregate([
    { $match: { accountId } },
    { $group: { _id: '$outcome', count: { $sum: 1 }, avgDuration: { $avg: '$durationSec' } } },
  ]);
  res.json({ outcomes: rows.map((r) => ({ outcome: r._id ?? 'pending', count: r.count, avgDuration: Math.round(r.avgDuration ?? 0) })) });
});

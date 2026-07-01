import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { Appointment } from '../models.js';

export const appointmentsRouter = Router();
appointmentsRouter.use(requireAuth);

appointmentsRouter.get('/', async (req: Request, res: Response) => {
  const items = await Appointment.find({ accountId: req.auth!.accountId })
    .sort({ startsAt: 1 })
    .limit(200)
    .populate('leadId', 'firstName lastName phone')
    .lean();
  res.json({ items });
});

import { Schema, model } from 'mongoose';
import Joi from 'joi';
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.middleware.js';
import { requireManagingDirector } from '../../middleware/authorize.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { sendSuccess } from '../../utils/api-response.util.js';
import { AppError } from '../../utils/app-error.util.js';

export type SubsidyRule = { stateId: string; minKW: number; maxKW: number; central: number; state: number };
export type QuotationPolicy = { rules: SubsidyRule[]; validityDays: number; subsidyDeadline: string; contactPhone: string; contactEmail: string; website: string; officeAddress: string; branches: string };
export const emptyPolicy: QuotationPolicy = { rules: [], validityDays: 15, subsidyDeadline: '', contactPhone: '', contactEmail: '', website: '', officeAddress: '', branches: '' };
const policySchema = new Schema({ key: { type: String, required: true, unique: true }, rules: [{ stateId: String, minKW: Number, maxKW: Number, central: Number, state: Number, _id: false }], validityDays: Number, subsidyDeadline: String, contactPhone: String, contactEmail: String, website: String, officeAddress: String, branches: String }, { timestamps: true });
const Policy = model('QuotationPolicy', policySchema);
const rule = Joi.object({ stateId: Joi.string().hex().length(24).required(), minKW: Joi.number().min(0).max(100000).required(), maxKW: Joi.number().positive().max(100000).required(), central: Joi.number().min(0).max(100000000).required(), state: Joi.number().min(0).max(100000000).required() }).unknown(false);
export const quotationPolicySchema = Joi.object({ rules: Joi.array().items(rule).max(500).required(), validityDays: Joi.number().integer().min(1).max(365).required(), subsidyDeadline: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow('').required(), contactPhone: Joi.string().trim().max(100).allow('').required(), contactEmail: Joi.string().trim().email().max(254).allow('').required(), website: Joi.string().trim().max(200).allow('').required(), officeAddress: Joi.string().trim().max(500).allow('').required(), branches: Joi.string().trim().max(500).allow('').required() }).unknown(false).custom((value, helpers) => {
  for (const [index, current] of value.rules.entries()) {
    if (current.minKW > current.maxKW || value.rules.slice(0, index).some((other: SubsidyRule) => other.stateId === current.stateId && current.minKW <= other.maxKW && other.minKW <= current.maxKW)) return helpers.error('any.invalid');
  }
  return value;
});
export async function getQuotationPolicy(): Promise<QuotationPolicy> {
  const saved = await Policy.findOne({ key: 'default' }).lean();
  return saved ? { rules: saved.rules as SubsidyRule[], validityDays: saved.validityDays ?? 15, subsidyDeadline: saved.subsidyDeadline ?? '', contactPhone: saved.contactPhone ?? '', contactEmail: saved.contactEmail ?? '', website: saved.website ?? '', officeAddress: saved.officeAddress ?? '', branches: saved.branches ?? '' } : emptyPolicy;
}
export function selectSubsidy(rules: SubsidyRule[], stateId: string, capacity: number): SubsidyRule {
  const match = rules.find(rule => rule.stateId === stateId && capacity >= rule.minKW && capacity <= rule.maxKW);
  if (!match) throw new AppError('No subsidy setting matches this state and capacity. Ask the MD to configure quotation settings.', 400);
  return match;
}
export const quotationPolicyRouter = Router();
quotationPolicyRouter.use(authenticate);
quotationPolicyRouter.get('/', async (_req, res, next) => { try { return sendSuccess(res, 'Quotation policy', await getQuotationPolicy()); } catch (error) { return next(error); } });
quotationPolicyRouter.patch('/', requireManagingDirector, validateBody(quotationPolicySchema), async (req, res, next) => { try {
  await Policy.findOneAndUpdate({ key: 'default' }, { $set: req.body }, { upsert: true, runValidators: true });
  return sendSuccess(res, 'Quotation policy saved', await getQuotationPolicy());
} catch (error) { return next(error); } });

import { Schema, model } from 'mongoose';
import Joi from 'joi';
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.middleware.js';
import { requireManagingDirector } from '../../middleware/authorize.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { sendSuccess } from '../../utils/api-response.util.js';

const defaults = { paymentModes: ['Cash', 'Bank Finance'], panelBrands: [], panelTechnologies: [], inverters: [], wattsOptions: [], categories: [], systemTypes: [] };
const schema = new Schema({ key: { type: String, unique: true, required: true }, paymentModes: [String], panelBrands: [String], panelTechnologies: [String], inverters: [String], wattsOptions: [String], categories: [String], systemTypes: [String] }, { timestamps: true });
const Options = model('QuotationOptions', schema);
const entries = Joi.array().items(Joi.string().trim().min(1).max(100)).max(100).unique().required();
export const wattsOptionsSchema = Joi.array().items(Joi.string().trim().pattern(/^(?:\d+)(?:\.\d+)?$/).custom((value, helpers) => Number(value) > 0 && Number(value) <= 100000 ? value : helpers.error('any.invalid'))).max(100).unique().optional();
const optionsSchema = Joi.object({ paymentModes: entries.min(1), panelBrands: entries.optional(), panelTechnologies: entries, inverters: entries, wattsOptions: wattsOptionsSchema, categories: entries.optional(), systemTypes: entries.optional() }).unknown(false);
export async function quotationOptions() {
  const saved = await Options.findOne({ key: 'default' }).lean();
  return saved ? { paymentModes: saved.paymentModes, panelBrands: saved.panelBrands ?? [], panelTechnologies: saved.panelTechnologies, inverters: saved.inverters, wattsOptions: saved.wattsOptions ?? [], categories: saved.categories ?? [], systemTypes: saved.systemTypes ?? [] } : defaults;
}
export const quotationOptionsRouter = Router();
quotationOptionsRouter.use(authenticate);
quotationOptionsRouter.get('/', async (_req, res, next) => { try { return sendSuccess(res, 'Quotation options', await quotationOptions()); } catch (error) { return next(error); } });
quotationOptionsRouter.patch('/', requireManagingDirector, validateBody(optionsSchema), async (req, res, next) => { try {
  const saved = await Options.findOneAndUpdate({ key: 'default' }, { $set: req.body }, { upsert: true, new: true, runValidators: true });
  return sendSuccess(res, 'Quotation options saved', { paymentModes: saved.paymentModes, panelBrands: saved.panelBrands ?? [], panelTechnologies: saved.panelTechnologies, inverters: saved.inverters, wattsOptions: saved.wattsOptions ?? [], categories: saved.categories ?? [], systemTypes: saved.systemTypes ?? [] });
} catch (error) { return next(error); } });

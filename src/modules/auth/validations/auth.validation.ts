import Joi from 'joi';

const passwordSchema = Joi.string().min(12).max(128).pattern(/[a-z]/).pattern(/[A-Z]/).pattern(/[0-9]/).required();

export const loginSchema = Joi.object({
  email: Joi.string().email().max(254).lowercase().trim(),
  identifier: Joi.string().trim().max(254).custom((value, helpers) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(value)) ? value : helpers.error('any.invalid')),
  password: Joi.string().min(1).max(128).required()
}).xor('email', 'identifier').required();

export const tokenPasswordSchema = Joi.object({
  token: Joi.string().pattern(/^[A-Za-z0-9_-]{40,100}$/).required(),
  password: passwordSchema
}).required();

export const emailSchema = Joi.object({ email: Joi.string().email().max(254).lowercase().trim().required() }).required();

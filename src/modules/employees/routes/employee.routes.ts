import Joi from 'joi';
import {teamTransferService} from '../services/team-transfer.service.js';
import {cpIdentityDocumentService} from '../services/cp-identity-document.service.js';
import { EmployeeModel } from '../models/employee.model.js';
import { profileImageService } from '../services/profile-image.service.js';
import { AppError } from '../../../utils/app-error.util.js';
import { employeeProfileImageService } from '../services/employee-profile-image.service.js';
import { sendSuccess } from '../../../utils/api-response.util.js';
import express, { Router } from 'express';
import { env } from '../../../config/env.config.js';
import { authenticate } from '../../../middleware/authenticate.middleware.js';
import { requirePermission } from '../../../middleware/authorize.middleware.js';
import { validateBody, validateQuery } from '../../../middleware/validate.middleware.js';
import * as controller from '../controllers/employee.controller.js';
import { changeManagerSchema, createEmployeeSchema, updateEmployeeSchema } from '../validations/employee.validation.js';
import { paginationSchema } from '../validations/pagination.validation.js';
import { createProfileImageUploadSchema } from '../validations/profile-image.validation.js';

export const employeeRouter = Router();
employeeRouter.use(authenticate);

// Self-service endpoints always derive the target from the authenticated session.
const selfProfileSchema=Joi.object({
  firstName:Joi.string().trim().min(1).max(80), lastName:Joi.string().trim().min(1).max(80),
  mobileNumber:Joi.string().pattern(/^\+?[1-9]\d{7,14}$/),
  address:Joi.object({addressLine:Joi.string().trim().max(300).allow(''),city:Joi.string().trim().max(100).allow(''),pincode:Joi.string().trim().pattern(/^[A-Za-z0-9 -]{3,12}$/).allow('')}).min(1).unknown(false)
}).min(1).unknown(false);
employeeRouter.get('/me/profile',async(req,res,next)=>{try{
  const employee=await EmployeeModel.findOne({_id:req.auth!.employeeId,isActive:true}).select('employeeCode firstName lastName email mobileNumber address').lean();
  if(!employee)throw new AppError('Employee not found',404);
  return sendSuccess(res,'Profile fetched',employee);
}catch(error){return next(error);}});
employeeRouter.patch('/me/profile',validateBody(selfProfileSchema),async(req,res,next)=>{try{
  const changes:Record<string,string>={};
  for(const field of ['firstName','lastName','mobileNumber'])if(req.body[field]!==undefined)changes[field]=req.body[field];
  for(const field of ['addressLine','city','pincode'])if(req.body.address?.[field]!==undefined)changes[`address.${field}`]=req.body.address[field];
  const employee=await EmployeeModel.findOneAndUpdate({_id:req.auth!.employeeId,isActive:true},{$set:changes},{new:true,runValidators:true}).select('employeeCode firstName lastName email mobileNumber address').lean();
  if(!employee)throw new AppError('Employee not found',404);
  return sendSuccess(res,'Profile updated',employee);
}catch(error){if((error as {code?:number}).code===11000)return next(new AppError('Mobile number is already in use',409));return next(error);}});
employeeRouter.get('/me/profile-image-options',(_req,res)=>sendSuccess(res,'Profile image options',{canEdit:true,maxSizeBytes:env.profileImageMaxSizeBytes}));
employeeRouter.get('/me/profile-image-url',async(req,res,next)=>{try{
  const employee=await EmployeeModel.findOne({_id:req.auth!.employeeId,isActive:true}).select('profileImage').lean();
  if(!employee?.profileImage?.key)throw new AppError('Profile image not found',404);
  const url=await profileImageService.createDownloadUrl(employee.profileImage.key);
  return sendSuccess(res,'Profile image URL created',{url,expiresInSeconds:300});
}catch(error){return next(error);}});
employeeRouter.post('/me/profile-image-upload',validateBody(createProfileImageUploadSchema),controller.createProfileImageUploadReservation);
employeeRouter.put('/me/profile-image-upload/:uploadId',express.raw({type:['image/jpeg','image/png','image/webp'],limit:env.profileImageMaxSizeBytes}),controller.uploadProfileImage);
employeeRouter.patch('/me/profile-image',validateBody(Joi.object({profileImageUploadId:Joi.string().hex().length(24).required()}).unknown(false)),async(req,res,next)=>{try{
  await employeeProfileImageService.replace(req.auth!.employeeId,String(req.auth!.employeeId),req.body.profileImageUploadId);
  return sendSuccess(res,'Profile image updated',{updated:true});
}catch(error){return next(error);}});

employeeRouter.get('/creatable-roles', requirePermission('employees.create'), controller.getCreatableRoles);
employeeRouter.post('/', requirePermission('employees.create'), validateBody(createEmployeeSchema), controller.create);
employeeRouter.post('/profile-image-upload', requirePermission('employees.create'), validateBody(createProfileImageUploadSchema), controller.createProfileImageUploadReservation);
employeeRouter.put('/profile-image-upload/:uploadId', requirePermission('employees.create'), express.raw({
  type: ['image/jpeg', 'image/png', 'image/webp'],
  limit: env.profileImageMaxSizeBytes
}), controller.uploadProfileImage);
employeeRouter.post('/profile-image-upload-url', requirePermission('employees.create'), validateBody(createProfileImageUploadSchema), controller.createProfileImageUpload);
employeeRouter.get('/:employeeId/identity-documents',async(req,res,next)=>{try{res.set('Cache-Control','private, no-store');return sendSuccess(res,'CP identity documents',await cpIdentityDocumentService.list(req.auth!.employeeId,String(req.params.employeeId)));}catch(error){return next(error);}});
employeeRouter.put('/:employeeId/identity-documents/:documentType',express.raw({type:['application/pdf','image/jpeg','image/png','image/webp'],limit:env.customerDocumentMaxSizeBytes}),async(req,res,next)=>{try{return sendSuccess(res,'CP identity document saved',await cpIdentityDocumentService.upload(req.auth!.employeeId,String(req.params.employeeId),String(req.params.documentType),req.get('Content-Type')??'',req.body));}catch(error){return next(error);}});
employeeRouter.get('/:employeeId/identity-documents/:documentType/preview-url',async(req,res,next)=>{try{res.set('Cache-Control','private, no-store');return sendSuccess(res,'CP identity document preview',await cpIdentityDocumentService.download(req.auth!.employeeId,String(req.params.employeeId),String(req.params.documentType),true));}catch(error){return next(error);}});
employeeRouter.get('/:employeeId/identity-documents/:documentType/download-url',async(req,res,next)=>{try{res.set('Cache-Control','private, no-store');return sendSuccess(res,'CP identity document download',await cpIdentityDocumentService.download(req.auth!.employeeId,String(req.params.employeeId),String(req.params.documentType)));}catch(error){return next(error);}});
employeeRouter.get('/:employeeId/team-transfer-options',requirePermission('employees.hierarchy'),async(req,res,next)=>{try{return sendSuccess(res,'Team transfer options',await teamTransferService.options(req.auth!.employeeId,String(req.params.employeeId)));}catch(error){return next(error);}});
employeeRouter.post('/:employeeId/team-transfer',requirePermission('employees.hierarchy'),validateBody(Joi.object({replacementId:Joi.string().hex().length(24).required(),expectedCount:Joi.number().integer().min(0).required(),confirmed:Joi.boolean().valid(true).strict().required()}).unknown(false)),async(req,res,next)=>{try{return sendSuccess(res,'Team transferred',await teamTransferService.transfer(req.auth!.employeeId,String(req.params.employeeId),req.body.replacementId,req.body.expectedCount));}catch(error){return next(error);}});
employeeRouter.get('/:employeeId/profile-image-options', requirePermission('employees.read'), async(req,res,next)=>{try{return sendSuccess(res,'Profile image options',await employeeProfileImageService.options(req.auth!.employeeId,String(req.params.employeeId)));}catch(error){return next(error);}});
const canEditProfile:express.RequestHandler=async(req,_res,next)=>{try{await employeeProfileImageService.assertEdit(req.auth!.employeeId,String(req.params.employeeId));next();}catch(error){return next(error);}};
employeeRouter.post('/:employeeId/profile-image-upload',requirePermission('employees.update'),canEditProfile,validateBody(createProfileImageUploadSchema),controller.createProfileImageUploadReservation);
employeeRouter.put('/:employeeId/profile-image-upload/:uploadId',requirePermission('employees.update'),canEditProfile,express.raw({type:['image/jpeg','image/png','image/webp'],limit:env.profileImageMaxSizeBytes}),controller.uploadProfileImage);
employeeRouter.patch('/:employeeId/profile-image',requirePermission('employees.update'),validateBody(Joi.object({profileImageUploadId:Joi.string().hex().length(24).required()}).unknown(false)),async(req,res,next)=>{try{return sendSuccess(res,'Profile image updated',await employeeProfileImageService.replace(req.auth!.employeeId,String(req.params.employeeId),req.body.profileImageUploadId));}catch(error){return next(error);}});
employeeRouter.get('/:employeeId/profile-image-url', requirePermission('employees.read'), controller.getProfileImageUrl);
employeeRouter.get('/', requirePermission('employees.read'), validateQuery(paginationSchema), controller.list);
employeeRouter.get('/downline', requirePermission('employees.read'), validateQuery(paginationSchema), controller.downline);
employeeRouter.get('/:employeeId/hierarchy', requirePermission('employees.read'), controller.hierarchy);
employeeRouter.get('/:employeeId', requirePermission('employees.read'), controller.getById);
employeeRouter.patch('/:employeeId', requirePermission('employees.update'), validateBody(updateEmployeeSchema), controller.update);
employeeRouter.post('/:employeeId/activate', requirePermission('employees.activate'), controller.activate);
employeeRouter.post('/:employeeId/deactivate', requirePermission('employees.deactivate'), controller.deactivate);
employeeRouter.post('/:employeeId/resend-invitation', requirePermission('employees.invite'), controller.resendInvitation);
employeeRouter.patch('/:employeeId/reporting-manager', requirePermission('employees.hierarchy'), validateBody(changeManagerSchema), controller.changeManager);

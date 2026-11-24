import express from 'express';
import { Router } from 'express';
import { env } from '../../../config/env.config.js';
import { authenticate } from '../../../middleware/authenticate.middleware.js';
import { requirePermission } from '../../../middleware/authorize.middleware.js';
import { validateBody, validateQuery } from '../../../middleware/validate.middleware.js';
import * as controller from '../controllers/customer.controller.js';
import { completeDocumentUploadSchema, convertLeadSchema, misVerifyDocumentSchema, createCpCustomerUploadsSchema, createDocumentUploadSchema, createLeadConversionUploadsSchema, customerListQuerySchema, updateCustomerSchema, verifyDocumentSchema } from '../validations/customer.validation.js';

import { customerCpSchema } from '../services/customer-cp.service.js';

import { cpCustomerSchema } from '../services/cp-customer.service.js';

export const customerRouter = Router();
customerRouter.use(authenticate);
customerRouter.get('/from-cp/:cpId/options', requirePermission('customers.create'), controller.cpCustomerOptions);
customerRouter.post('/from-cp/:cpId/document-upload-urls', requirePermission('customers.create'), validateBody(createCpCustomerUploadsSchema), controller.createCpCustomerUploads);
customerRouter.put('/from-cp/:cpId/document-uploads/:uploadId', requirePermission('customers.create'), express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], limit: env.customerDocumentMaxSizeBytes }), controller.uploadCpCustomerDocument);
customerRouter.post('/from-cp/:cpId', requirePermission('customers.create'), validateBody(cpCustomerSchema), controller.convertCpToCustomer);
customerRouter.get('/:customerId/cp-conversion', requirePermission('customers.read'), requirePermission('employees.create'), controller.cpConversionOptions);
customerRouter.post('/:customerId/convert-to-cp', requirePermission('customers.read'), requirePermission('employees.create'), validateBody(customerCpSchema), controller.convertToCp);
customerRouter.get('/from-lead/:leadId/options', requirePermission('customers.create'), controller.leadConversionOptions);
customerRouter.post('/from-lead/:leadId/document-upload-urls', requirePermission('customers.create'), validateBody(createLeadConversionUploadsSchema), controller.createLeadConversionUploadUrls);
customerRouter.put('/from-lead/:leadId/document-uploads/:uploadId', requirePermission('customers.create'), express.raw({
  type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  limit: env.customerDocumentMaxSizeBytes
}), controller.uploadLeadConversionDocument);
customerRouter.post('/from-lead/:leadId', requirePermission('customers.create'), validateBody(convertLeadSchema), controller.convert);
customerRouter.get('/review-queue', requirePermission('customers.read'), controller.reviewQueue);
customerRouter.get('/hold', requirePermission('customers.read'), controller.holdCustomers);
customerRouter.get('/', requirePermission('customers.read'), validateQuery(customerListQuerySchema), controller.list);
customerRouter.get('/:customerId/timeline', requirePermission('customers.read'), controller.timeline);
customerRouter.get('/:customerId/documents', requirePermission('customers.read'), controller.documents);
customerRouter.post('/:customerId/documents/upload-url', requirePermission('customers.create'), validateBody(createDocumentUploadSchema), controller.createDocumentUpload);
customerRouter.put('/:customerId/documents/:uploadId/upload', requirePermission('customers.create'), express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], limit: env.customerDocumentMaxSizeBytes }), controller.uploadCustomerDocument);
customerRouter.post('/:customerId/documents/complete', requirePermission('customers.create'), validateBody(completeDocumentUploadSchema), controller.completeDocumentUpload);
customerRouter.get('/:customerId/documents/:documentId/download-url', requirePermission('customers.read'), controller.documentDownloadUrl);
customerRouter.get('/:customerId/documents/:documentId/preview-url', requirePermission('customers.read'), controller.documentPreviewUrl);
customerRouter.patch('/:customerId/documents/:documentId/mis-verification', requirePermission('customers.read'), validateBody(misVerifyDocumentSchema), controller.misVerifyDocument);
customerRouter.patch('/:customerId/documents/:documentId/verification', requirePermission('customers.update'), validateBody(verifyDocumentSchema), controller.verifyDocument);
customerRouter.get('/:customerId', requirePermission('customers.read'), controller.get);
customerRouter.patch('/:customerId', requirePermission('customers.update'), validateBody(updateCustomerSchema), controller.update);

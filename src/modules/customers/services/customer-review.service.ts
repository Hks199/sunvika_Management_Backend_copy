import { Types } from 'mongoose';
import { EmployeeModel } from '../../employees/models/employee.model.js';
import { RoleModel } from '../../roles/models/role.model.js';
import { CustomerDocumentModel } from '../models/customer-document.model.js';

export async function reviewActor(actorId: Types.ObjectId) {
  const employee = await EmployeeModel.findById(actorId).select('role reportingTo isActive').lean();
  const role = employee ? await RoleModel.findById(employee.role).select('code isActive').lean() : null;
  return { employee, role: employee?.isActive && role?.isActive ? role.code : undefined };
}

export async function currentDocuments(customerIds: Types.ObjectId[]) {
  if (!customerIds.length) return new Map<string, Map<string, { verificationStatus: string; misVerificationStatus?: string }>>();
  const docs = await CustomerDocumentModel.find({ customer: { $in: customerIds } }).select('customer documentType verificationStatus misVerificationStatus').sort({ uploadedAt: -1, _id: -1 }).lean();
  const byCustomer = new Map<string, Map<string, { verificationStatus: string; misVerificationStatus?: string }>>();
  for (const doc of docs) {
    const id = String(doc.customer); let byType = byCustomer.get(id);
    if (!byType) { byType = new Map(); byCustomer.set(id, byType); }
    if (!byType.has(doc.documentType)) byType.set(doc.documentType, doc);
  }
  return byCustomer;
}

export function reviewComplete(required: string[], docs: Map<string, { verificationStatus: string; misVerificationStatus?: string }> | undefined) {
  return required.length > 0 && required.every(type => docs?.get(type)?.verificationStatus === 'VERIFIED');
}

export function misReviewComplete(required: string[], docs: Map<string, { verificationStatus: string; misVerificationStatus?: string }> | undefined) {
  return required.length > 0 && required.every(type => docs?.get(type)?.misVerificationStatus === 'VERIFIED');
}

import { currentDocuments, reviewComplete } from './customer-review.service.js';
import { LeadModel } from '../../leads/models/lead.model.js';
import { canAccessAssignedLead } from '../../leads/services/lead-assignment-access.js';
import { hasOrganizationVisibility, type AccessMode } from '../../employees/services/visibility-policy.js';
import { Types } from 'mongoose';
import { AppError } from '../../../utils/app-error.util.js';
import { EmployeeModel } from '../../employees/models/employee.model.js';
import { hierarchyService } from '../../employees/services/hierarchy.service.js';
import { RoleModel } from '../../roles/models/role.model.js';
import { CustomerModel } from '../models/customer.model.js';

export async function assertCustomerAccess(actorId: Types.ObjectId, customerId: Types.ObjectId, accessMode: AccessMode = 'manage') {
  const customer = await CustomerModel.findById(customerId);
  if (!customer) throw new AppError('Customer not found', 404);
  if (customer.reviewCp) {
    const actor = await EmployeeModel.findById(actorId).select('role').lean();
    const role = actor ? await RoleModel.findById(actor.role).select('code').lean() : null;
    if (role?.code === 'MIS') {
      const docs = await currentDocuments([customer._id]);
      if (!reviewComplete(customer.reviewRequiredTypes ?? [], docs.get(String(customer._id)))) throw new AppError('Customer not found', 404);
    }
  }

  if (!(customer.reviewCp && await hierarchyService.canAccessResource(actorId, customer.reviewCp, 'customer', accessMode)) && !await hierarchyService.canAccessResource(actorId, customer.creatorId, 'customer', accessMode) && !(customer.cpEmployee && await hierarchyService.canAccessEmployee(actorId, customer.cpEmployee, accessMode))) {
    const lead = await LeadModel.findById(customer.sourceLead).select('assignedTo').lean();
    if (!lead || !await canAccessAssignedLead(actorId, lead.assignedTo, accessMode)) throw new AppError('Customer not found', 404);
  }
  return customer;
}

export async function customerScope(actorId: Types.ObjectId): Promise<Types.ObjectId[] | null> {
  const employee = await EmployeeModel.findById(actorId).select('role').lean();
  const role = employee ? await RoleModel.findById(employee.role).select('code category').lean() : null;
  if (!role) throw new AppError('Employee role is unavailable', 403);
  if (role.code === 'MIS') {
    const customers = await CustomerModel.find({}).select('_id reviewCp reviewRequiredTypes').lean();
    const underReview = customers.filter(customer => customer.reviewCp);
    const documents = await currentDocuments(underReview.map(customer => customer._id));
    return customers.filter(customer => !customer.reviewCp || reviewComplete(customer.reviewRequiredTypes ?? [], documents.get(String(customer._id)))).map(customer => customer._id);
  }
  if (hasOrganizationVisibility(role.code) || role.category === 'ADMIN_HEAD') return null;
  const ids = await hierarchyService.getDownlineEmployeeIds(actorId);
  const assignedLeadIds = await LeadModel.find({ assignedTo: { $in: ids } }).distinct('_id');
  return CustomerModel.find({ $or: [{ creatorId: { $in: ids } }, { cpEmployee: { $in: ids } }, { reviewCp: { $in: ids } }, { sourceLead: { $in: assignedLeadIds } }] }).distinct('_id');
}

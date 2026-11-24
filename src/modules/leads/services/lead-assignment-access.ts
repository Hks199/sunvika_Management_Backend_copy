import { Types } from 'mongoose';
import { hierarchyService } from '../../employees/services/hierarchy.service.js';
import type { AccessMode } from '../../employees/services/visibility-policy.js';

// Assignment adds access for the assignee and their uplines; it never changes the creator.
export async function canAccessAssignedLead(actorId: Types.ObjectId, assignedTo: Types.ObjectId | null | undefined, mode: AccessMode = 'manage'): Promise<boolean> {
  return Boolean(assignedTo && await hierarchyService.canAccessResource(actorId, assignedTo, 'lead', mode));
}

import mongoose,{Types} from 'mongoose';
import {AppError} from '../../../utils/app-error.util.js';
import {EmployeeModel} from '../models/employee.model.js';
import {RoleModel} from '../../roles/models/role.model.js';
import {hierarchyService} from './hierarchy.service.js';
import {withHierarchyLock} from './employee.service.js';
import {LeadModel} from '../../leads/models/lead.model.js';
import {CallingListModel} from '../../calling-lists/calling-list.model.js';
import {AMCContractModel} from '../../amc/models/amc-contract.model.js';
import {AMCScheduleModel} from '../../amc/models/amc-schedule.model.js';
import {QueryThreadModel} from '../../queries/query.models.js';
import {CpImportModel} from '../../cp-imports/cp-import.model.js';
const transferAuditSchema = new mongoose.Schema({source:{type:mongoose.Schema.Types.ObjectId,ref:'Employee',required:true},replacement:{type:mongoose.Schema.Types.ObjectId,ref:'Employee',required:true},actor:{type:mongoose.Schema.Types.ObjectId,ref:'Employee',required:true},counts:{type:mongoose.Schema.Types.Mixed,required:true}}, {timestamps:true});
const TransferAudit = mongoose.model('TeamTransferAudit',transferAuditSchema);
async function workCounts(source:Types.ObjectId) {
 const [leads,callingLists,amcContracts,amcSchedules,queries]=await Promise.all([
  LeadModel.countDocuments({$or:[{assignedTo:source},{creatorId:source,assignedTo:null}]}),CallingListModel.countDocuments({assignedTo:source}),AMCContractModel.countDocuments({assignedEmployee:source}),AMCScheduleModel.countDocuments({assignedEmployee:source,status:{$in:['SCHEDULED','MISSED']}}),QueryThreadModel.countDocuments({assignedTo:source})]);
 return {leads,callingLists,amcContracts,amcSchedules,queries};
}
function id(value:string){if(!Types.ObjectId.isValid(value))throw new AppError('Employee not found',404);return new Types.ObjectId(value);}
async function scope(actorId:Types.ObjectId,sourceValue:string){
 const sourceId=id(sourceValue);const actor=await EmployeeModel.findOne({_id:actorId,isActive:true}).select('role').lean();const actorRole=actor&&await RoleModel.findOne({_id:actor.role,isActive:true}).select('code').lean();if(!actorRole||!['MD','CP_HEAD'].includes(actorRole.code))throw new AppError('Only an upline can transfer a team',403);
 const source=await EmployeeModel.findById(sourceId).select('role firstName lastName employeeCode isActive hierarchyPath').lean();const role=source&&await RoleModel.findById(source.role).select('code').lean();if(!source||!role||!['RM','CP_HEAD'].includes(role.code)||(role.code==='CP_HEAD'&&actorRole.code!=='MD')||!await hierarchyService.canAccessEmployee(actorId,sourceId,'manage'))throw new AppError('Employee not found in your scope',404);
 return {source,roleCode:role.code,actorRole:actorRole.code};
}
export const teamTransferService={
 async options(actorId:Types.ObjectId,sourceValue:string){const {source,roleCode,actorRole}=await scope(actorId,sourceValue);const [directCount,descendantCount,targets]=await Promise.all([EmployeeModel.countDocuments({reportingTo:source._id}),EmployeeModel.countDocuments({hierarchyPath:source._id}),EmployeeModel.find({_id:{$ne:source._id},role:source.role,isActive:true,...(actorRole==='CP_HEAD'?{hierarchyPath:actorId}:{})}).select('_id employeeCode firstName lastName').sort({firstName:1,lastName:1,employeeCode:1}).lean()]);return {roleCode,directCount,descendantCount,targets,work:await workCounts(source._id)};},
 async transfer(actorId:Types.ObjectId,sourceValue:string,targetValue:string,expectedCount:number){return withHierarchyLock(async()=>{
  const {source,roleCode,actorRole}=await scope(actorId,sourceValue);const targetId=id(targetValue);if(targetId.equals(source._id))throw new AppError('Select a different replacement',400);
  const target=await EmployeeModel.findOne({_id:targetId,role:source.role,isActive:true,...(actorRole==='CP_HEAD'?{hierarchyPath:actorId}:{})}).select('hierarchyPath').lean();if(!target||!await hierarchyService.canAccessEmployee(actorId,targetId,'manage')||target.hierarchyPath.some(part=>part.equals(source._id)))throw new AppError('Replacement not found in your scope',404);
  const expectedRole=await RoleModel.findOne({code:roleCode==='RM'?'CP':'RM'}).select('_id').lean();if(!expectedRole)throw new AppError('Expected reporting role is unavailable',409);
  let moved=0,descendantsMoved=0; let work:Record<string,number>={};
  try { await mongoose.connection.transaction(async session=>{
   const activeImport=await CpImportModel.exists({state:{$in:['QUEUED','PROCESSING']},$or:[{manager:source._id},{'rows.manager':source._id}]}).session(session);
   if(activeImport)throw new AppError('A CP import for this employee is still processing. Wait for it to finish before transferring.',409);
   const direct=await EmployeeModel.find({reportingTo:source._id}).select('_id role').session(session).lean();
   if(direct.length!==expectedCount)throw new AppError('The team changed. Refresh the transfer details and try again.',409);
   if(direct.some(person=>!person.role.equals(expectedRole._id)))throw new AppError('The team contains an unexpected role; resolve it before transfer',409);
   const descendants=await EmployeeModel.find({hierarchyPath:source._id}).select('_id reportingTo hierarchyPath').session(session).lean();
   const directIds=new Set(direct.map(person=>String(person._id)));const newPrefix=[...target.hierarchyPath,target._id];
   const operations=descendants.map(person=>{const at=person.hierarchyPath.findIndex(part=>part.equals(source._id));if(at<0)throw new AppError('Invalid reporting hierarchy; contact an administrator',409);return {updateOne:{filter:{_id:person._id,hierarchyPath:source._id,...(directIds.has(String(person._id))?{reportingTo:source._id}:{})},update:{$set:{hierarchyPath:[...newPrefix,...person.hierarchyPath.slice(at+1)],...(directIds.has(String(person._id))?{reportingTo:target._id}:{})}}}};});
   if(direct.some(person=>!descendants.some(desc=>desc._id.equals(person._id))))throw new AppError('Inconsistent reporting hierarchy; contact an administrator',409);
   if(operations.length){const result=await EmployeeModel.bulkWrite(operations,{session,ordered:true});if(result.matchedCount!==operations.length)throw new AppError('The hierarchy changed; refresh and retry',409);}
   const leads=await LeadModel.updateMany({$or:[{assignedTo:source._id},{creatorId:source._id,assignedTo:null}]},{$set:{assignedTo:target._id}},{session});
   const callingLists=await CallingListModel.updateMany({assignedTo:source._id},{$set:{assignedTo:target._id}},{session});
   const amcContracts=await AMCContractModel.updateMany({assignedEmployee:source._id},{$set:{assignedEmployee:target._id}},{session});
   const amcSchedules=await AMCScheduleModel.updateMany({assignedEmployee:source._id,status:{$in:['SCHEDULED','MISSED']}},{$set:{assignedEmployee:target._id}},{session});
   const queries=await QueryThreadModel.updateMany({assignedTo:source._id},{$set:{assignedTo:target._id}},{session});
   work={leads:leads.modifiedCount,callingLists:callingLists.modifiedCount,amcContracts:amcContracts.modifiedCount,amcSchedules:amcSchedules.modifiedCount,queries:queries.modifiedCount};
   await TransferAudit.create([{source:source._id,replacement:target._id,actor:actorId,counts:{direct:direct.length,descendants:descendants.length,...work}}],{session});
   moved=direct.length;descendantsMoved=descendants.length;
  });
  } catch(error) { if ((error as {code?:number}).code === 20 || /transaction numbers are only allowed/i.test(error instanceof Error ? error.message : '')) throw new AppError('Team transfers require a MongoDB replica set with transactions enabled. Contact your administrator.',503); throw error; }
  return {transferredDirect:moved,transferredTotal:descendantsMoved,roleCode,work};
 });}
};

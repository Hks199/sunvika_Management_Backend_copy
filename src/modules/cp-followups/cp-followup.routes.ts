import {Router,type RequestHandler} from 'express';
import {Schema,model,Types,type PipelineStage} from 'mongoose';
import Joi from 'joi';
import {authenticate} from '../../middleware/authenticate.middleware.js';
import {requireManagingDirector} from '../../middleware/authorize.middleware.js';
import {validateBody,validateQuery} from '../../middleware/validate.middleware.js';
import {sendSuccess} from '../../utils/api-response.util.js';
import {AppError} from '../../utils/app-error.util.js';
import {EmployeeModel} from '../employees/models/employee.model.js';
import {RoleModel} from '../roles/models/role.model.js';
const entrySchema=new Schema({cp:{type:Schema.Types.ObjectId,ref:'Employee',required:true},rm:{type:Schema.Types.ObjectId,ref:'Employee',required:true},remark:{type:String,trim:true,maxlength:1000,required:true}},{timestamps:true});
entrySchema.index({cp:1,rm:1,createdAt:-1,_id:-1});
export const CpFollowupModel=model('CpFollowup',entrySchema);
const settingsSchema=new Schema({key:{type:String,unique:true,default:'default'},frequencyDays:{type:Number,default:2,min:1,max:365},updatedBy:{type:Schema.Types.ObjectId,ref:'Employee'}},{timestamps:true});
export const CpFollowupSettingsModel=model('CpFollowupSettings',settingsSchema);
async function actorRole(actor:Types.ObjectId){const employee=await EmployeeModel.findOne({_id:actor,isActive:true}).select('role').lean();const role=employee&&await RoleModel.findOne({_id:employee.role,isActive:true}).select('code').lean();if(!role||!['MD','CP_HEAD','RM'].includes(role.code))throw new AppError('You do not have access to CP follow-ups',403);return role.code;}
export function followupScope(role:string,actor:Types.ObjectId,cpRole:Types.ObjectId){return {role:cpRole,isActive:true,...(role==='RM'?{reportingTo:actor}:role==='CP_HEAD'?{hierarchyPath:actor}:{})};}
export function followupStatus(last:Date|null,created:Date,days:number,now=new Date()){const dueAt=new Date((last??created).getTime()+days*86400000);return {status:!last?'NOT_FOLLOWED_UP':dueAt<=now?'DUE':'FOLLOWED_UP',dueAt};}
export function followupFilterPipeline(query:Record<string,unknown>,status:'FOLLOWED_UP'|'NOT_FOLLOWED_UP',cutoff:Date,page:number,limit:number):PipelineStage[]{
 const recent={'_lastFollowup.createdAt':{$gt:cutoff}};
 return [{$match:query},{$lookup:{from:CpFollowupModel.collection.name,let:{cpId:'$_id',rmId:'$reportingTo'},pipeline:[{$match:{$expr:{$and:[{$eq:['$cp','$$cpId']},{$eq:['$rm','$$rmId']}]}}},{$sort:{createdAt:-1,_id:-1}},{$limit:1},{$project:{createdAt:1}}],as:'_lastFollowup'}},{$match:status==='FOLLOWED_UP'?recent:{$nor:[recent]}},{$sort:{employeeCode:1,_id:1}},{$facet:{rows:[{$skip:(page-1)*limit},{$limit:limit},{$project:{_id:1}}],count:[{$count:'total'}]}}];
}
export function followupCountsPipeline(query:Record<string,unknown>,cutoff:Date):PipelineStage[]{
 return [{$match:query},{$lookup:{from:CpFollowupModel.collection.name,let:{cpId:'$_id',rmId:'$reportingTo'},pipeline:[{$match:{$expr:{$and:[{$eq:['$cp','$$cpId']},{$eq:['$rm','$$rmId']}]}}},{$sort:{createdAt:-1,_id:-1}},{$limit:1},{$project:{createdAt:1}}],as:'_lastFollowup'}},{$facet:{total:[{$count:'value'}],followed:[{$match:{'_lastFollowup.createdAt':{$gt:cutoff}}},{$count:'value'}]}}];
}
const route=(work:(req:import('express').Request,res:import('express').Response)=>Promise<unknown>):RequestHandler=>async(req,res,next)=>{try{await work(req,res)}catch(error){next(error)}};
export const cpFollowupRouter=Router();cpFollowupRouter.use(authenticate);cpFollowupRouter.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next()});
cpFollowupRouter.get('/settings',route(async(req,res)=>{await actorRole(req.auth!.employeeId);const settings=await CpFollowupSettingsModel.findOne({key:'default'}).lean();return sendSuccess(res,'CP follow-up settings',{frequencyDays:settings?.frequencyDays??2});}));
cpFollowupRouter.patch('/settings',requireManagingDirector,validateBody(Joi.object({frequencyDays:Joi.number().integer().min(1).max(365).required()}).unknown(false)),route(async(req,res)=>{const saved=await CpFollowupSettingsModel.findOneAndUpdate({key:'default'},{$set:{frequencyDays:req.body.frequencyDays,updatedBy:req.auth!.employeeId}},{new:true,upsert:true,runValidators:true});return sendSuccess(res,'CP follow-up frequency saved',{frequencyDays:saved.frequencyDays});}));
cpFollowupRouter.get('/managers',route(async(req,res)=>{
 const actor=req.auth!.employeeId,role=await actorRole(actor);if(role==='RM')throw new AppError('Only uplines can view RM filters',403);
 const rmRole=await RoleModel.findOne({code:'RM'}).select('_id').lean();if(!rmRole)return sendSuccess(res,'RMs',[]);
 const rms=await EmployeeModel.find({role:rmRole._id,...(role==='CP_HEAD'?{hierarchyPath:actor}:{})}).select('firstName lastName employeeCode isActive').sort({firstName:1,lastName:1,employeeCode:1}).lean();return sendSuccess(res,'RMs',rms);
}));
cpFollowupRouter.get('/',validateQuery(Joi.object({page:Joi.number().integer().min(1).default(1),limit:Joi.number().integer().min(1).max(100).default(25),status:Joi.string().valid('FOLLOWED_UP','NOT_FOLLOWED_UP'),rmId:Joi.string().hex().length(24)})),route(async(req,res)=>{
 const actor=req.auth!.employeeId,role=await actorRole(actor),{page,limit,status,rmId}=res.locals.validatedQuery;
 const cpRole=await RoleModel.findOne({code:'CP',isActive:true}).select('_id').lean();if(!cpRole)return sendSuccess(res,'CP follow-ups',{data:[],total:0,page,limit,frequencyDays:2,counts:{total:0,followedUp:0,notFollowedUp:0}});
 let query:Record<string,unknown>=followupScope(role,actor,cpRole._id);
 if(rmId){const rmRole=await RoleModel.findOne({code:'RM'}).select('_id').lean();const target=new Types.ObjectId(rmId);if(role==='RM'&&!target.equals(actor))throw new AppError('RM not found in your scope',404);if(!rmRole||!await EmployeeModel.exists({_id:target,role:rmRole._id,...(role==='CP_HEAD'?{hierarchyPath:actor}:{})}))throw new AppError('RM not found in your scope',404);query={...query,reportingTo:target};}
 const config=await CpFollowupSettingsModel.findOne({key:'default'}).lean();const frequencyDays=config?.frequencyDays??2,now=new Date(),cutoff=new Date(now.getTime()-frequencyDays*86400000);
 const grouped=await EmployeeModel.aggregate(followupCountsPipeline(query,cutoff));const summary=grouped[0] as {total:Array<{value:number}>;followed:Array<{value:number}>}|undefined;const countTotal=summary?.total[0]?.value??0,followedUp=summary?.followed[0]?.value??0;const counts={total:countTotal,followedUp,notFollowedUp:countTotal-followedUp};
 let total:number;let pageQuery:Record<string,unknown>=query;let skip=(page-1)*limit;
 if(status){const result=await EmployeeModel.aggregate(followupFilterPipeline(query,status,cutoff,page,limit));const group=result[0] as {rows:Array<{_id:Types.ObjectId}>;count:Array<{total:number}>}|undefined;total=group?.count[0]?.total??0;pageQuery={...query,_id:{$in:(group?.rows??[]).map(row=>row._id)}};skip=0;}else total=await EmployeeModel.countDocuments(query);
 const cps=await EmployeeModel.find(pageQuery).select('firstName lastName employeeCode mobileNumber reportingTo createdAt').populate('reportingTo','firstName lastName employeeCode').sort({employeeCode:1,_id:1}).skip(skip).limit(limit).lean();
 const ids=cps.map(cp=>cp._id);const latest=ids.length?await CpFollowupModel.aggregate([{$match:{cp:{$in:ids}}},{$sort:{createdAt:-1,_id:-1}},{$group:{_id:{cp:'$cp',rm:'$rm'},record:{$first:'$$ROOT'}}}]):[];
 const byKey=new Map(latest.map(item=>[`${item._id.cp}:${item._id.rm}`,item.record]));
 const data=cps.map(cp=>{const manager=cp.reportingTo as unknown as {_id:Types.ObjectId;firstName:string;lastName:string;employeeCode:string}|undefined;const record=manager?byKey.get(`${cp._id}:${manager._id}`):undefined;const last=record?.createdAt?new Date(record.createdAt):null;return {cp:{_id:cp._id,firstName:cp.firstName,lastName:cp.lastName,employeeCode:cp.employeeCode,mobileNumber:cp.mobileNumber},rm:manager??null,lastFollowupAt:last,remark:record?.remark??'',...followupStatus(last,new Date(cp.createdAt),frequencyDays,now)};});
 return sendSuccess(res,'CP follow-ups',{data,total,page,limit,frequencyDays,counts});
}));
cpFollowupRouter.post('/:cpId',validateBody(Joi.object({remark:Joi.string().trim().min(1).max(1000).required()}).unknown(false)),route(async(req,res)=>{
 const actor=req.auth!.employeeId;if(await actorRole(actor)!=='RM')throw new AppError('Only the reporting RM can record a follow-up',403);const id=String(req.params.cpId);if(!Types.ObjectId.isValid(id))throw new AppError('Channel partner not found',404);const cpRole=await RoleModel.findOne({code:'CP',isActive:true}).select('_id').lean();if(!cpRole||!await EmployeeModel.exists({_id:id,role:cpRole._id,isActive:true,reportingTo:actor}))throw new AppError('Channel partner not found in your downline',404);const entry=await CpFollowupModel.create({cp:id,rm:actor,remark:req.body.remark});return sendSuccess(res,'Follow-up recorded',{_id:entry._id,remark:entry.remark,createdAt:entry.createdAt},201);
}));

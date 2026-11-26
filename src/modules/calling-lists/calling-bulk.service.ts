import { createHash, randomUUID } from 'node:crypto';
import { expireCallingLocations } from './calling-location.service.js';
import mongoose, { Types } from 'mongoose';
import { env } from '../../config/env.config.js';
import { AppError } from '../../utils/app-error.util.js';
import { logger } from '../../services/logger.service.js';
import { EmployeeModel } from '../employees/models/employee.model.js';
import { RoleModel } from '../roles/models/role.model.js';
import { StateModel } from '../geography/models/state.model.js';
import { DistrictModel } from '../geography/models/district.model.js';
import { geographyService } from '../geography/services/geography.service.js';
import { indiaDay } from '../calling-reports/calling-report.policy.js';
import { CallingBatchModel, CallingAllocationModel, CallingDistributionSettingsModel, CallingLanguageOptionsModel } from './calling-bulk.model.js';
import { CallingListModel, CallingCandidateModel } from './calling-list.model.js';
import { callingListStorage } from './calling-list.storage.js';
import { buildCallingSheet, splitCallingWorkbook } from './calling-bulk.excel.js';
import { assignStoredCallingSheet } from './calling-sheet-assignment.js';

export async function assertCallingBatchAdministrator(actorId: Types.ObjectId) {
  const employee = await EmployeeModel.findOne({ _id: actorId, isActive: true }).select('role').lean();
  const role = employee ? await RoleModel.findOne({ _id: employee.role, isActive: true }).select('code').lean() : null;
  if (!role || !['MD','MIS'].includes(role.code)) throw new AppError('Only MD and MIS can manage upload batches and daily distribution', 403);
}
const publicBatch = 'allocationState allocationDistrict language title fileName uploadedBy state size candidateCount sheetCount error createdAt completedAt';
export function dailyDistributionTime(now: Date) {
  return { day: indiaDay(now), due: true };
}
export const callingBulkService = {
  async languages() { return (await CallingLanguageOptionsModel.findOne({key:'default'}).lean())?.languages ?? []; },
  async saveLanguages(languages:string[]) { const saved=await CallingLanguageOptionsModel.findOneAndUpdate({key:'default'},{$set:{languages}},{upsert:true,new:true,runValidators:true});return saved.languages; },
  async availability(actorId: Types.ObjectId, active?: boolean, languages?: string[]) {
    const employee = await EmployeeModel.findOne({ _id: actorId, isActive: true }).select('role callingAllocationActive callingLocationExpiresAt callingLanguages').lean();
    const role = employee ? await RoleModel.findOne({ _id: employee.role, code: 'RM', isActive: true }).select('_id').lean() : null;
    if (!role) throw new AppError('Only an active RM can change calling allocation availability', 403);
    if(active===true)throw new AppError('A GPS location check is required to activate',400);
    if(employee?.callingAllocationActive&&(!employee.callingLocationExpiresAt||employee.callingLocationExpiresAt<=new Date())){await EmployeeModel.updateOne({_id:actorId},{$set:{callingAllocationActive:false},$unset:{callingLocationExpiresAt:1}});employee.callingAllocationActive=false;}
    const allowedLanguages=languages ? await this.languages() : [];
    if (languages && languages.some(language=>!(allowedLanguages.includes(language)))) throw new AppError('Select languages configured by MD',400);
    if (active !== undefined || languages !== undefined) {
      const result = await EmployeeModel.updateOne({ _id: actorId, role: role._id, isActive: true }, { $set: { ...(active !== undefined ? { callingAllocationActive: active } : {}), ...(languages !== undefined ? { callingLanguages: languages } : {}) } });
      if (!result.matchedCount) throw new AppError('RM account is no longer active', 403);
    }
    return { active: active ?? Boolean(employee?.callingAllocationActive), languages: languages ?? employee?.callingLanguages ?? [] };
  },
  async reserve(actorId: Types.ObjectId, input: { title?: string; fileName: string; size: number; allocationState?:string; allocationDistrict?:string }) {
    await assertCallingBatchAdministrator(actorId);
    if(input.allocationState&&input.allocationDistrict)await geographyService.validateEmployeePlacement(input.allocationState,input.allocationDistrict);
    if (!env.awsRegion || !env.awsCallingListBucketName) throw new AppError('Calling-list S3 storage is not configured', 503);
    const id = new Types.ObjectId();
    const title=input.fileName.replace(/\.xlsx$/i,'').slice(0,140).trim()||'Calling candidates';
    const batch = await CallingBatchModel.create({ _id: id, ...input, title, uploadedBy: actorId, bucket: env.awsCallingListBucketName,
      key: `calling-lists/batches/${id}/source.xlsx`, expiresAt: new Date(Date.now() + 30 * 60_000) });
    return { _id: batch._id, expiresAt: batch.expiresAt };
  },
  async upload(actorId: Types.ObjectId, batchId: string, bytes: Buffer) {
    await assertCallingBatchAdministrator(actorId);
    if (!Types.ObjectId.isValid(batchId)) throw new AppError('Batch not found', 404);
    const batch = await CallingBatchModel.findById(batchId).select('+bucket +key');
    if (!batch) throw new AppError('Batch not found', 404);
    if (!Buffer.isBuffer(bytes) || bytes.length !== batch.size || bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) throw new AppError('Upload the selected .xlsx workbook with its reserved size', 400);
    const claimed = await CallingBatchModel.updateOne({ _id: batch._id, state: 'RESERVED', expiresAt: { $gt: new Date() } }, { $set: { state: 'UPLOADING', leaseUntil: new Date(Date.now() + 30 * 60_000) } });
    if (!claimed.modifiedCount) throw new AppError('Upload expired or is already in progress. Select the workbook again.', 409);
    try {
      await callingListStorage.put(batch.bucket, batch.key, bytes);
      await CallingBatchModel.updateOne({ _id: batch._id, state: 'UPLOADING' }, { $set: { state: 'QUEUED' }, $unset: { expiresAt: 1, leaseUntil: 1 } });
    } catch (error) { await CallingBatchModel.updateOne({ _id: batch._id, state: 'UPLOADING' }, { $set: { state: 'RESERVED' } }); throw error; }
    return { _id: batch._id, state: 'QUEUED' };
  },
  async labelBatchLocation(actorId:Types.ObjectId,batchId:string,allocationState:string,allocationDistrict:string) {
    await assertCallingBatchAdministrator(actorId);
    if(!Types.ObjectId.isValid(batchId))throw new AppError('Batch not found',404);
    await geographyService.validateEmployeePlacement(allocationState,allocationDistrict);
    await mongoose.connection.transaction(async session=>{
      const batch=await CallingBatchModel.findOneAndUpdate({_id:batchId,state:'READY',$or:[{allocationState:{$exists:false}},{allocationDistrict:{$exists:false}}]},{$set:{allocationState,allocationDistrict}},{new:true,session});
      if(!batch)throw new AppError('Only a ready batch without a complete location can be labelled',409);
      await CallingListModel.updateMany({batch:batch._id,assignedTo:null},{$set:{allocationState,allocationDistrict}},{session});
    });
    return {allocationState,allocationDistrict};
  },
  async list(actorId: Types.ObjectId, page: number, limit: number) {
    await assertCallingBatchAdministrator(actorId);
    const [data,total] = await Promise.all([CallingBatchModel.find().select(publicBatch).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).lean(),CallingBatchModel.countDocuments()]);
    return { data,total,page,limit };
  },
  async retry(actorId: Types.ObjectId, batchId: string) {
    await assertCallingBatchAdministrator(actorId);
    if (!Types.ObjectId.isValid(batchId)) throw new AppError('Batch not found',404);
    const batch = await CallingBatchModel.findOneAndUpdate({ _id: batchId, $or: [{ state:'FAILED' },{ state:'UPLOADING',leaseUntil:{$lte:new Date()} }] },{ $set:{state:'QUEUED',error:''} });
    if (!batch) throw new AppError('Only failed or interrupted uploads can be retried',409);
    return { _id:batch._id,state:'QUEUED' };
  },
  async settings(actorId: Types.ObjectId) { await assertCallingBatchAdministrator(actorId); return (await CallingDistributionSettingsModel.findOne({key:'daily'}).select('enabled skipUnfinished -_id').lean()) ?? { enabled:true,skipUnfinished:false }; },
  async saveSettings(actorId: Types.ObjectId, input: { enabled:boolean; skipUnfinished:boolean }) {
    await assertCallingBatchAdministrator(actorId);
    return CallingDistributionSettingsModel.findOneAndUpdate({key:'daily'},{$set:{enabled:input.enabled,skipUnfinished:input.skipUnfinished,updatedBy:actorId}},{new:true,upsert:true,runValidators:true}).select('enabled skipUnfinished -_id');
  }
};

/** Recoverable queue worker: a batch's partial sheets remain hidden until the whole import succeeds. */
export async function processCallingBatch() {
  const owner = randomUUID(), now = new Date();
  const batch = await CallingBatchModel.findOneAndUpdate({ $or:[{state:'QUEUED'},{state:'PROCESSING',leaseUntil:{$lt:now}}] },
    {$set:{state:'PROCESSING',leaseOwner:owner,leaseUntil:new Date(Date.now()+20*60_000),error:''}}, {new:true,sort:{createdAt:1}}).select('+bucket +key');
  if (!batch) return false;
  try {
    const bytes = await callingListStorage.read(batch.bucket,batch.key);
    let expectedLocation: {state:string;district:string}|undefined;
    let allocationState=batch.allocationState,allocationDistrict=batch.allocationDistrict;
    if(batch.allocationState&&batch.allocationDistrict){
      const [state,district]=await Promise.all([StateModel.findById(batch.allocationState).select('name').lean(),DistrictModel.findOne({_id:batch.allocationDistrict,state:batch.allocationState}).select('name').lean()]);
      if(!state||!district)throw new AppError('Batch state or district is no longer available',400);
      expectedLocation={state:state.name,district:district.name};
    }
    const counts = await splitCallingWorkbook(bytes,async(headers,rows,part,count)=>{
      const id = new Types.ObjectId(createHash('sha256').update(`${batch._id}:${part}`).digest('hex').slice(0,24));
      const partName = `${batch._id}_part_${String(part).padStart(5,'0')}.xlsx`, key = `calling-lists/batches/${batch._id}/${partName}`;
      const workbook = await buildCallingSheet(headers,rows);
      const lease = await CallingBatchModel.updateOne({_id:batch._id,state:'PROCESSING',leaseOwner:owner},{$set:{leaseUntil:new Date(Date.now()+20*60_000)}});
      if(!lease.matchedCount)throw new AppError('Batch processing lease expired',409);
      await callingListStorage.put(batch.bucket,key,workbook);
      await CallingListModel.updateOne({_id:id,state:{$ne:'READY'}},{$set:{batch:batch._id,...(allocationState&&allocationDistrict?{allocationState,allocationDistrict}:{}),part,title:`${batch.title} / ${part}`,fileName:partName,uploadedBy:batch.uploadedBy,bucket:batch.bucket,key,state:'STAGED',candidateStorage:'S3',headers,rowCount:rows.length,originalRowCount:rows.length,size:workbook.length}}, {upsert:true});
      await CallingBatchModel.updateOne({_id:batch._id,leaseOwner:owner},{$set:{candidateCount:count,sheetCount:part}});
    },expectedLocation,async location=>{
      const stateName=location.state.trim().toLowerCase(),districtName=location.district.trim().toLowerCase();
      const state=await StateModel.findOne({normalizedName:stateName,isActive:true}).select('_id name').lean();
      const district=state?await DistrictModel.findOne({normalizedName:districtName,state:state._id,isActive:true}).select('_id name').lean():null;
      if(!state||!district)throw new AppError('The workbook state and district must match active locations configured in Geography',400);
      allocationState=state._id;allocationDistrict=district._id;
      const updated=await CallingBatchModel.updateOne({_id:batch._id,state:'PROCESSING',leaseOwner:owner},{$set:{allocationState,allocationDistrict}});
      if(!updated.matchedCount)throw new AppError('Batch processing lease expired',409);
    });
    await mongoose.connection.transaction(async session=>{
      const completed = await CallingBatchModel.updateOne({_id:batch._id,state:'PROCESSING',leaseOwner:owner},{$set:{state:'READY',...counts,completedAt:new Date()},$unset:{leaseOwner:1,leaseUntil:1}}, {session});
      if(!completed.modifiedCount)throw new AppError('Batch processing ownership changed',409);
      await CallingListModel.updateMany({batch:batch._id,state:'STAGED'},{$set:{state:'READY'}},{session});
    });
  } catch(error) {
    logger.error({err:error,batchId:batch._id},'Calling batch processing failed');
    await CallingBatchModel.updateOne({_id:batch._id,state:'PROCESSING',leaseOwner:owner},{$set:{state:'FAILED',error:error instanceof AppError?error.message:'Processing failed. Retry or upload a corrected workbook.'},$unset:{leaseOwner:1,leaseUntil:1}});
  }
  return true;
}

/** Unique (IST day, RM, slot) allocations make retries and multiple API instances safe. */
export async function distributeDailyCallingSheets(now = new Date()) {
  await expireCallingLocations();
  const {day,due}=dailyDistributionTime(now); if(!due)return;
  const settings = await CallingDistributionSettingsModel.findOne({key:'daily'}).lean();
  if(settings?.enabled===false)return;
  const role=await RoleModel.findOne({code:'RM',isActive:true}).select('_id').lean();if(!role)return;
  const rms=await EmployeeModel.find({role:role._id,isActive:true,callingAllocationActive:true,callingLocationExpiresAt:{$gt:now}}).select('_id address.state address.district').sort({employeeCode:1}).lean();
  // Rotate the first recipient daily so a small remaining pool is not always given to the same RMs.
  const offset=rms.length?Math.floor(Date.parse(day)/86400_000)%rms.length:0;
  const ordered=[...rms.slice(offset),...rms.slice(0,offset)];
  const slot = 0; // One sheet per RM per day; preserve historical slot references.
  for(const rm of ordered){
    if(!rm.address?.state || !rm.address?.district || await CallingAllocationModel.exists({day,rm:rm._id}))continue;
    for(let attempt=0;attempt<3;attempt++){
      const list=await CallingListModel.findOne({state:'READY',candidateStorage:'S3',assignedTo:null,busy:false,batch:{$type:'objectId'},allocationState:rm.address.state,allocationDistrict:rm.address.district}).sort({createdAt:1,part:1}).select('_id').lean();
      if(!list)break;
      try{await assignStoredCallingSheet(list._id,rm._id,undefined,{day,slot});break;}
      catch(error){
        if(await CallingAllocationModel.exists({day,rm:rm._id}))break;
        if((error as {statusCode?:number}).statusCode===409)continue;
        logger.error({err:error,listId:list._id,rmId:rm._id},'Daily calling-sheet assignment failed');break;
      }
    }
  }
}

export function startCallingDistributionWorker() {
  let processing=false,distributing=false;
  const tick=()=>{
    if(!processing){processing=true;void processCallingBatch().catch(error=>logger.error({err:error},'Calling import worker failed')).finally(()=>{processing=false;});}
    if(!distributing){distributing=true;void distributeDailyCallingSheets().catch(error=>logger.error({err:error},'Calling distribution worker failed')).finally(()=>{distributing=false;});}
  };
  const timer=setInterval(tick,30_000);timer.unref();tick();
  return ()=>clearInterval(timer);
}

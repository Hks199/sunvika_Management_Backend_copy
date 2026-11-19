import 'dotenv/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose,{Types} from 'mongoose';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
process.env.AWS_REGION='ap-south-2';process.env.AWS_S3_PROFILE_BUCKET='profile-image-test';
const {env}=await import('../dist/config/env.config.js');
const {EmployeeModel}=await import('../dist/modules/employees/models/employee.model.js');
const {RoleModel}=await import('../dist/modules/roles/models/role.model.js');
const {PermissionModel}=await import('../dist/modules/roles/models/permission.model.js');
const {HierarchyLockModel}=await import('../dist/modules/employees/models/hierarchy-lock.model.js');
const {ProfileImageUploadModel}=await import('../dist/modules/employees/models/profile-image-upload.model.js');
const {profileImageService}=await import('../dist/modules/employees/services/profile-image.service.js');
const {employeeProfileImageService:service}=await import('../dist/modules/employees/services/employee-profile-image.service.js');
test('isolated employee photo replacement: private storage, management scope, ownership, one-use tickets and atomic rollback',{skip:process.env.EMPLOYEE_PHOTO_DB_TEST!=='1'},async()=>{
 const dbName=`sunvika_photo_${Date.now()}_${Math.random().toString(16).slice(2,6)}`;
 await mongoose.connect(env.mongoUri,{dbName,serverSelectionTimeoutMS:10000});
 const send=S3Client.prototype.send,update=ProfileImageUploadModel.updateOne,objects=new Map();
 S3Client.prototype.send=async function(command){
  if(command instanceof PutObjectCommand){objects.set(command.input.Key,{bytes:Buffer.from(command.input.Body),type:command.input.ContentType});return {};}
  if(command instanceof GetObjectCommand){const object=objects.get(command.input.Key);if(!object)throw new Error('Missing fake object');return {ContentLength:object.bytes.length,ContentType:object.type,Body:{transformToByteArray:async()=>object.bytes}};}
  throw new Error('Unexpected storage command');
 };
 try{
  for(const model of [EmployeeModel,RoleModel,PermissionModel,HierarchyLockModel,ProfileImageUploadModel])await model.init();
  const edit=await PermissionModel.create({module:'employees',action:'update',code:'employees.update'});
  const roles={};for(const [level,code]of ['MD','MIS','CP_HEAD','RM','CP'].entries())roles[code]=await RoleModel.create({name:code,code,category:'PRIMARY',level,permissions:code==='RM'?[edit._id]:[]});
  const mdId=new Types.ObjectId();let n=0;
  const person=(code,path=[])=>{n++;return EmployeeModel.create({_id:code==='MD'?mdId:new Types.ObjectId(),employeeCode:`PHOTO-${n}`,firstName:'Fixture',lastName:String(n),email:`photo${n}@example.invalid`,mobileNumber:`987650${String(n).padStart(4,'0')}`,role:roles[code]._id,hierarchyPath:path,createdBy:mdId,isActive:true});};
  const md=await person('MD'),head=await person('CP_HEAD',[md._id]),rm=await person('RM',[md._id,head._id]),other=await person('RM',[md._id]),cp=await person('CP',[md._id,head._id,rm._id]),mis=await person('MIS',[md._id]);
  await EmployeeModel.updateOne({_id:cp._id},{$set:{profileImage:{key:'employee-profile-images/old.png'}}});
  assert.equal((await service.options(md._id,String(cp._id))).canEdit,true);assert.equal((await service.options(rm._id,String(cp._id))).canEdit,true);assert.equal((await service.options(mis._id,String(cp._id))).canEdit,false);
  await assert.rejects(service.assertEdit(other._id,String(cp._id)),error=>error.statusCode===404);
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==','base64');
  async function upload(owner){const ticket=await profileImageService.createUploadReservation(owner,'image/png',bytes.length);await profileImageService.uploadReservedImage(owner,ticket.uploadId,'image/png',bytes);return ticket;}
  const first=await upload(rm._id);const result=await service.replace(rm._id,String(cp._id),first.uploadId);
  const saved=await EmployeeModel.findById(cp._id),ticket=await ProfileImageUploadModel.findById(first.uploadId);
  assert.equal(saved.profileImage.key,result.profileImage.key);assert.notEqual(saved.profileImage.key,'employee-profile-images/old.png');assert.equal(String(ticket.employee),String(cp._id));
  await assert.rejects(service.replace(rm._id,String(cp._id),first.uploadId),error=>error.statusCode===400);
  const owned=await upload(md._id);await assert.rejects(service.replace(rm._id,String(cp._id),owned.uploadId),error=>error.statusCode===400);assert.equal((await EmployeeModel.findById(cp._id)).profileImage.key,saved.profileImage.key);
  const bad=await profileImageService.createUploadReservation(rm._id,'image/png',3);await assert.rejects(profileImageService.uploadReservedImage(rm._id,bad.uploadId,'image/png',Buffer.from('bad')),error=>error.statusCode===400);
  const failed=await upload(rm._id);
  ProfileImageUploadModel.updateOne=function(filter,mutation,...args){if(mutation.$set?.employee)throw new Error('Simulated ticket completion failure');return update.call(this,filter,mutation,...args);};
  await assert.rejects(service.replace(rm._id,String(cp._id),failed.uploadId),/Simulated ticket completion failure/);
  ProfileImageUploadModel.updateOne=update;
  assert.equal((await EmployeeModel.findById(cp._id)).profileImage.key,saved.profileImage.key);
  const released=await ProfileImageUploadModel.findById(failed.uploadId);assert.equal(released.employee,undefined);assert.equal(released.claimedAt,null);
  await service.replace(rm._id,String(cp._id),failed.uploadId);assert.notEqual((await EmployeeModel.findById(cp._id)).profileImage.key,saved.profileImage.key);
 }finally{
  S3Client.prototype.send=send;ProfileImageUploadModel.updateOne=update;
  if(mongoose.connection.name!==dbName||!/^sunvika_photo_\d{13}_[a-f0-9]{4}$/.test(dbName))throw new Error('Unexpected test database');
  try{await mongoose.connection.dropDatabase();}finally{await mongoose.disconnect();}
 }
});

import {randomUUID} from 'node:crypto';
import {DeleteObjectCommand,GetObjectCommand,PutObjectCommand,S3Client} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {Schema,model,Types} from 'mongoose';
import {env} from '../../../config/env.config.js';
import {AppError} from '../../../utils/app-error.util.js';
import {EmployeeModel} from '../models/employee.model.js';
import {RoleModel} from '../../roles/models/role.model.js';
import {hierarchyService} from './hierarchy.service.js';
import {roleService} from '../../roles/services/role.service.js';
const schema=new Schema({cp:{type:Schema.Types.ObjectId,ref:'Employee',required:true},type:{type:String,enum:['AADHAAR','PAN','PHOTO'],required:true},key:{type:String,required:true,select:false},mimeType:{type:String,required:true},size:{type:Number,required:true},updatedBy:{type:Schema.Types.ObjectId,ref:'Employee',required:true}},{timestamps:true});
schema.index({cp:1,type:1},{unique:true});
export const CpIdentityDocumentModel=model('CpIdentityDocument',schema);
const allowed=new Map([['application/pdf','pdf'],['image/jpeg','jpg'],['image/png','png'],['image/webp','webp']]);
let client:S3Client|undefined;
function storage(){if(!env.awsRegion||!env.awsCustomerDocumentBucketName)throw new AppError('Identity document storage is not configured',503);return client??=new S3Client({region:env.awsRegion,followRegionRedirects:true,...(env.awsAccessKeyId&&env.awsSecretAccessKey?{credentials:{accessKeyId:env.awsAccessKeyId,secretAccessKey:env.awsSecretAccessKey}}:{})});}
export function validIdentityBytes(type:string,bytes:Uint8Array){if(type==='application/pdf')return Buffer.from(bytes.subarray(0,5)).toString('ascii')==='%PDF-';if(type==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;if(type==='image/png')return bytes.subarray(0,8).join(',')==='137,80,78,71,13,10,26,10';return type==='image/webp'&&Buffer.from(bytes.subarray(0,4)).toString('ascii')==='RIFF'&&Buffer.from(bytes.subarray(8,12)).toString('ascii')==='WEBP';}
async function authorize(actor:Types.ObjectId,value:string,mode:'read'|'manage'){
 if(!Types.ObjectId.isValid(value))throw new AppError('Channel partner not found',404);const id=new Types.ObjectId(value);
 if(!await roleService.hasPermission(actor,mode==='read'?'employees.read':'employees.update')||!await hierarchyService.canAccessEmployee(actor,id,mode))throw new AppError('Channel partner not found',404);
 const cp=await EmployeeModel.findById(id).select('role').lean();if(!cp||!await RoleModel.exists({_id:cp.role,code:'CP'}))throw new AppError('Channel partner not found',404);return id;
}
export const cpIdentityDocumentService={
 async list(actor:Types.ObjectId,value:string){const cp=await authorize(actor,value,'read');const [docs,canEdit]=await Promise.all([CpIdentityDocumentModel.find({cp}).select('type mimeType size updatedAt').lean(),roleService.hasPermission(actor,'employees.update').then(ok=>ok?hierarchyService.canAccessEmployee(actor,cp,'manage'):false)]);return {documents:docs,canEdit};},
 async upload(actor:Types.ObjectId,value:string,type:string,mime:string,bytes:Buffer){const cp=await authorize(actor,value,'manage');if(!['AADHAAR','PAN','PHOTO'].includes(type))throw new AppError('Invalid document type',400);const ext=allowed.get(mime);if(type==='PHOTO'&&!mime.startsWith('image/'))throw new AppError('Passport photo must be a JPEG, PNG or WebP image',400);if(!ext||!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>env.customerDocumentMaxSizeBytes||!validIdentityBytes(mime,bytes))throw new AppError('Choose a valid PDF, JPEG, PNG or WebP within the allowed size',400);const key=`cp-identity-documents/${cp}/${randomUUID()}.${ext}`;await storage().send(new PutObjectCommand({Bucket:env.awsCustomerDocumentBucketName,Key:key,Body:bytes,ContentType:mime,ContentLength:bytes.length,ServerSideEncryption:'AES256'}));let previous:{key:string}|null;try{previous=await CpIdentityDocumentModel.findOneAndUpdate({cp,type},{$set:{key,mimeType:mime,size:bytes.length,updatedBy:actor}},{upsert:true,new:false,runValidators:true}).select('+key').lean();}catch(error){await storage().send(new DeleteObjectCommand({Bucket:env.awsCustomerDocumentBucketName,Key:key})).catch(()=>{});throw error;}if(previous?.key)await storage().send(new DeleteObjectCommand({Bucket:env.awsCustomerDocumentBucketName,Key:previous.key})).catch(()=>{});return {type,uploaded:true};},
 async download(actor:Types.ObjectId,value:string,type:string,preview=false){const cp=await authorize(actor,value,'read');if(!['AADHAAR','PAN','PHOTO'].includes(type))throw new AppError('Invalid document type',400);const doc=await CpIdentityDocumentModel.findOne({cp,type}).select('+key').lean();if(!doc)throw new AppError('Document not found',404);return {url:await getSignedUrl(storage(),new GetObjectCommand({Bucket:env.awsCustomerDocumentBucketName,Key:doc.key,ResponseContentDisposition:preview?'inline':'attachment'}),{expiresIn:60}),expiresInSeconds:60};}
};

import { Schema, model } from 'mongoose';
const groupSchema=new Schema({ sheetName:{type:String}, generatedAt:{type:Date}, state:{type:String,required:true}, district:{type:String,required:true}, count:{type:Number,required:true}, key:{type:String,required:true,select:false}, groupId:{type:String,required:true} },{_id:false});
const schema=new Schema({fileName:{type:String,required:true},size:{type:Number,required:true},owner:{type:Schema.Types.ObjectId,ref:'Employee',required:true},bucket:{type:String,required:true,select:false},key:{type:String,required:true,select:false},state:{type:String,enum:['RESERVED','UPLOADING','QUEUED','PROCESSING','READY','FAILED'],default:'RESERVED'},leaseOwner:String,leaseUntil:Date,expiresAt:Date,error:{type:String,default:''},count:{type:Number,default:0},groups:{type:[groupSchema],default:[]}},{timestamps:true,strict:'throw'});
schema.index({state:1,leaseUntil:1,createdAt:1});
export const StateImportModel=model('StateImport',schema);

const sheetSequenceSchema=new Schema({ _id:{type:String,required:true}, value:{type:Number,required:true} },{versionKey:false,strict:'throw'});
export const StateSheetSequenceModel=model('StateSheetSequence',sheetSequenceSchema);

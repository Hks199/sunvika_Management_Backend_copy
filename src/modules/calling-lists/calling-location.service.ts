import {Schema,model,Types} from 'mongoose';
import {EmployeeModel} from '../employees/models/employee.model.js';
import {RoleModel} from '../roles/models/role.model.js';
import {AppError} from '../../utils/app-error.util.js';
const schema=new Schema({key:{type:String,unique:true,default:'default'},latitude:{type:Number,default:21.230612454334352},longitude:{type:Number,default:81.6397069242302},radiusMeters:{type:Number,default:20},frequencyMinutes:{type:Number,default:5},updatedBy:{type:Schema.Types.ObjectId,ref:'Employee'}},{timestamps:true});
export const CallingLocationSettings=model('CallingLocationSettings',schema);
export const DEFAULT_LOCATION={latitude:21.230612454334352,longitude:81.6397069242302,radiusMeters:20,frequencyMinutes:5};
export async function locationSettings(){const settings=await CallingLocationSettings.findOne({key:'default'}).lean();return settings?{latitude:settings.latitude,longitude:settings.longitude,radiusMeters:settings.radiusMeters,frequencyMinutes:settings.frequencyMinutes}:DEFAULT_LOCATION;}
export function distanceMeters(a:number,b:number,c:number,d:number){const rad=Math.PI/180;const x=Math.sin((c-a)*rad/2)**2+Math.cos(a*rad)*Math.cos(c*rad)*Math.sin((d-b)*rad/2)**2;return 2*6371000*Math.asin(Math.min(1,Math.sqrt(x)));}
async function rm(actor:Types.ObjectId){const e=await EmployeeModel.findOne({_id:actor,isActive:true}).select('role callingAllocationActive callingLocationExpiresAt').lean();const role=e&&await RoleModel.findOne({_id:e.role,isActive:true}).select('code').lean();if(!e||role?.code!=='RM')throw new AppError('Only an RM can use calling availability',403);return e;}
export async function checkLocation(actor:Types.ObjectId,location:{latitude:number;longitude:number;accuracy:number},activate:boolean){
 const employee=await rm(actor);if(!activate&&!employee.callingAllocationActive)throw new AppError('Activate availability before sending a location check',403);
 const settings=await locationSettings();const distance=distanceMeters(location.latitude,location.longitude,settings.latitude,settings.longitude);
 // Reject uncertain fixes instead of treating a wide accuracy circle as proof of presence.
 if(location.accuracy>settings.radiusMeters||distance+location.accuracy>settings.radiusMeters){await EmployeeModel.updateOne({_id:actor},{$set:{callingAllocationActive:false},$unset:{callingLocationExpiresAt:1}});throw new AppError(location.accuracy>settings.radiusMeters?'GPS accuracy is too low. Turn on precise location and try again.':'You are outside the allowed location or GPS accuracy is insufficient.',403);}
 const expiresAt=new Date(Date.now()+(settings.frequencyMinutes*60+60)*1000);
 const result=await EmployeeModel.updateOne({_id:actor,isActive:true,...(!activate?{callingAllocationActive:true,callingLocationExpiresAt:{$gt:new Date()}}:{})},{$set:{callingAllocationActive:true,callingLocationExpiresAt:expiresAt}});
 if(!result.matchedCount)throw new AppError('Availability expired. Activate again.',403);
 return {active:true,expiresAt,frequencyMinutes:settings.frequencyMinutes};
}
export async function callingAccess(actor:Types.ObjectId){const e=await EmployeeModel.findOne({_id:actor,isActive:true}).select('role callingAllocationActive callingLocationExpiresAt').lean();const role=e&&await RoleModel.findOne({_id:e.role,isActive:true}).select('code').lean();if(role?.code==='RM'&&(!e?.callingAllocationActive||!e.callingLocationExpiresAt||e.callingLocationExpiresAt<=new Date())){await EmployeeModel.updateOne({_id:actor,callingAllocationActive:true},{$set:{callingAllocationActive:false},$unset:{callingLocationExpiresAt:1}});throw new AppError('Activate calling availability at the allowed location to access calling data.',403);}}
export async function expireCallingLocations(){await EmployeeModel.updateMany({callingAllocationActive:true,$or:[{callingLocationExpiresAt:{$lte:new Date()}},{callingLocationExpiresAt:{$exists:false}}]},{$set:{callingAllocationActive:false},$unset:{callingLocationExpiresAt:1}});}

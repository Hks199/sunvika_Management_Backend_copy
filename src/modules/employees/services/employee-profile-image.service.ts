import mongoose,{Types} from 'mongoose';
import {env} from '../../../config/env.config.js';
import {AppError} from '../../../utils/app-error.util.js';
import {EmployeeModel} from '../models/employee.model.js';
import {ProfileImageUploadModel} from '../models/profile-image-upload.model.js';
import {hierarchyService} from './hierarchy.service.js';
import {roleService} from '../../roles/services/role.service.js';
import {withHierarchyLock} from './employee.service.js';
import {profileImageService} from './profile-image.service.js';
function employeeId(value:string){if(!Types.ObjectId.isValid(value))throw new AppError('Employee not found',404);return new Types.ObjectId(value);}
export const employeeProfileImageService={
  async options(actorId:Types.ObjectId,value:string){
    const id=employeeId(value);
    if(!await hierarchyService.canAccessEmployee(actorId,id,'read'))throw new AppError('Employee not found',404);
    return {canEdit:await roleService.hasPermission(actorId,'employees.update')&&await hierarchyService.canAccessEmployee(actorId,id,'manage'),maxSizeBytes:env.profileImageMaxSizeBytes};
  },
  async assertEdit(actorId:Types.ObjectId,value:string){
    const id=employeeId(value);
    if(!await roleService.hasPermission(actorId,'employees.update'))throw new AppError('You do not have permission to change employee profile images',403);
    if(!await hierarchyService.canAccessEmployee(actorId,id,'manage'))throw new AppError('Employee not found',404);
    return id;
  },
  async replace(actorId:Types.ObjectId,value:string,uploadId:string){
    return withHierarchyLock(async()=>{
      const id=await this.assertEdit(actorId,value);
      const upload=await profileImageService.claimUpload(actorId,uploadId);
      try{
        await mongoose.connection.transaction(async session=>{
          const employee=await EmployeeModel.updateOne({_id:id},{$set:{profileImage:{key:upload.key}}},{session});
          if(!employee.matchedCount)throw new AppError('Employee not found',404);
          const completed=await ProfileImageUploadModel.updateOne({_id:upload.uploadId,owner:actorId,claimedAt:{$ne:null},revokedAt:null,employee:null},{$set:{employee:id}},{session});
          if(!completed.matchedCount)throw new AppError('Profile image upload changed; select the file and retry',409);
        });
      }catch(error){await profileImageService.releaseUpload(upload.uploadId);throw error;}
      return {_id:id,profileImage:{key:upload.key}};
    });
  }
};

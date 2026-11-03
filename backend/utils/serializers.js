'use strict';
const publicUser=user=>({id:user._id,name:user.name,email:user.email,role:user.role,createdAt:user.createdAt,googleLinked:Boolean(user.firebaseUid),hasPassword:Boolean(user.passwordHash)});
function publicOrder(order) {
  const {_id,sessionId,userId,requestKey,requestHash,checkoutOrigin,...result}=order;
  return {...result,id:_id};
}
module.exports={publicUser,publicOrder};

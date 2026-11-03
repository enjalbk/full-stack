'use strict';
const jwt=require('jsonwebtoken');
const {cookie}=require('./security');
function createAuthentication({secret,users,tokens}) {
  return async function identify(req,res,next) {
    req.user=null;
    const value=cookie(req,'temazon_auth');
    if(!value || !secret) return next();
    let claims;
    try {claims=jwt.verify(value,secret,{algorithms:['HS256'],issuer:'temazon',audience:'temazon-web'});}
    catch {return next();}
    if(typeof claims.sub!=='string' || typeof claims.jti!=='string') return next();
    const session=await tokens.findOne({_id:claims.jti,userId:claims.sub,expiresAt:{$gt:new Date()}});
    if(session) {
      const user=await users.findOne({_id:claims.sub,disabled:{$ne:true}});
      if(user) {req.user=user;req.authSessionId=claims.jti;}
    }
    next();
  };
}
module.exports={createAuthentication};

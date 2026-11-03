'use strict';
const {randomBytes,createHash}=require('node:crypto');
const {cookie}=require('./security');
const SESSION_AGE=7*24*60*60*1000;
const hash=value=>createHash('sha256').update(value).digest('hex');
function guestSession(store) {
  return async(req,res,next)=>{
    let token=cookie(req,'temazon_session');
    let guest=/^[a-f0-9]{64}$/.test(token || '')?await store.getSession(hash(token)):null;
    if(guest?.userId && guest.userId!==req.user?._id) guest=null;
    if(!guest) {
      token=randomBytes(32).toString('hex');
      guest={_id:hash(token),expiresAt:new Date(Date.now()+SESSION_AGE),items:[],revision:0,...(req.user?{userId:req.user._id}:{})};
      await store.sessions.insertOne(guest);
      res.cookie('temazon_session',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:SESSION_AGE,path:'/'});
    }
    req.sessionId=guest._id;
    next();
  };
}
module.exports={guestSession};

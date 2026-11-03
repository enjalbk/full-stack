'use strict';
const bcrypt=require('bcrypt');
const jwt=require('jsonwebtoken');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const {fail}=require('../utils/httpError');
const {cookie}=require('../middleware/security');
const {createAuthentication}=require('../middleware/authentication');
const {publicUser}=require('../utils/serializers');
const ACCESS_AGE=60*60*1000;
const GUEST_AGE=7*24*60*60*1000;
const cookieOptions={httpOnly:true,sameSite:'lax',path:'/'};
function validEmail(value) {
 if(typeof value!=='string' || value.length>200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) fail(400,'Enter a valid email address.');
 return value.trim().toLowerCase();
}
function validPassword(value) {
 if(typeof value!=='string' || value.length<12 || Buffer.byteLength(value,'utf8')>72) fail(400,'Use a password of at least 12 characters and no more than 72 UTF-8 bytes.');return value;
}
function createAuthController(store,{secret,firebaseAuth=null,firebaseConfig=null}={}) {
 if(secret && Buffer.byteLength(secret)<32) throw new Error('JWT_SECRET must contain at least 32 bytes.');
 const users=store.db.collection('users');const tokens=store.db.collection('auth_sessions');
 const secure=process.env.NODE_ENV==='production';
 const authCookie={...cookieOptions,secure,maxAge:ACCESS_AGE};

 // Used for unknown users so password comparison still takes bcrypt's normal work.
 const dummy=bcrypt.hash('not-a-real-account-password',12);
 const configured=(req,res,next)=>{if(!secret) fail(503,'Account login is not configured. Set JWT_SECRET in .env.');next();};
 const identify=createAuthentication({secret,users,tokens});
 async function issue(req,res,user) {
  if(req.user && req.user._id!==user._id) fail(409,'Sign out before switching accounts.');
  const oldToken=cookie(req,'temazon_session');
  const oldId=/^[a-f0-9]{64}$/.test(oldToken || '')?createHash('sha256').update(oldToken).digest('hex'):null;
  const newToken=randomBytes(32).toString('hex');const newId=createHash('sha256').update(newToken).digest('hex');
  const jti=randomUUID();
  await store.transaction(async session=>{
   let guest=oldId?await store.getSession(oldId,session):null;
   if(guest?.userId && guest.userId!==user._id) guest=null;
   const next={_id:newId,userId:user._id,expiresAt:new Date(Date.now()+GUEST_AGE),items:guest?.items || [],revision:0};
   if(guest?.activeCheckoutId) next.activeCheckoutId=guest.activeCheckoutId;
   await store.sessions.insertOne(next,{session});
   if(guest) {
    await store.orders.updateMany({sessionId:oldId,$or:[{userId:{$exists:false}},{userId:user._id}]},{$set:{sessionId:newId,userId:user._id}},{session});
    await store.sessions.deleteOne({_id:oldId},{session});
   }
   if(req.authSessionId) await tokens.deleteOne({_id:req.authSessionId},{session});
   await tokens.insertOne({_id:jti,userId:user._id,expiresAt:new Date(Date.now()+ACCESS_AGE)},{session});
  });
  const token=jwt.sign({},secret,{algorithm:'HS256',subject:user._id,jwtid:jti,issuer:'temazon',audience:'temazon-web',expiresIn:'1h'});
  res.cookie('temazon_auth',token,authCookie);
  res.cookie('temazon_session',newToken,{...cookieOptions,secure,maxAge:GUEST_AGE});
  return publicUser(user);
 }
 async function googleClaims(idToken) {
  if(!firebaseAuth) fail(503,'Google login is not configured. Add Firebase settings in .env.');
  if(typeof idToken!=='string' || idToken.length>10000) fail(400,'A Firebase ID token is required.');
  let claims;try{claims=await firebaseAuth.verifyIdToken(idToken,true);}catch{fail(401,'Google sign-in could not be verified. Please try again.');}
  if(claims.firebase?.sign_in_provider!=='google.com' || claims.email_verified!==true || typeof claims.uid!=='string') fail(401,'Use a verified Google account.');
  return {...claims,email:validEmail(claims.email)};
 }








 function config(req,res) {return res.json({passwordEnabled:Boolean(secret),googleEnabled:Boolean(secret&&firebaseAuth&&firebaseConfig),firebase:firebaseConfig || null});}
 function me(req,res) {return res.json({user:req.user?publicUser(req.user):null});}
 async function register(req,res) {
  if(req.user) fail(409,'Sign out before creating another account.');
  const email=validEmail(req.body?.email);const password=validPassword(req.body?.password);
  const name=req.body?.name;if(typeof name!=='string' || !name.trim() || name.trim().length>100) fail(400,'Enter your name (up to 100 characters).');
  const user={_id:randomUUID(),name:name.trim(),email,passwordHash:await bcrypt.hash(password,12),role:'customer',createdAt:new Date().toISOString()};
  try {await users.insertOne(user);}catch(error){if(error.code===11000) fail(409,'An account already exists for this email. Sign in instead.');throw error;}
  res.status(201).json({user:await issue(req,res,user)});
 }
 async function login(req,res) {
  const email=validEmail(req.body?.email);const password=req.body?.password;
  if(typeof password!=='string' || Buffer.byteLength(password)>72) fail(401,'Email or password is incorrect.');
  const user=await users.findOne({email});
  const matches=await bcrypt.compare(password,user?.passwordHash || await dummy);
  if(!user || !user.passwordHash || !matches || user.disabled) fail(401,'Email or password is incorrect.');
  res.json({user:await issue(req,res,user)});
 }
 async function google(req,res) {
  if(req.user) fail(409,'You are already signed in. Connect Google from your account.');
  const claims=await googleClaims(req.body?.idToken);
  let user=await users.findOne({firebaseUid:claims.uid});
  if(!user) {
   if(await users.findOne({email:claims.email})) fail(409,'Sign in with your password first, then connect Google from your account.');
   user={_id:randomUUID(),firebaseUid:claims.uid,email:claims.email,name:typeof claims.name==='string'?claims.name.slice(0,100):claims.email,role:'customer',createdAt:new Date().toISOString()};
   try{await users.insertOne(user);}catch(error){if(error.code===11000) fail(409,'This account already exists. Please try signing in again.');throw error;}
  }
  if(user.disabled) fail(401,'This account is disabled.');
  res.json({user:await issue(req,res,user)});
 }
 async function linkGoogle(req,res) {
  const claims=await googleClaims(req.body?.idToken);
  if(claims.email!==req.user.email) fail(400,'Use the Google account with the same email address.');
  if(req.user.firebaseUid && req.user.firebaseUid!==claims.uid) fail(409,'A different Google account is already connected.');
  try{await users.updateOne({_id:req.user._id},{$set:{firebaseUid:claims.uid}});}catch(error){if(error.code===11000) fail(409,'This Google account is already connected.');throw error;}
  res.json({user:publicUser({...req.user,firebaseUid:claims.uid})});
 }
 async function logout(req,res) {
  if(req.authSessionId) await tokens.deleteOne({_id:req.authSessionId});
  res.clearCookie('temazon_auth',{...cookieOptions,secure});res.clearCookie('temazon_session',{...cookieOptions,secure});res.json({ok:true});
 }
 async function changePassword(req,res) {
  const next=validPassword(req.body?.newPassword);const current=req.body?.currentPassword;
  if(!req.user.passwordHash || typeof current!=='string' || Buffer.byteLength(current)>72 || !await bcrypt.compare(current,req.user.passwordHash)) fail(401,'Current password is incorrect.');
  const passwordHash=await bcrypt.hash(next,12);
  await store.transaction(async session=>{await users.updateOne({_id:req.user._id},{$set:{passwordHash}},{session});await tokens.deleteMany({userId:req.user._id},{session});});
  res.clearCookie('temazon_auth',{...cookieOptions,secure});res.clearCookie('temazon_session',{...cookieOptions,secure});res.json({ok:true});
 }
 return {identify,configured,config,me,register,login,google,linkGoogle,logout,changePassword};
}
module.exports={createAuthController};

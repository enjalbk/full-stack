'use strict';
const {fail}=require('../utils/httpError');
function cookie(req,name) {
 const entry=(req.headers.cookie || '').split(';').map(value=>value.trim()).find(value=>value.startsWith(name+'='));
 if(!entry) return null;
 try{return decodeURIComponent(entry.slice(name.length+1));}catch{return null;}
}
function requireUser(req,res,next) {if(!req.user) fail(401,'Sign in to continue.');next();}
function requireRole(role) {return (req,res,next)=>{if(!req.user) fail(401,'Sign in to continue.');if(req.user.role!==role) fail(403,'Administrator access is required.');next();};}
function rateLimit({limit=20,windowMs=15*60*1000}={}) {
 const buckets=new Map();
 return (req,res,next)=>{
  const now=Date.now();for(const [key,value] of buckets) if(value.until<=now) buckets.delete(key);
  let bucket=buckets.get(req.ip);
  if(!bucket) {if(buckets.size>=10000) fail(503,'Please try again later.');bucket={count:0,until:now+windowMs};buckets.set(req.ip,bucket);}
  if(++bucket.count>limit) {res.set('Retry-After',String(Math.ceil((bucket.until-now)/1000)));fail(429,'Too many attempts. Please try again later.');}
  next();
 };
}
function validateCustomer(body) {
 const customer={};
 for(const [field,max] of Object.entries({name:100,email:200,address:200,city:100,postal:20})) {
  const value=body?.customer?.[field];if(typeof value!=='string' || !value.trim() || value.trim().length>max) fail(400,`Please provide a valid ${field}.`);customer[field]=value.trim();
 }
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) fail(400,'Please provide a valid email.');return customer;
}
module.exports={cookie,requireUser,requireRole,rateLimit,validateCustomer};

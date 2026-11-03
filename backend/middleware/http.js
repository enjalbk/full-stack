'use strict';
const {MulterError}=require('multer');
function securityHeaders(req,res,next) {
  res.set('X-Content-Type-Options','nosniff');
  res.set('Referrer-Policy','same-origin');
  next();
}
function protectApi(req,res,next) {
  res.set('Cache-Control','no-store');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
    if(req.get('X-Temazon-Request')!=='1' || req.get('Sec-Fetch-Site')==='cross-site') return res.status(403).json({error:'Please make this request from the Temazon storefront.'});
    const isImageUpload=req.path==='/admin/images' && req.method==='POST' && req.is('multipart/form-data');
    if(!req.is('application/json') && !isImageUpload) return res.status(415).json({error:'Use application/json.'});
  }
  next();
}
function apiRateLimit() {
  const requests=new Map();
  return (req,res,next)=>{
    const now=Date.now();
    for(const [ip,bucket] of requests) if(bucket.until<=now) requests.delete(ip);
    let bucket=requests.get(req.ip);
    if(!bucket) {
      if(requests.size>=10000) return res.status(503).json({error:'Server is busy. Try again shortly.'});
      bucket={count:0,until:now+60000};requests.set(req.ip,bucket);
    }
    if(++bucket.count>180) {
      res.set('Retry-After',String(Math.ceil((bucket.until-now)/1000)));
      return res.status(429).json({error:'Too many requests. Please wait a moment.'});
    }
    next();
  };
}
function apiNotFound(req,res) {res.status(404).json({error:'API endpoint not found.'});}
function errorHandler(error,req,res,next) {
  if(res.headersSent) return next(error);
  const status=error.code==='LIMIT_FILE_SIZE'?413:error instanceof MulterError?400:error.status || 500;
  if(status>=500) console.error('Backend request failed:',error.name || 'Error');
  const message=status>=500?'Something went wrong. Please try again.':status===413?'Request is too large.':error.type==='entity.parse.failed'?'Invalid JSON body.':error instanceof MulterError?'Upload one PNG, JPEG or WebP image (up to 5 MB).':error.message;
  res.status(status).json({error:message});
}
module.exports={securityHeaders,protectApi,apiRateLimit,apiNotFound,errorHandler};

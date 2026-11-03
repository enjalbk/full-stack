'use strict';
const {Router}=require('express');
const multer=require('multer');
const {fail}=require('../utils/httpError');
const {requireRole,rateLimit}=require('../middleware/security');
function adminRoutes(controller,{cloudinary}) {
  const router=Router();
  router.use(requireRole('admin'));
  router.get('/overview',controller.overview);
  router.get('/products',controller.listProducts);
  router.post('/products',controller.createProduct);
  router.patch('/products/:id',controller.updateProduct);
  router.delete('/products/:id',controller.archiveProduct);
  router.get('/users',controller.listUsers);
  router.get('/orders',controller.listOrders);
  router.patch('/orders/:id',controller.updateOrder);
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:0,parts:1}});
  const configured=(req,res,next)=>{
    if(!cloudinary) fail(503,'Cloudinary is not configured. Add Cloudinary settings to .env.');
    next();
  };
  router.post('/images',rateLimit({limit:20,windowMs:60000}),configured,upload.single('image'),controller.uploadImage);
  return router;
}
module.exports={adminRoutes};

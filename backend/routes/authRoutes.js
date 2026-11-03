'use strict';
const {Router}=require('express');
const {requireUser,rateLimit}=require('../middleware/security');
function authRoutes(controller) {
  const router=Router();
  const attempts=rateLimit();
  router.get('/config',controller.config);
  router.get('/me',controller.me);
  router.post('/register',controller.configured,attempts,controller.register);
  router.post('/login',controller.configured,attempts,controller.login);
  router.post('/google',controller.configured,attempts,controller.google);
  router.post('/google/link',controller.configured,requireUser,attempts,controller.linkGoogle);
  router.post('/logout',controller.logout);
  router.post('/password',controller.configured,requireUser,attempts,controller.changePassword);
  return router;
}
module.exports={authRoutes};

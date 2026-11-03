'use strict';
const {Router}=require('express');
function checkoutRoutes(controller) {
  const router=Router();
  router.use(controller.configured);
  router.post('/sessions',controller.start);
  router.post('/:id/resume',controller.resume);
  router.post('/:id/cancel',controller.cancel);
  router.get('/:id',controller.status);
  return router;
}
module.exports={checkoutRoutes};

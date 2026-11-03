'use strict';
const {Router}=require('express');
function orderRoutes(controller) {
  const router=Router();
  router.get('/',controller.list);
  router.get('/:id',controller.detail);
  router.post('/',controller.rejectDirectCreation);
  return router;
}
module.exports={orderRoutes};

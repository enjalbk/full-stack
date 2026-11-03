'use strict';
const {Router}=require('express');
function cartRoutes(controller) {
  const router=Router();
  router.get('/',controller.show);
  router.post('/items',controller.add);
  router.patch('/items/:id',controller.update);
  router.delete('/items/:id',controller.remove);
  return router;
}
module.exports={cartRoutes};

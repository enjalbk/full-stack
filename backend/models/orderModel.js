'use strict';
function createOrderModel(store) {
  function owner({sessionId,userId}) {
    return userId?{$or:[{userId},{sessionId}]}:{sessionId};
  }
  return {
    listForOwner(identity) {return store.orders.find(owner(identity)).sort({createdAt:-1,_id:-1}).limit(50).toArray();},
    findForOwner(id,identity) {return store.orders.findOne({_id:id,...owner(identity)});}
  };
}
module.exports={createOrderModel};

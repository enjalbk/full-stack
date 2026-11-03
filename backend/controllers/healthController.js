'use strict';
function createHealthController({store,cache,payments,webhookSecret}) {
  return async function health(req,res) {
    await store.health();
    res.json({status:'ok',database:'mongodb',payments:payments&&webhookSecret?'stripe':'not-configured',cache:cache.enabled?'redis':'disabled'});
  };
}
module.exports={createHealthController};

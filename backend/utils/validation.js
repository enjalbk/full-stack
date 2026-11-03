'use strict';
const {fail}=require('../utils/httpError');
function productId(value) {
  if(!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail(400,'Invalid product ID.');
  return Number(value);
}
function quantity(value) {
  if(!Number.isInteger(value) || value<1 || value>99) fail(400,'Quantity must be an integer between 1 and 99.');
  return value;
}
module.exports={productId,quantity};

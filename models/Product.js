const mongoose = require('mongoose');


const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true },
  subCategory: { type: String },
  brand: { type: String },
  vendor: { type: String },
  costPerPiece: { type: Number, default: 0 },
  sellingPerPiece: { type: Number, default: 0 },
  costPerCarton: { type: Number, default: 0 },
  sellingPerCarton: { type: Number, default: 0 },
  cartonQuantity: { type: Number, default: 0 },
  piecesPerCarton: { type: Number, default: 0 },
  losePieces: { type: Number, default: 0 },
  color: { type: String },
  stockQuantity: { type: Number, default: 0 },
  totalPieces: { type: Number, default: 0 },
  perPieceProfit: { type: Number, default: 0 },
  totalUnitProfit: { type: Number, default: 0 },
  totalUnitCost: { type: Number, default: 0 },
  SKU: { type: String, unique: true, required: true },
  dateAdded: { type: Date, default: Date.now },
  image: { type: String },
  warrantyMonths: { type: Number, default: 12 },
  warrantyClaimedPieces: { type: Number, default: 0 },
  warehouseAddress: { type: String },
});

module.exports = mongoose.model('Product', productSchema);

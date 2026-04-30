const mongoose = require('mongoose');

const saleItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: String,
  SKU: String,
  quantity: { type: Number, required: true },
  perPiecePrice: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  subtotal: { type: Number, required: true }
}, { _id: false });

const saleSchema = new mongoose.Schema({
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sellerName: String, // for ease of reporting/display
  cashierName: String,
  items: [saleItemSchema],
  totalQuantity: { type: Number, required: true },
  totalAmount: { type: Number, required: true },
  discountTotal: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },
  netAmount: { type: Number, required: true },
  paymentStatus: { type: String, enum: ['Unpaid', 'Partial', 'Partial Paid', 'Paid', 'Credit'], default: 'Unpaid' },
  paymentMethod: { type: String, enum: ['Cash', 'Jazzcash', 'Bank transfer', 'Easypaisa', 'Cheque'], default: 'Cash' },
  paymentProofUrl: { type: String },
  cashAmount: { type: Number, default: 0 },
  changeAmount: { type: Number, default: 0 },
  paidAmount: { type: Number, default: 0 },
  invoiceNumber: { type: String },
  customerName: { type: String },
  customerContact: { type: String },
  customerEmail: { type: String }, // new

  dueDate: { type: Date },

  createdAt: { type: Date, default: Date.now },

  // Email send tracking
  emailStatus: { type: String, enum: ['pending','sent','failed'], default: 'pending' },
  emailError: { type: String, default: '' },
  emailMessageId: { type: String, default: '' }
  ,
  edited: { type: Boolean, default: false }
  ,
  refunds: [{
    items: [{
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      productName: String,
      SKU: String,
      quantity: { type: Number, default: 0 },
      perPiecePrice: { type: Number, default: 0 }
    }],
    totalRefundQty: { type: Number, default: 0 },
    totalRefundAmount: { type: Number, default: 0 },
    refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    refundedByName: String,
    refundedByRole: String,
    reason: String,
    createdAt: { type: Date, default: Date.now }
  }],
  warrantyClaims: [{
    items: [{
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      productName: String,
      SKU: String,
      quantity: { type: Number, default: 0 }
    }],
    totalWarrantyQty: { type: Number, default: 0 },
    claimedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    claimedByName: String,
    claimedByRole: String,
    reason: String,
    createdAt: { type: Date, default: Date.now }
  }]
});

module.exports = mongoose.model('Sale', saleSchema);

const mongoose = require('mongoose');

const purchaseOrderSchema = new mongoose.Schema({
  poNumber: { type: String, required: true, unique: true },
  poDate: { type: Date, default: Date.now },
  expectedDeliveryDate: { type: Date },
  orderStatus: { type: String, enum: ['Pending', 'Approved', 'Received', 'Partially Received', 'Cancelled'], default: 'Pending' },
  paymentStatus: { type: String, enum: ['Unpaid', 'Partially Paid', 'Paid'], default: 'Unpaid' },
  reference: { type: String },

  vendorName: { type: String, required: true },
  vendorId: { type: String, required: true },
  contactPerson: { type: String },
  vendorAddress: { type: String },
  vendorPhone: { type: String },
  vendorEmail: { type: String },
  
  // Ship To Information
  shipToName: { type: String, required: true },
  shipToPhone: { type: String, required: true },
  shipToEmail: { type: String, required: true },
  shipToAddress: { type: String, required: true },

  items: [{
    itemCode: String,
    itemName: String,
    description: String,
    quantityOrdered: Number,
    uom: String,
    perPiecePrice: Number,
    unitPrice: Number,
    tax: Number,
    discount: Number,
    totalLineAmount: Number,
    cartonQuantity: { type: Number, default: 0 },
    piecesPerCarton: { type: Number, default: 0 },
    losePieces: { type: Number, default: 0 },
    itemSource: { type: String, default: 'AdminProductList' }
  }],

  subtotal: { type: Number, default: 0 },
  taxTotal: { type: Number, default: 0 },
  discountTotal: { type: Number, default: 0 },
  shippingCharges: { type: Number, default: 0 },
  grandTotal: { type: Number, default: 0 },

  paymentTerms: { type: String, enum: ['Net 30', 'Net 60', 'COD', 'Advance Payment', 'Partial Payment', 'Cash Payment'] },
  paymentMethod: { type: String, enum: ['Bank Transfer', 'Cheque', 'Cash Payment'], required: true },
  deliveryMethod: { type: String, enum: ['Courier', 'In-house transport'] },
  deliveryLocation: { type: String },

  // Optional specific receipt URLs
  bankReceipt: { type: String },
  chequeReceipt: { type: String },

  createdBy: { type: String },
  approvedBy: { type: String },
  attachments: { type: [String], default: [] },
  purchaseType: { type: String, enum: ['Local', 'International'], default: 'Local' },
  currency: { type: String, enum: ['PKR', 'DOLLAR', 'YAN'], default: 'PKR' },
  advanceAmount: { type: Number, default: 0 },
  creditAmount: { type: Number, default: 0 },
  initialPayment: { type: Number, default: 0 },
  initialPaymentDateTime: { type: Date },
  finalPayment: { type: Number, default: 0 },
  finalPaymentDateTime: { type: Date },
  advancePaymentDateTime: { type: Date },
  advanceApprovedBy: { type: String },
  cashPaid: { type: Number, default: 0 }
  ,
  cashPaymentDateTime: { type: Date }
});

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);

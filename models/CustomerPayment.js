const mongoose = require('mongoose');

const customerPaymentSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  amount: { type: Number, required: true },
  paymentDate: { type: Date, default: Date.now },
  paymentMethod: { type: String, enum: ['Cash', 'Bank Transfer', 'Jazzcash', 'Easypaisa', 'Cheque'], required: true },
  referenceId: { type: String }, // Can be a Sale Invoice ID or external ref
  note: { type: String },
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('CustomerPayment', customerPaymentSchema);

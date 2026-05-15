const mongoose = require('mongoose');

const customerLedgerSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  transactionDate: { type: Date, default: Date.now },
  transactionType: { type: String, enum: ['Sale', 'Payment', 'Refund', 'Opening Balance', 'Adjustment'], required: true },
  referenceId: { type: mongoose.Schema.Types.ObjectId, required: true }, // ID of Sale, Payment, etc.
  referenceModel: { type: String, required: true, enum: ['Sale', 'CustomerPayment'] },
  description: { type: String },
  debit: { type: Number, default: 0 },  // Increases customer balance (e.g. Sales)
  credit: { type: Number, default: 0 }, // Decreases customer balance (e.g. Payments)
  runningBalance: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('CustomerLedger', customerLedgerSchema);

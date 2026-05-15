const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  code: { type: String, required: true, unique: true },
  category: { 
    type: String, 
    enum: ['Assets', 'Liabilities', 'Income', 'Expenses', 'Equity'], 
    required: true 
  },
  type: { type: String }, // e.g., 'Cash', 'Bank', 'Accounts Receivable', etc.
  balance: { type: Number, default: 0 },
  isSystemAccount: { type: Boolean, default: false }, // Prevent deletion of default accounts
  description: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Account', accountSchema);

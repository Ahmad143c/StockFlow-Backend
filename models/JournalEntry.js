const mongoose = require('mongoose');

const journalEntrySchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  description: { type: String, required: true },
  referenceType: { type: String }, // e.g., 'Sale', 'Purchase', 'Payment', 'Expense'
  referenceId: { type: mongoose.Schema.Types.ObjectId },
  entries: [{
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    accountName: { type: String }, // redundant for quick access
    debit: { type: Number, default: 0 },
    credit: { type: Number, default: 0 }
  }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('JournalEntry', journalEntrySchema);

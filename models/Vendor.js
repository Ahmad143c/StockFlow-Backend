const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema({
  vendorName: { type: String, required: true },
  email: { type: String },
  phone: { type: String },
  companyName: { type: String },
  address: {
    street: { type: String },
    city: { type: String },
    state: { type: String },
    country: { type: String },
    postalCode: { type: String }
  },
  website: { type: String },
  taxNumber: { type: String },
  paymentTerms: { type: String },
  preferredCurrency: { type: String },
  notes: { type: String },
  status: { type: String, default: 'Active' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Vendor', vendorSchema);
const Customer = require('../models/Customer');
const CustomerPayment = require('../models/CustomerPayment');
const CustomerLedger = require('../models/CustomerLedger');
const Sale = require('../models/Sale');
const JournalEntry = require('../models/JournalEntry');
const GeneralLedger = require('../models/GeneralLedger');
const AccountingService = require('../services/accountingService');
const mongoose = require('mongoose');

// Helper to update ledger and customer balance
const updateCustomerLedger = async (customerId, amount, type, referenceId, referenceModel, description, session = null) => {
  const customer = await Customer.findById(customerId).session(session);
  if (!customer) throw new Error('Customer not found');

  let debit = 0;
  let credit = 0;

  if (type === 'Sale') {
    debit = amount;
    customer.currentBalance += amount;
    customer.totalPurchases += amount;
  } else if (type === 'Payment') {
    credit = amount;
    customer.currentBalance -= amount;
    customer.totalPaid += amount;
  } else if (type === 'Refund') {
    credit = amount;
    customer.currentBalance -= amount;
    customer.totalPurchases -= amount;
  } else if (type === 'Adjustment') {
    // Logic for manual adjustment
    if (amount > 0) {
        debit = amount;
        customer.currentBalance += amount;
    } else {
        credit = Math.abs(amount);
        customer.currentBalance -= credit;
    }
  }

  const ledgerEntry = new CustomerLedger({
    customerId,
    transactionType: type,
    referenceId,
    referenceModel,
    description,
    debit,
    credit,
    runningBalance: customer.currentBalance
  });

  await ledgerEntry.save({ session });
  await customer.save({ session });
  return ledgerEntry;
};

exports.createCustomer = async (req, res) => {
  try {
    const customer = new Customer(req.body);
    await customer.save();
    res.status(201).json(customer);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.getAllCustomers = async (req, res) => {
  try {
    const customers = await Customer.find().sort({ name: 1 });
    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getCustomerById = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    res.json(customer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.addPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { customerId, amount, paymentMethod, note, referenceId } = req.body;

    const payment = new CustomerPayment({
      customerId,
      amount,
      paymentMethod,
      note,
      referenceId,
      receivedBy: req.user._id
    });

    await payment.save({ session });

    // GENERAL LEDGER INTEGRATION
    await AccountingService.recordCustomerPayment(payment, session);

    await updateCustomerLedger(
      customerId,
      amount,
      'Payment',
      payment._id,
      'CustomerPayment',
      note || `Payment received via ${paymentMethod}`,
      session
    );

    await session.commitTransaction();
    session.endSession();
    res.status(201).json(payment);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(400).json({ message: error.message });
  }
};

exports.getCustomerLedger = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { startDate, endDate } = req.query;

    // Handle non-ObjectId strings (e.g. customers derived from names)
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.json([]); // Return empty ledger for non-registered customers
    }

    let query = { customerId };
    if (startDate || endDate) {
      query.transactionDate = {};
      if (startDate) query.transactionDate.$gte = new Date(startDate);
      if (endDate) query.transactionDate.$lte = new Date(endDate);
    }

    const ledger = await CustomerLedger.find(query).sort({ transactionDate: 1, createdAt: 1 });
    res.json(ledger);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getOutstandingBalances = async (req, res) => {
  try {
    const customers = await Customer.find({ currentBalance: { $gt: 0 } }).sort({ currentBalance: -1 });
    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteCustomerByDetails = async (req, res) => {
  try {
    const { name, contact } = req.query;
    if (!name) {
      return res.status(400).json({ message: 'Customer name is required' });
    }

    // 1. Find Customer document if exists
    let customer = null;
    if (contact) {
      customer = await Customer.findOne({ name, contact });
    } else {
      customer = await Customer.findOne({ name });
    }

    const customerQuery = [];
    if (customer) {
      customerQuery.push({ customerId: customer._id });
    }
    if (name) {
      if (contact) {
        customerQuery.push({ customerName: name, customerContact: contact });
      } else {
        customerQuery.push({ customerName: name });
      }
    }

    // 2. Find all sales (invoices) related to this customer
    const sales = await Sale.find({ $or: customerQuery });
    const saleIds = sales.map(s => s._id);

    // 3. Find all payments related to this customer
    let paymentIds = [];
    if (customer) {
      const payments = await CustomerPayment.find({ customerId: customer._id });
      paymentIds = payments.map(p => p._id);
    }

    // 4. Delete JournalEntries and GeneralLedger entries referencing these sales/payments
    const refIds = [...saleIds];
    if (paymentIds.length > 0) {
      refIds.push(...paymentIds);
    }

    if (refIds.length > 0) {
      const journalEntries = await JournalEntry.find({ referenceId: { $in: refIds } });
      const journalEntryIds = journalEntries.map(j => j._id);
      
      if (journalEntryIds.length > 0) {
        await GeneralLedger.deleteMany({ journalEntryId: { $in: journalEntryIds } });
        await JournalEntry.deleteMany({ _id: { $in: journalEntryIds } });
      }
    }

    // 5. Delete CustomerLedger and CustomerPayment
    if (customer) {
      await CustomerLedger.deleteMany({ customerId: customer._id });
      await CustomerPayment.deleteMany({ customerId: customer._id });
      await Customer.findByIdAndDelete(customer._id);
    }

    // 6. Delete the Sales (Invoices) themselves
    if (saleIds.length > 0) {
      await Sale.deleteMany({ _id: { $in: saleIds } });
    }

    res.json({ message: 'Customer and all related sales, payments, and ledger data deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Export the helper for use in Sale Controller
exports.updateCustomerLedger = updateCustomerLedger;

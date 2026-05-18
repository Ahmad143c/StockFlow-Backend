const Customer = require('../models/Customer');
const CustomerPayment = require('../models/CustomerPayment');
const CustomerLedger = require('../models/CustomerLedger');
const Sale = require('../models/Sale');
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
    const customer = await Customer.findById(customerId).session(session);
    if (!customer) throw new Error('Customer not found');

    const payment = new CustomerPayment({
      customerId,
      amount,
      paymentMethod,
      note,
      referenceId,
      receivedBy: req.user._id
    });

    await payment.save({ session });

     // Update individual sales invoices (FIFO)
    let amountLeft = Number(amount);
    
    // Dynamically build a case-insensitive and robust search query
    const matchCriteria = [{ customerId: customer._id }];
    
    if (customer.name) {
      matchCriteria.push({
        customerName: { $regex: new RegExp('^' + customer.name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i') }
      });
    }
    
    if (customer.contact) {
      matchCriteria.push({ customerContact: customer.contact });
    }

    const sales = await Sale.find({
      $or: matchCriteria,
      paymentStatus: { $in: ['Unpaid', 'Partial', 'Partial Paid', 'Credit'] }
    }).sort({ createdAt: 1 }).session(session);

    for (const sale of sales) {
      if (amountLeft <= 0) break;
      
      const net = Number(sale.netAmount || sale.totalAmount || 0);
      const paid = Number(sale.paidAmount || sale.cashAmount || 0);
      const due = Math.max(0, net - paid);
      
      if (due <= 0) continue;
      
      const toPay = Math.min(amountLeft, due);
      
      sale.paidAmount = paid + toPay;
      sale.dueAmount = Math.max(0, due - toPay);
      
      if (sale.dueAmount === 0) {
        sale.paymentStatus = 'Paid';
      } else {
        sale.paymentStatus = 'Partial Paid';
      }
      
      if (!sale.paymentParts) sale.paymentParts = [];
      sale.paymentParts.push({
        amount: toPay,
        date: new Date()
      });
      
      // Auto-repair reference link in database if it was blank/missing
      if (!sale.customerId) {
        sale.customerId = customer._id;
      }
      
      amountLeft -= toPay;
      await sale.save({ session });
    }

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

// Export the helper for use in Sale Controller
exports.updateCustomerLedger = updateCustomerLedger;

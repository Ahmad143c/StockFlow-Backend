const Account = require('../models/Account');
const JournalEntry = require('../models/JournalEntry');
const GeneralLedger = require('../models/GeneralLedger');
const mongoose = require('mongoose');

class AccountingService {
    static async seedDefaultAccounts() {
        const defaultAccounts = [
            { name: 'Cash', code: '1001', category: 'Assets', type: 'Cash', isSystemAccount: true },
            { name: 'Bank', code: '1002', category: 'Assets', type: 'Bank', isSystemAccount: true },
            { name: 'Accounts Receivable', code: '1003', category: 'Assets', type: 'Accounts Receivable', isSystemAccount: true },
            { name: 'Inventory', code: '1004', category: 'Assets', type: 'Inventory', isSystemAccount: true },
            { name: 'Accounts Payable', code: '2001', category: 'Liabilities', type: 'Accounts Payable', isSystemAccount: true },
            { name: 'Sales Revenue', code: '4001', category: 'Income', type: 'Sales', isSystemAccount: true },
            { name: 'Cost of Goods Sold', code: '5001', category: 'Expenses', type: 'COGS', isSystemAccount: true },
            { name: 'Operating Expenses', code: '5002', category: 'Expenses', type: 'Expense', isSystemAccount: true }
        ];

        for (const acc of defaultAccounts) {
            await Account.findOneAndUpdate({ code: acc.code }, acc, { upsert: true, new: true });
        }
    }

    static async getAccountByCode(code) {
        return await Account.findOne({ code });
    }

    static async createJournalEntry(data, session = null) {
        const { date, description, referenceType, referenceId, entries, userId } = data;

        // 1. Validate balanced entry
        const totalDebit = entries.reduce((sum, e) => sum + (e.debit || 0), 0);
        const totalCredit = entries.reduce((sum, e) => sum + (e.credit || 0), 0);

        if (Math.abs(totalDebit - totalCredit) > 0.01) {
            throw new Error(`Unbalanced Journal Entry: Debit (${totalDebit}) != Credit (${totalCredit})`);
        }

        // 2. Create Journal Entry
        const journalEntry = new JournalEntry({
            date: date || new Date(),
            description,
            referenceType,
            referenceId,
            entries,
            createdBy: userId
        });
        await journalEntry.save({ session });

        // 3. Post to General Ledger and update Account balances
        for (const entry of entries) {
            const account = await Account.findById(entry.accountId).session(session);
            if (!account) throw new Error(`Account not found: ${entry.accountId}`);

            // Update running balance based on category
            // Assets & Expenses: Increase on Debit, Decrease on Credit
            // Liabilities, Equity, Income: Increase on Credit, Decrease on Debit
            const increaseOnDebit = ['Assets', 'Expenses'].includes(account.category);
            
            if (increaseOnDebit) {
                account.balance += (entry.debit || 0);
                account.balance -= (entry.credit || 0);
            } else {
                account.balance += (entry.credit || 0);
                account.balance -= (entry.debit || 0);
            }

            const glEntry = new GeneralLedger({
                accountId: account._id,
                journalEntryId: journalEntry._id,
                transactionDate: journalEntry.date,
                description: journalEntry.description,
                debit: entry.debit || 0,
                credit: entry.credit || 0,
                runningBalance: account.balance
            });

            await glEntry.save({ session });
            await account.save({ session });
        }

        return journalEntry;
    }

    // High-level integration methods
    static async recordSale(sale, session = null) {
        const arAcc = await Account.findOne({ type: 'Accounts Receivable' });
        const salesAcc = await Account.findOne({ type: 'Sales' });

        if (!arAcc || !salesAcc) throw new Error('Accounting configuration missing (AR or Sales account)');

        await this.createJournalEntry({
            description: `Sale Invoice #${String(sale._id).slice(-6)}`,
            referenceType: 'Sale',
            referenceId: sale._id,
            userId: sale.sellerId,
            entries: [
                { accountId: arAcc._id, debit: sale.netAmount },
                { accountId: salesAcc._id, credit: sale.netAmount }
            ]
        }, session);
    }

    static async recordCustomerPayment(payment, session = null) {
        const cashBankAcc = await Account.findOne({ type: payment.paymentMethod === 'Cash' ? 'Cash' : 'Bank' });
        const arAcc = await Account.findOne({ type: 'Accounts Receivable' });

        if (!cashBankAcc || !arAcc) throw new Error('Accounting configuration missing (Cash/Bank or AR account)');

        await this.createJournalEntry({
            description: `Payment received - ${payment.note || 'No note'}`,
            referenceType: 'CustomerPayment',
            referenceId: payment._id,
            userId: payment.receivedBy,
            entries: [
                { accountId: cashBankAcc._id, debit: payment.amount },
                { accountId: arAcc._id, credit: payment.amount }
            ]
        }, session);
    }

    static async recordPurchase(purchase, userId, session = null) {
        const inventoryAcc = await Account.findOne({ type: 'Inventory' });
        const apAcc = await Account.findOne({ type: 'Accounts Payable' });

        if (!inventoryAcc || !apAcc) throw new Error('Accounting configuration missing (Inventory or AP account)');

        await this.createJournalEntry({
            description: `Purchase Order #${purchase.poNumber}`,
            referenceType: 'PurchaseOrder',
            referenceId: purchase._id,
            userId: userId,
            entries: [
                { accountId: inventoryAcc._id, debit: purchase.grandTotal },
                { accountId: apAcc._id, credit: purchase.grandTotal }
            ]
        }, session);
    }

    static async recordSupplierPayment(purchase, amount, paymentMethod, userId, session = null) {
        const apAcc = await Account.findOne({ type: 'Accounts Payable' });
        const cashBankAcc = await Account.findOne({ type: paymentMethod === 'Cash' ? 'Cash' : 'Bank' });

        if (!apAcc || !cashBankAcc) throw new Error('Accounting configuration missing (AP or Cash/Bank account)');

        await this.createJournalEntry({
            description: `Payment to Supplier for PO #${purchase.poNumber}`,
            referenceType: 'PurchaseOrder',
            referenceId: purchase._id,
            userId: userId,
            entries: [
                { accountId: apAcc._id, debit: amount },
                { accountId: cashBankAcc._id, credit: amount }
            ]
        }, session);
    }
}

module.exports = AccountingService;

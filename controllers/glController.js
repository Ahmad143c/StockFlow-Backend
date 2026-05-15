const Account = require('../models/Account');
const JournalEntry = require('../models/JournalEntry');
const GeneralLedger = require('../models/GeneralLedger');

exports.getTrialBalance = async (req, res) => {
    try {
        const accounts = await Account.find().sort({ code: 1 });
        res.json(accounts);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getLedgerByAccount = async (req, res) => {
    try {
        const { accountId } = req.params;
        const { startDate, endDate } = req.query;

        let query = { accountId };
        if (startDate || endDate) {
            query.transactionDate = {};
            if (startDate) query.transactionDate.$gte = new Date(startDate);
            if (endDate) query.transactionDate.$lte = new Date(endDate);
        }

        const ledger = await GeneralLedger.find(query).sort({ transactionDate: 1, createdAt: 1 });
        res.json(ledger);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getProfitAndLoss = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let dateQuery = {};
        if (startDate || endDate) {
            dateQuery = { transactionDate: {} };
            if (startDate) dateQuery.transactionDate.$gte = new Date(startDate);
            if (endDate) dateQuery.transactionDate.$lte = new Date(endDate);
        }

        // 1. Get Income
        const incomeAccounts = await Account.find({ category: 'Income' });
        const incomeDetails = [];
        let totalIncome = 0;

        for (const acc of incomeAccounts) {
            const glEntries = await GeneralLedger.find({ accountId: acc._id, ...dateQuery });
            const balance = glEntries.reduce((sum, entry) => sum + (entry.credit - entry.debit), 0);
            incomeDetails.push({ name: acc.name, balance });
            totalIncome += balance;
        }

        // 2. Get Expenses
        const expenseAccounts = await Account.find({ category: 'Expenses' });
        const expenseDetails = [];
        let totalExpenses = 0;

        for (const acc of expenseAccounts) {
            const glEntries = await GeneralLedger.find({ accountId: acc._id, ...dateQuery });
            const balance = glEntries.reduce((sum, entry) => sum + (entry.debit - entry.credit), 0);
            expenseDetails.push({ name: acc.name, balance });
            totalExpenses += balance;
        }

        res.json({
            income: incomeDetails,
            totalIncome,
            expenses: expenseDetails,
            totalExpenses,
            netProfit: totalIncome - totalExpenses
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getBalanceSheet = async (req, res) => {
    try {
        // Balance sheet is a snapshot at a point in time (usually 'as of' today)
        const accounts = await Account.find();
        
        const assets = accounts.filter(a => a.category === 'Assets');
        const liabilities = accounts.filter(a => a.category === 'Liabilities');
        const equity = accounts.filter(a => a.category === 'Equity');

        const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0);
        const totalLiabilities = liabilities.reduce((sum, a) => sum + a.balance, 0);
        
        // Simplified Equity: Current Profit + Existing Equity
        // In a real system, we would have a 'Retained Earnings' account
        const pnl = await this.getProfitAndLossInternal();
        const currentProfit = pnl.netProfit;
        const totalEquity = equity.reduce((sum, a) => sum + a.balance, 0) + currentProfit;

        res.json({
            assets,
            totalAssets,
            liabilities,
            totalLiabilities,
            equity: [
                ...equity,
                { name: 'Current Period Profit/Loss', balance: currentProfit }
            ],
            totalEquity,
            isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getProfitAndLossInternal = async () => {
    const incomeAccounts = await Account.find({ category: 'Income' });
    let totalIncome = 0;
    for (const acc of incomeAccounts) {
        totalIncome += acc.balance;
    }

    const expenseAccounts = await Account.find({ category: 'Expenses' });
    let totalExpenses = 0;
    for (const acc of expenseAccounts) {
        totalExpenses += acc.balance;
    }

    return { netProfit: totalIncome - totalExpenses };
};

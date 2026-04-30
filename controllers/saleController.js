const Sale = require('../models/Sale');
const Product = require('../models/Product');
const User = require('../models/User');
const { google } = require('googleapis');

// Helper: send email invoice via Gmail API (HTTPS-based, works on Railway, no domain needed)
async function sendInvoiceEmail(to, subject, htmlBody) {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_USER } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    return { success: false, error: 'Gmail API credentials missing. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN in .env.' };
  }

  const fromEmail = GMAIL_USER || process.env.EMAIL_FROM || 'me';

  try {
    const oauth2Client = new google.auth.OAuth2(
      GMAIL_CLIENT_ID,
      GMAIL_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Build RFC 2822 email message
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
      `From: ${fromEmail}`,
      `To: ${to}`,
      `Subject: ${utf8Subject}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      htmlBody
    ];
    const message = messageParts.join('\n');
    const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage }
    });

    return { success: true, result: result.data };
  } catch (err) {
    const msg = err?.message || String(err);
    console.error('Email send error:', msg);
    return { success: false, error: msg };
  }
}

// Helper: generate invoice HTML (adapted from frontend invoiceUtils.js)
function generateInvoiceHTML(sale, products = []) {
  if (!sale || !sale.items) {
    return `<html><body><h1>Invoice</h1><p>Invalid sale data</p></body></html>`;
  }
  
  const itemsHaveDiscount = (sale.items || []).some(i => Number(i.discount) > 0);
  // build refund maps keyed by productId/SKU to total refunded qty and amount
  const refundQtyMap = new Map();
  const refundAmtMap = new Map();
  try {
    (sale.refunds || []).forEach(r => {
      (r.items || []).forEach(it => {
        const key = String(it.productId || it.SKU || it._id || '');
        const qty = Number(it.quantity) || 0;
        const price = Number(it.perPiecePrice || 0);
        refundQtyMap.set(key, (refundQtyMap.get(key) || 0) + qty);
        refundAmtMap.set(key, (refundAmtMap.get(key) || 0) + qty * price);
      });
    });
  } catch (err) {
    console.error('Error processing refunds:', err);
    // Continue without refund info
  }

  // net amount should come from sale if available
  let netAmount = Number(sale.netAmount) || 0;

  // Subtract global discount if present
  if (sale.discountAmount && Number(sale.discountAmount) > 0) {
    netAmount -= Number(sale.discountAmount);
  }

  // Calculate total selling amount without any discounts
  const totalWithoutDiscount = (sale.items || []).reduce((s, i) => {
    const key = String(i.productId || i.SKU || i._id || '');
    const origQty = Number(i.quantity) || 0;
    const refundedQty = Number(refundQtyMap.get(key) || 0);
    const usedQty = Math.max(0, origQty - refundedQty);
    return s + ((Number(i.perPiecePrice) || 0) * usedQty);
  }, 0);

  // check if sale has any refunds at all
  const hasRefunds = (sale.refunds || []).length > 0;

  // helper to compute warranty string for an item
  const warrantyForItem = (i) => {
    let warrantyString = 'No warranty';
    const prod = products.find(p => String(p._id) === String(i.productId || i._id));
    const months = prod ? Number(prod.warrantyMonths || 0) : 0;
    if (months > 0) {
      const saleDate = new Date(sale.createdAt || sale.date || Date.now());
      const warrantyUntil = new Date(saleDate);
      warrantyUntil.setMonth(warrantyUntil.getMonth() + months);
      const now = new Date();
      if (now <= warrantyUntil) {
        warrantyString = warrantyUntil.toISOString().split('T')[0];
      } else {
        warrantyString = 'Expired';
      }
    }
    return warrantyString;
  };

  // Generate payment info HTML
  const paidVal = sale.paymentMethod === 'Cash'
    ? (sale.cashAmount || sale.paidAmount || 0)
    : (sale.paidAmount || 0);
  const changeVal = sale.changeAmount || 0;
  const discountVal = sale.discountAmount || 0;
  const grossTotal = netAmount + discountVal;
  const totalRefundAmount = (sale.refunds || []).reduce((s, r) => s + (Number(r.totalRefundAmount) || 0), 0);
  let extra = '';
  if (sale.paymentStatus === 'Partial Paid') {
    const remaining = Math.max(0, netAmount - (sale.paidAmount || 0));
    extra = `<div><span>Remaining</span> <span>Rs. ${remaining.toLocaleString()}</span></div>`;
  } else if (sale.paymentStatus === 'Credit') {
    extra = `<div><span>Due Date</span> <span>${sale.dueDate ? new Date(sale.dueDate).toISOString().split('T')[0] : '-'}</span></div>`;
  }
  const paymentInfoHtml = `
    ${discountVal > 0 ? `<div><span>Discount Amount</span> <span>Rs. ${Number(discountVal).toLocaleString()}</span></div>` : ''}
    <div><span>Total Amount</span> <span>Rs. ${Number(grossTotal).toLocaleString()}</span></div>
    <div><span>Paid Amount</span> <span>Rs. ${Number(paidVal).toLocaleString()}</span></div>
    ${totalRefundAmount > 0 ? `<div><span>Refunded</span> <span>Rs. ${totalRefundAmount.toLocaleString()}</span></div>` : ''}
    <div><span>Change</span> <span>Rs. ${Number(changeVal).toLocaleString()}</span></div>
    ${extra}
  `;

  return `
      <html>
        <head>
          <title>Invoice #${(sale._id || '').toString().slice(-6)}</title>
          <style>
            html, body { width: 100%; margin: 0; padding: 0; }
            body { font-family: 'Courier New', monospace; margin: 0 auto; padding: 15px; width: 80mm; color: #333; }
            html { display: flex; justify-content: center; }
            .header { text-align: center; margin-bottom: 15px; border-bottom: 2px solid #000; padding-bottom: 10px; }
            .header h1 { margin: 0 0 5px 0; font-size: 16px; font-weight: bold; }
            .header p { margin: 2px 0; font-size: 11px; }
            .invoice-info { margin: 12px 0; font-size: 11px; }
            .invoice-info div { margin: 3px 0; }
            .invoice-info strong { font-weight: bold; }
            table { width: 100%; border-collapse: collapse; margin: 12px 0; }
            th { background: #f5f5f5; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 6px 4px; text-align: left; font-weight: bold; font-size: 10px; }
            td { padding: 5px 4px; border-bottom: 1px solid #eee; font-size: 10px; }
            tr:last-child td { border-bottom: 1px solid #000; }
            .text-right { text-align: right !important; }
            .total-row { border-top: 2px solid #000; border-bottom: 2px solid #000; font-weight: bold; background: #f9f9f9; }
            .total-amount { font-weight: bold; font-size: 11px; }
            .payment-info { margin-top: 8px; }
            .payment-info div { margin: 2px 0; font-size: 10px; display: flex; justify-content: space-between; }
            .footer { text-align: center; margin-top: 15px; font-size: 11px; font-weight: bold; }
            @media print { body { margin: 0 auto; padding: 10px; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>New Adil Electric Concern</h1>
            <p>4-B, Jamiat Center, Shah Alam Market</p>
            <p>Lahore, Pakistan</p>
            <p>Phone: 0333-4263733 | Email: info@adilelectric.com</p>
            <p>Website: e-roshni.com</p>
          </div>

          <div class="invoice-info">
            <div><strong>Invoice #</strong>${(sale._id || '').toString().slice(-6)}</div>
            <div><strong>Date:</strong> ${new Date(sale.createdAt || sale.date).toISOString().split('T')[0]} <strong>Time:</strong> ${new Date(sale.createdAt || sale.date).toTimeString().split(' ')[0]}</div>
            <div><strong>Customer:</strong> ${sale.customerName || '-'} | <strong>Contact:</strong> ${sale.customerContact || '-'}</div>
            <div><strong>Payment:</strong> ${sale.paymentMethod || '-'} | <strong>Status:</strong> ${sale.paymentStatus || '-'}${sale.paymentStatus === 'Credit' && sale.dueDate ? ` | <strong>Due:</strong> ${new Date(sale.dueDate).toISOString().split('T')[0]}` : ''}</div>
          </div>

          <table>
            <thead>
              <tr>
                <th>S/N</th>
                <th>Item</th>
                <th class="text-right">Qty</th>
                <th class="text-right">Rate</th>
                ${hasRefunds ? '<th class="text-right">Refund</th>' : ''}
                <th class="text-right">Warranty</th>
                ${itemsHaveDiscount ? '<th class="text-right">Disc.</th>' : ''}
                <th class="text-right">SubTotal</th>
              </tr>
            </thead>
            <tbody>
              ${(sale.items || []).map((i, idx) => {
                const warrantyString = warrantyForItem(i);
                const key = String(i.productId || i.SKU || i._id || '');
                const origQty = Number(i.quantity) || 0;
                const refundedQty = Number(refundQtyMap.get(key) || 0);
                const refundAmt = Number(refundAmtMap.get(key) || 0);
                const remainingQty = Math.max(0, origQty - refundedQty);
                const itemSubtotal = ((Number(i.perPiecePrice) || 0) * remainingQty) - (Number(i.discount) || 0);
                return `
                <tr>
                  <td>${idx + 1}</td>
                  <td>${i.productName || 'Item'}</td>
                  <td class="text-right">${origQty}${refundedQty ? ` (-${refundedQty} ref)` : ''}</td>
                  <td class="text-right">${Number(i.perPiecePrice || 0).toLocaleString()}</td>
                  ${hasRefunds ? `<td class="text-right">${refundAmt ? 'Rs. ' + refundAmt.toLocaleString() : ''}</td>` : ''}
                  <td class="text-right">${warrantyString}</td>
                  ${itemsHaveDiscount ? `<td class="text-right">${i.discount || 0}</td>` : ''}
                  <td class="text-right">${Number(itemSubtotal).toLocaleString()}</td>
                </tr>
              `;
              }).join('')}
              
              
              <tr class="total-row">
                <td colspan="${5 + (hasRefunds ? 1 : 0) + (itemsHaveDiscount ? 1 : 0)}"></td>
                <td class="text-right total-amount">Rs.${Number(totalWithoutDiscount).toLocaleString()}</td>
              </tr>
            </tbody>
          </table>

          <div class="payment-info">
            ${paymentInfoHtml}
          </div>

          <div class="footer">Thank you for your business!</div>
        </body>
      </html>
    `;
}

// Helper: generate refund invoice HTML (matching regular invoice design)
function generateRefundInvoiceHTML(sale, refundRecord) {
  if (!sale || !refundRecord || !refundRecord.items) {
    return `<html><body><h1>Refund Invoice</h1><p>Invalid refund data</p></body></html>`;
  }

  const totalRefundAmount = Number(refundRecord.totalRefundAmount) || 0;
  const originalTotal = (sale.items || []).reduce((total, item) => {
    return total + (item.perPiecePrice * item.quantity - (item.discount || 0));
  }, 0);

  return `
      <html>
        <head>
          <title>Refund Invoice #${sale._id?.toString?.()?.slice(-6) || ''}</title>
          <style>
            html, body { width: 100%; margin: 0; padding: 0; }
            body { font-family: 'Courier New', monospace; margin: 0 auto; padding: 15px; width: 80mm; color: #333; }
            html { display: flex; justify-content: center; }
            .header { text-align: center; margin-bottom: 15px; border-bottom: 2px solid #000; padding-bottom: 10px; }
            .header h1 { margin: 0 0 5px 0; font-size: 16px; font-weight: bold; }
            .header p { margin: 2px 0; font-size: 11px; }
            .invoice-info { margin: 12px 0; font-size: 11px; }
            .invoice-info div { margin: 3px 0; }
            .invoice-info strong { font-weight: bold; }
            table { width: 100%; border-collapse: collapse; margin: 12px 0; }
            th { background: #f5f5f5; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 6px 4px; text-align: left; font-weight: bold; font-size: 10px; }
            td { padding: 5px 4px; border-bottom: 1px solid #eee; font-size: 10px; }
            tr:last-child td { border-bottom: 1px solid #000; }
            .text-right { text-align: right !important; }
            .total-row { border-top: 2px solid #000; border-bottom: 2px solid #000; font-weight: bold; background: #f9f9f9; }
            .total-amount { font-weight: bold; font-size: 11px; }
            .footer { text-align: center; margin-top: 15px; font-size: 11px; font-weight: bold; }
            @media print { body { margin: 0 auto; padding: 10px; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>New Adil Electric Concern</h1>
            <p>4-B, Jamiat Center, Shah Alam Market</p>
            <p>Lahore, Pakistan</p>
            <p>Phone: 0333-4263733 | Email: info@adilelectric.com</p>
            <p>Website: e-roshni.com</p>
          </div>

          <div class="invoice-info">
            <div><strong>Refund Invoice #</strong>${sale._id?.toString?.()?.slice(-6) || ''}</div>
            <div><strong>Date:</strong> ${new Date(sale.createdAt || Date.now()).toISOString().split('T')[0]} <strong>Time:</strong> ${new Date(sale.createdAt || Date.now()).toTimeString().split(' ')[0]}</div>
            <div><strong>Seller:</strong> ${sale.sellerName || sale.sellerId || '-'}</div>
            <div><strong>Customer:</strong> ${sale.customerName || '-'} | <strong>Contact:</strong> ${sale.customerContact || '-'}</div>
          </div>

          <table>
            <thead>
              <tr>
                <th>S/N</th>
                <th>Item</th>
                <th class="text-right">Qty</th>
                <th class="text-right">Rate</th>
                <th class="text-right">Amount</th>
                <th class="text-right">Reason</th>
              </tr>
            </thead>
            <tbody>
              ${refundRecord.items.map((item, idx) => {
                const itemPrice = Number(item.perPiecePrice || 0);
                const itemTotal = itemPrice * (Number(item.quantity || 0));
                return `
                <tr>
                  <td>${idx + 1}</td>
                  <td>${item.productName || '-'}</td>
                  <td class="text-right">${item.quantity || 0}</td>
                  <td class="text-right">${Number(itemPrice || 0).toLocaleString()}</td>
                  <td class="text-right">${Number(itemTotal).toLocaleString()}</td>
                  <td class="text-right" style="font-size: 9px;">${refundRecord.reason || '-'}</td>
                </tr>
              `;
              }).join('')}
              
              <tr class="total-row">
                <td colspan="5">Original Total</td>
                <td class="text-right total-amount">Rs.${Number(originalTotal).toLocaleString()}</td>
                <td></td>
              </tr>
              <tr class="total-row">
                <td colspan="5">Total Refund</td>
                <td class="text-right total-amount" style="color: #d32f2f;">Rs.${Number(totalRefundAmount).toLocaleString()}</td>
                <td></td>
              </tr>
              <tr class="total-row">
                <td colspan="5">Final Total</td>
                <td class="text-right total-amount">Rs.${Number(originalTotal - totalRefundAmount).toLocaleString()}</td>
                <td></td>
              </tr>
            </tbody>
          </table>

          <div class="footer">Thank you for your business!</div>
        </body>
      </html>
    `;
}

// Create a new sale (POST /sales)
exports.createSale = async (req, res) => {
  try {
    const { items, sellerId, sellerName, cashierName, customerName, customerContact, customerEmail, paidAmount, paymentMethod, paymentStatus: paymentStatusInput, paymentProofUrl, cashAmount, changeAmount, dueDate, discountAmount } = req.body;
    if (!items?.length || !sellerId) return res.status(400).json({ message: 'Missing sale items or seller' });

    let totalQuantity = 0;
    let totalAmount = 0; // gross total (sum of price * qty, without discount)
    let discountTotal = 0;

    const saleItems = items.map(item => {
      const quantity = Number(item.quantity);
      const perPiecePrice = Number(item.perPiecePrice);
      const discount = Number(item.discount || 0);
      const lineGross = perPiecePrice * quantity; // without discount

      totalQuantity += quantity;
      totalAmount += lineGross; // accumulate gross
      discountTotal += discount;

      return {
        ...item,
        quantity,
        perPiecePrice,
        discount,
        subtotal: lineGross - discount, // keep for reference
      };
    });
    const netAmount = Math.max(0, totalAmount - discountTotal - (Number(discountAmount) || 0));
    // Determine payment status
    let computedStatus = paidAmount >= netAmount ? 'Paid' : paidAmount > 0 ? 'Partial' : 'Unpaid';
    // If client provided a valid mapped status, normalize and use it
    const normalizeStatus = (s) => {
      if (!s) return '';
      const map = {
        'paid': 'Paid',
        'unpaid': 'Unpaid',
        'partial': 'Partial',
        'partial paid': 'Partial Paid',
        'credit': 'Credit'
      };
      const key = String(s).toLowerCase();
      return map[key] || '';
    };
    const providedStatus = normalizeStatus(paymentStatusInput);
    const paymentStatus = providedStatus || computedStatus;

    // Decrement product stock based on sold items
    for (const item of saleItems) {
      const product = item.productId
        ? await Product.findById(item.productId)
        : (item.SKU ? await Product.findOne({ SKU: item.SKU }) : null);
      if (!product) {
        return res.status(400).json({ message: `Product not found for item ${item.productName || item.SKU || ''}` });
      }

      const piecesPerCarton = Number(product.piecesPerCarton) || 0;
      const currentTotalPieces = Number(product.totalPieces) || ((Number(product.cartonQuantity) || 0) * (piecesPerCarton)) + (Number(product.losePieces) || 0);
      const sellPieces = Number(item.quantity) || 0; // quantity is assumed in pieces

      if (sellPieces > currentTotalPieces) {
        return res.status(400).json({ message: `Insufficient stock for ${product.name}. In stock: ${currentTotalPieces}, requested: ${sellPieces}` });
      }

      const remainingPieces = currentTotalPieces - sellPieces;

      let newCartons = Number(product.cartonQuantity) || 0;
      let newLosePieces = Number(product.losePieces) || 0;
      if (piecesPerCarton > 0) {
        newCartons = Math.floor(remainingPieces / piecesPerCarton);
        newLosePieces = remainingPieces % piecesPerCarton;
      } else {
        // No defined piecesPerCarton, treat all as loose pieces
        newCartons = Number(product.cartonQuantity) || 0;
        newLosePieces = remainingPieces;
      }

      const stockQuantity = newCartons + (newLosePieces > 0 ? 1 : 0);

      product.totalPieces = remainingPieces;
      product.cartonQuantity = newCartons;
      product.losePieces = newLosePieces;
      product.stockQuantity = stockQuantity;

      // Recompute derived totals for reporting
      const costPerPiece = Number(product.costPerPiece) || 0;
      const sellingPerPiece = Number(product.sellingPerPiece) || 0;
      product.totalUnitCost = costPerPiece * remainingPieces;
      product.perPieceProfit = sellingPerPiece - costPerPiece;
      product.totalUnitProfit = product.perPieceProfit * remainingPieces;

      await product.save();
    }

    const sale = new Sale({
      sellerId,
      sellerName,
      cashierName,
      items: saleItems,
      totalQuantity,
      totalAmount,
      discountTotal,
      discountAmount: Number(discountAmount) || 0,
      netAmount,
      paymentStatus,
      paymentMethod: paymentMethod || 'Cash',
      paymentProofUrl,
      cashAmount: Number(cashAmount || 0),
      changeAmount: Number(changeAmount || 0),
      paidAmount: paidAmount || 0,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      customerName,
      customerContact,
      customerEmail,
      emailStatus: 'pending'
    });
    await sale.save();

    // Send invoice email (await so status is saved) - enhanced HTML body
    if (sale.customerEmail) {
      const subject = `Invoice #${sale.invoiceNumber || String(sale._id).slice(-8)} - New Adil Electric Concern`;
      
      // Fetch products for warranty info
      let products = [];
      try {
        const productIds = sale.items.map(i => i.productId).filter(id => id);
        if (productIds.length > 0) {
          products = await Product.find({ _id: { $in: productIds } }).lean();
        }
      } catch (err) {
        console.error('Error fetching products for warranty:', err);
        // Continue without products - warranties will show as 'No warranty'
      }
      
      // Generate invoice HTML
      let html;
      try {
        html = generateInvoiceHTML(sale, products);
      } catch (err) {
        console.error('Error generating invoice HTML:', err);
        // Continue with basic HTML or skip email
        html = `<html><body><h1>Invoice</h1><p>Error generating invoice. Please contact support.</p></body></html>`;
      }

      // Send to customer
      // Send email in background (non-blocking) so API response returns immediately
      (async () => {
        try {
          const mailRes = await sendInvoiceEmail(sale.customerEmail, subject, html);
          if (mailRes.success) {
            const messageId = mailRes.result?.messageId || '';
            await Sale.findByIdAndUpdate(sale._id, { emailStatus: 'sent', emailError: '', emailMessageId: messageId }).catch(()=>{});
          } else {
            const errStr = typeof mailRes.error === 'string' ? mailRes.error : JSON.stringify(mailRes.error);
            await Sale.findByIdAndUpdate(sale._id, { emailStatus: 'failed', emailError: errStr }).catch(()=>{});
          }
          
          // Send to admin email
          const adminEmail = 'adilelectric17@gmail.com';
          const paidVal = sale.paymentMethod === 'Cash' ? (sale.cashAmount || 0) : (sale.paidAmount || 0);
          const invoiceNum = sale.invoiceNumber || String(sale._id).slice(-6);
          const adminSubject = `[ADMIN] Invoice #${invoiceNum} - ${sale.customerName || 'Unknown Customer'} - Net Rs. ${sale.netAmount} - Paid Rs. ${paidVal} - Change Rs. ${sale.changeAmount || 0}`;
          await sendInvoiceEmail(adminEmail, adminSubject, html).catch(()=>{});
        } catch (e) {
          console.error('Background email send failed:', e.message);
        }
      })();
    } else {
      // no email provided - set status immediately without awaiting
      Sale.findByIdAndUpdate(sale._id, { emailStatus: 'failed', emailError: 'No customer email provided' }).catch(()=>{});
    }

    // Return response immediately - email status updates will happen in background
    const updatedSale = await Sale.findById(sale._id).lean();

    return res.status(201).json(updatedSale);
  } catch (e) {
    res.status(500).json({ message: 'Failed to create sale', error: e.message });
  }
};

// Get all sales (Admin: all; Seller: only their own)
exports.getSales = async (req, res) => {
  try {
    const { sellerId, limit } = req.query;
    const query = sellerId ? { sellerId } : {};
    let q = Sale.find(query).sort({ createdAt: -1 });
    if (limit) {
      const l = Number(limit);
      if (!Number.isNaN(l) && l > 0) q = q.limit(l);
    }
    const sales = await q.exec();
    res.json(sales);
  } catch (e) {
    res.status(500).json({ message: 'Failed to fetch sales', error: e.message });
  }
};

// Get a single sale by ID
exports.getSaleById = async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) return res.status(404).json({ message: 'Sale not found' });
    res.json(sale);
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};

// Update sale basic details (cashier/customer fields only)
exports.updateSale = async (req, res) => {
  try {
    const {
      cashierName, customerName, customerContact, customerEmail,
      paymentStatus, paymentMethod, paidAmount, cashAmount, changeAmount, dueDate,
      items, netAmount, totalAmount, discountTotal, discountAmount, totalQuantity, paymentProofUrl, edited
    } = req.body;
    const sale = await Sale.findById(req.params.id);
    if (!sale) return res.status(404).json({ message: 'Sale not found' });

    if (cashierName !== undefined) sale.cashierName = cashierName;
    if (customerName !== undefined) sale.customerName = customerName;
    if (customerContact !== undefined) sale.customerContact = customerContact;
    if (customerEmail !== undefined) sale.customerEmail = customerEmail;
    if (paymentStatus !== undefined) sale.paymentStatus = paymentStatus;
    if (paymentMethod !== undefined) sale.paymentMethod = paymentMethod;
    if (paidAmount !== undefined) sale.paidAmount = Number(paidAmount) || 0;
    if (cashAmount !== undefined) sale.cashAmount = Number(cashAmount) || 0;
    if (changeAmount !== undefined) sale.changeAmount = Number(changeAmount) || 0;
    if (dueDate !== undefined) sale.dueDate = dueDate ? new Date(dueDate) : undefined;
    if (paymentProofUrl !== undefined) sale.paymentProofUrl = paymentProofUrl;

    // If items/totals provided, update them (frontend sends computed values)
    if (Array.isArray(items)) {
      // Compute differences between existing sale items and new items and adjust product stocks accordingly
      const origMap = new Map();
      (sale.items || []).forEach(it => { origMap.set(String(it.productId), Number(it.quantity) || 0); });
      const newMap = new Map();
      items.forEach(it => { newMap.set(String(it.productId || it._id || ''), Number(it.quantity) || 0); });

      // For each product, handle restock (when newQty < origQty) and deduction (when newQty > origQty)
      const pids = new Set([...Array.from(origMap.keys()), ...Array.from(newMap.keys())]);
      for (const pid of pids) {
        const origQty = Number(origMap.get(pid) || 0);
        const newQty = Number(newMap.get(pid) || 0);
        if (newQty < origQty) {
          // Restock the difference (edit removed items)
          const diff = origQty - newQty;
          const product = await Product.findById(pid);
          if (!product) continue;
          const piecesPerCarton = Number(product.piecesPerCarton) || 0;
          const currentTotalPieces = Number(product.totalPieces) || ((Number(product.cartonQuantity) || 0) * piecesPerCarton) + (Number(product.losePieces) || 0);
          const newTotalPieces = currentTotalPieces + diff;
          let newCartons = Number(product.cartonQuantity) || 0;
          let newLosePieces = Number(product.losePieces) || 0;
          if (piecesPerCarton > 0) {
            newCartons = Math.floor(newTotalPieces / piecesPerCarton);
            newLosePieces = newTotalPieces % piecesPerCarton;
          } else {
            newLosePieces = newTotalPieces;
          }
          const stockQuantity = newCartons + (newLosePieces > 0 ? 1 : 0);
          product.totalPieces = newTotalPieces;
          product.cartonQuantity = newCartons;
          product.losePieces = newLosePieces;
          product.stockQuantity = stockQuantity;
          const costPerPiece = Number(product.costPerPiece) || 0;
          const sellingPerPiece = Number(product.sellingPerPiece) || 0;
          product.totalUnitCost = costPerPiece * newTotalPieces;
          product.perPieceProfit = sellingPerPiece - costPerPiece;
          product.totalUnitProfit = product.perPieceProfit * newTotalPieces;
          await product.save();
        } else if (newQty > origQty) {
          // Deduct additional pieces (edit added/increased items)
          const diff = newQty - origQty;
          const product = await Product.findById(pid);
          if (!product) return res.status(400).json({ message: `Product not found for adjustment: ${pid}` });
          const piecesPerCarton = Number(product.piecesPerCarton) || 0;
          const currentTotalPieces = Number(product.totalPieces) || ((Number(product.cartonQuantity) || 0) * piecesPerCarton) + (Number(product.losePieces) || 0);
          if (diff > currentTotalPieces) {
            return res.status(400).json({ message: `Insufficient stock for ${product.name}. In stock: ${currentTotalPieces}, required additional: ${diff}` });
          }
          const newTotalPieces = currentTotalPieces - diff;
          let newCartons = Number(product.cartonQuantity) || 0;
          let newLosePieces = Number(product.losePieces) || 0;
          if (piecesPerCarton > 0) {
            newCartons = Math.floor(newTotalPieces / piecesPerCarton);
            newLosePieces = newTotalPieces % piecesPerCarton;
          } else {
            newLosePieces = newTotalPieces;
          }
          const stockQuantity = newCartons + (newLosePieces > 0 ? 1 : 0);
          product.totalPieces = newTotalPieces;
          product.cartonQuantity = newCartons;
          product.losePieces = newLosePieces;
          product.stockQuantity = stockQuantity;
          const costPerPiece = Number(product.costPerPiece) || 0;
          const sellingPerPiece = Number(product.sellingPerPiece) || 0;
          product.totalUnitCost = costPerPiece * newTotalPieces;
          product.perPieceProfit = sellingPerPiece - costPerPiece;
          product.totalUnitProfit = product.perPieceProfit * newTotalPieces;
          await product.save();
        }
      }

      sale.items = items;
    }
    if (netAmount !== undefined) sale.netAmount = Number(netAmount) || 0;
    if (totalAmount !== undefined) sale.totalAmount = Number(totalAmount) || 0;
    if (discountTotal !== undefined) sale.discountTotal = Number(discountTotal) || 0;
    if (discountAmount !== undefined) sale.discountAmount = Number(discountAmount) || 0;
    if (totalQuantity !== undefined) sale.totalQuantity = Number(totalQuantity) || 0;

    if (edited !== undefined) sale.edited = !!edited;

    await sale.save();
    const updated = await Sale.findById(req.params.id).lean();
    res.json(updated);
  } catch (e) {
    res.status(500).json({ message: 'Failed to update sale', error: e.message });
  }
};

// Resend sale invoice email (POST /sales/:id/resend-email)
exports.resendEmail = async (req, res) => {
  try {
    const saleId = req.params.id;
    const sale = await Sale.findById(saleId);
    if (!sale) return res.status(404).json({ message: 'Sale not found' });

    if (!sale.customerEmail) {
      await Sale.findByIdAndUpdate(saleId, { emailStatus: 'failed', emailError: 'No customer email provided' }).catch(()=>{});
      return res.status(400).json({ success: false, message: 'No customer email provided' });
    }

    // Build professional invoice HTML (same as createSale)
    const subject = `Invoice #${sale.invoiceNumber || String(sale._id).slice(-8)} - New Adil Electric Concern`;
    const invoiceNum = sale.invoiceNumber || String(sale._id).substr(-6);
    
    // Fetch products for warranty info
    let products = [];
    try {
      const productIds = sale.items.map(i => i.productId).filter(id => id);
      if (productIds.length > 0) {
        products = await Product.find({ _id: { $in: productIds } }).lean();
      }
    } catch (err) {
      console.error('Error fetching products for warranty:', err);
      // Continue without products - warranties will show as 'No warranty'
    }
    
    // Generate invoice HTML
    let html;
    try {
      html = generateInvoiceHTML(sale, products);
    } catch (err) {
      console.error('Error generating invoice HTML:', err);
      return res.status(500).json({ success: false, error: 'Failed to generate invoice HTML' });
    }

    // attempt send to customer
    const mailRes = await sendInvoiceEmail(sale.customerEmail, subject, html);
    if (mailRes.success) {
      const messageId = mailRes.result?.messageId || '';
      await Sale.findByIdAndUpdate(saleId, { emailStatus: 'sent', emailError: '', emailMessageId: messageId }).catch(()=>{});
      
      // Also send to admin
      const adminEmail = 'adilelectric17@gmail.com';
      const paidVal = sale.paymentMethod === 'Cash' ? (sale.cashAmount || 0) : (sale.paidAmount || 0);
      const adminSubject = `[ADMIN] Invoice #${invoiceNum} - ${sale.customerName || 'Unknown Customer'} - Net Rs. ${sale.netAmount} - Paid Rs. ${paidVal} - Change Rs. ${sale.changeAmount || 0}`;
      await sendInvoiceEmail(adminEmail, adminSubject, html).catch(()=>{});
      
      const updated = await Sale.findById(saleId).lean();
      return res.json({ success: true, sale: updated });
    } else {
      const errStr = typeof mailRes.error === 'string' ? mailRes.error : JSON.stringify(mailRes.error);
      await Sale.findByIdAndUpdate(saleId, { emailStatus: 'failed', emailError: errStr }).catch(()=>{});
      const updated = await Sale.findById(saleId).lean();
      return res.status(500).json({ success: false, error: errStr, sale: updated });
    }
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
};

// Refund items from a sale and restock products (POST /sales/:id/refund)
exports.refundSale = async (req, res) => {
  try {
    const saleId = req.params.id;
    const { items, reason } = req.body; // items: [{ productId, quantity }]
    const user = req.user || null; // set by auth middleware
    const sale = await Sale.findById(saleId);
    if (!sale) return res.status(404).json({ success: false, message: 'Sale not found' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ success: false, message: 'No items specified for refund' });

    // Build a map of original sale quantities and already refunded quantities
    // Key by productId if present, otherwise by SKU (so we can handle items that stored only SKU)
    const origMap = new Map();
    (sale.items || []).forEach(it => {
      const key = String(it.productId || it.SKU || it._id || '');
      origMap.set(key, { quantity: Number(it.quantity) || 0, perPiecePrice: Number(it.perPiecePrice) || 0, productName: it.productName || '', SKU: it.SKU || '' });
    });
    const refundedSoFar = new Map();
    (sale.refunds || []).forEach(r => { (r.items||[]).forEach(it => { const k = String(it.productId || it.SKU || it._id || ''); refundedSoFar.set(k, (refundedSoFar.get(k)||0) + (Number(it.quantity)||0)); }); });

    const refundRecordItems = [];
    let totalRefundQty = 0;
    let totalRefundAmount = 0;

    for (const it of items) {
      const key = String(it.productId || it.SKU || it._id || '');
      const reqQty = Number(it.quantity) || 0;
      if (!key || reqQty <= 0) continue;
      const orig = origMap.get(key);
      if (!orig) return res.status(400).json({ success: false, message: `Product not found in sale: ${it.productName || key}` });
      const already = Number(refundedSoFar.get(key) || 0);
      const maxRefundable = Math.max(0, (Number(orig.quantity) || 0) - already);
      if (reqQty > maxRefundable) return res.status(400).json({ success: false, message: `Refund qty for ${orig.productName || key} exceeds refundable amount (${maxRefundable})` });

      refundRecordItems.push({ productId: key, productName: orig.productName, SKU: orig.SKU, quantity: reqQty, perPiecePrice: Number(orig.perPiecePrice) || 0 });
      totalRefundQty += reqQty;
      totalRefundAmount += (Number(orig.perPiecePrice) || 0) * reqQty;
    }

    if (refundRecordItems.length === 0) return res.status(400).json({ success: false, message: 'No valid refund items' });

    // Restock products and update product derived fields
    for (const rit of refundRecordItems) {
      // try find by id first, then by SKU, then by treating rit.productId as SKU
      let product = null;
      if (rit.productId) {
        try { product = await Product.findById(rit.productId); } catch (e) { product = null; }
      }
      if (!product && rit.SKU) {
        product = await Product.findOne({ SKU: rit.SKU });
      }
      if (!product && rit.productId) {
        // rit.productId might actually be an SKU string
        product = await Product.findOne({ SKU: rit.productId });
      }
      if (!product) continue; // skip if missing
      const addPieces = Number(rit.quantity) || 0;
      const piecesPerCarton = Number(product.piecesPerCarton) || 0;
      const currentTotalPieces = Number(product.totalPieces) || ((Number(product.cartonQuantity) || 0) * piecesPerCarton) + (Number(product.losePieces) || 0);
      const newTotalPieces = currentTotalPieces + addPieces;

      let newCartons = Number(product.cartonQuantity) || 0;
      let newLosePieces = Number(product.losePieces) || 0;
      if (piecesPerCarton > 0) {
        newCartons = Math.floor(newTotalPieces / piecesPerCarton);
        newLosePieces = newTotalPieces % piecesPerCarton;
      } else {
        newLosePieces = newTotalPieces;
      }
      const stockQuantity = newCartons + (newLosePieces > 0 ? 1 : 0);

      product.totalPieces = newTotalPieces;
      product.cartonQuantity = newCartons;
      product.losePieces = newLosePieces;
      product.stockQuantity = stockQuantity;

      const costPerPiece = Number(product.costPerPiece) || 0;
      const sellingPerPiece = Number(product.sellingPerPiece) || 0;
      product.totalUnitCost = costPerPiece * newTotalPieces;
      product.perPieceProfit = sellingPerPiece - costPerPiece;
      product.totalUnitProfit = product.perPieceProfit * newTotalPieces;

      await product.save();
    }

    // Append refund record to sale
    const refundRecord = {
      items: refundRecordItems.map(i => ({ productId: i.productId, productName: i.productName, SKU: i.SKU, quantity: i.quantity, perPiecePrice: i.perPiecePrice })),
      totalRefundQty: totalRefundQty,
      totalRefundAmount: totalRefundAmount,
      refundedBy: user?._id || undefined,
      refundedByName: user?.username || user?.name || (req.user && req.user.email) || 'system',
      refundedByRole: user?.role || 'seller',
      reason: reason || '',
      createdAt: new Date()
    };
    sale.refunds = sale.refunds || [];
    sale.refunds.push(refundRecord);

    // adjust sale totals (reduce totalQuantity and netAmount)
    sale.totalQuantity = Math.max(0, Number(sale.totalQuantity || 0) - totalRefundQty);
    sale.netAmount = Math.max(0, Number(sale.netAmount || 0) - totalRefundAmount);

    await sale.save();

    const updated = await Sale.findById(saleId).lean();
    // Send refund notification email to admin with refund invoice matching regular invoice design
    try {
      const adminEmail = process.env.ADMIN_EMAIL || 'adilelectric17@gmail.com';
      const subject = `Refund processed - Invoice #${String(sale._id).slice(-6)}`;
      const html = generateRefundInvoiceHTML(sale, refundRecord);
      // send in background
      sendInvoiceEmail(adminEmail, subject, html).catch(()=>{});
    } catch (e) {
      console.error('Failed to send refund email to admin:', e);
    }
    return res.json({ success: true, sale: updated });
  } catch (e) {
    console.error('Refund error', e);
    return res.status(500).json({ success: false, message: e.message || 'Refund failed' });
  }
};

// Claim warranty for items in a sale and reduce product stock (POST /sales/:id/warranty-claim)
exports.claimWarranty = async (req, res) => {
  try {
    const saleId = req.params.id;
    const { items, reason } = req.body; // items: [{ productId, quantity }]
    const user = req.user || null; // set by auth middleware
    const sale = await Sale.findById(saleId);
    if (!sale) return res.status(404).json({ success: false, message: 'Sale not found' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ success: false, message: 'No items specified for warranty claim' });

    // Build map of original sale quantities
    const origMap = new Map();
    (sale.items || []).forEach(it => {
      const key = String(it.productId || it.SKU || it._id || '');
      origMap.set(key, { quantity: Number(it.quantity) || 0, productName: it.productName || '', SKU: it.SKU || '' });
    });

    // Already claimed warranty quantities
    const claimedSoFar = new Map();
    (sale.warrantyClaims || []).forEach(wc => {
      (wc.items || []).forEach(it => {
        const k = String(it.productId || it.SKU || it._id || '');
        claimedSoFar.set(k, (claimedSoFar.get(k) || 0) + (Number(it.quantity) || 0));
      });
    });

    const claimItems = [];
    let totalWarrantyQty = 0;

    for (const it of items) {
      const key = String(it.productId || it.SKU || it._id || '');
      const reqQty = Number(it.quantity) || 0;
      if (!key || reqQty <= 0) continue;
      const orig = origMap.get(key);
      if (!orig) return res.status(400).json({ success: false, message: `Product not found in sale: ${it.productName || key}` });

      // Check warranty validity based on product warrantyMonths and sale createdAt
      let product = null;
      if (it.productId) {
        try { product = await Product.findById(it.productId); } catch (e) { product = null; }
      }
      if (!product && orig.SKU) {
        product = await Product.findOne({ SKU: orig.SKU });
      }
      if (!product) return res.status(400).json({ success: false, message: `Product not found for warranty check: ${orig.productName || key}` });

      const warrantyMonths = product.warrantyMonths == null ? 0 : Number(product.warrantyMonths);
      if (warrantyMonths <= 0) {
        return res.status(400).json({ success: false, message: `No warranty available for ${orig.productName || key}` });
      }
      const saleDate = new Date(sale.createdAt || Date.now());
      const warrantyUntil = new Date(saleDate);
      warrantyUntil.setMonth(warrantyUntil.getMonth() + warrantyMonths);
      if (new Date() > warrantyUntil) {
        return res.status(400).json({ success: false, message: `Warranty expired for ${orig.productName || key}` });
      }

      // For warranty claims, allow multiple claims within warranty period
      // Only check if warranty is still valid, don't limit by quantity already claimed

      claimItems.push({ productId: it.productId || null, productName: orig.productName, SKU: orig.SKU, quantity: reqQty });
      totalWarrantyQty += reqQty;
    }

    if (claimItems.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid warranty claim items' });
    }

    // Reduce product stock for claimed items and update warrantyClaimedPieces
    for (const ci of claimItems) {
      let product = null;
      if (ci.productId) {
        try { product = await Product.findById(ci.productId); } catch (e) { product = null; }
      }
      if (!product && ci.SKU) {
        product = await Product.findOne({ SKU: ci.SKU });
      }
      if (!product && ci.productId) {
        product = await Product.findOne({ SKU: ci.productId });
      }
      if (!product) continue;

      const claimPieces = Number(ci.quantity) || 0;
      const piecesPerCarton = Number(product.piecesPerCarton) || 0;
      const currentTotalPieces = Number(product.totalPieces) || ((Number(product.cartonQuantity) || 0) * piecesPerCarton) + (Number(product.losePieces) || 0);
      if (claimPieces > currentTotalPieces) {
        return res.status(400).json({ success: false, message: `Insufficient stock for warranty claim on ${product.name}. In stock: ${currentTotalPieces}, requested: ${claimPieces}` });
      }
      const newTotalPieces = currentTotalPieces - claimPieces;

      let newCartons = Number(product.cartonQuantity) || 0;
      let newLosePieces = Number(product.losePieces) || 0;
      if (piecesPerCarton > 0) {
        newCartons = Math.floor(newTotalPieces / piecesPerCarton);
        newLosePieces = newTotalPieces % piecesPerCarton;
      } else {
        newLosePieces = newTotalPieces;
      }
      const stockQuantity = newCartons + (newLosePieces > 0 ? 1 : 0);

      product.totalPieces = newTotalPieces;
      product.cartonQuantity = newCartons;
      product.losePieces = newLosePieces;
      product.stockQuantity = stockQuantity;

      const costPerPiece = Number(product.costPerPiece) || 0;
      const sellingPerPiece = Number(product.sellingPerPiece) || 0;
      product.totalUnitCost = costPerPiece * newTotalPieces;
      product.perPieceProfit = sellingPerPiece - costPerPiece;
      product.totalUnitProfit = product.perPieceProfit * newTotalPieces;

      product.warrantyClaimedPieces = Number(product.warrantyClaimedPieces || 0) + claimPieces;

      await product.save();
    }

    const claimRecord = {
      items: claimItems.map(i => ({ productId: i.productId, productName: i.productName, SKU: i.SKU, quantity: i.quantity })),
      totalWarrantyQty,
      claimedBy: user?._id || undefined,
      claimedByName: user?.username || user?.name || (req.user && req.user.email) || 'system',
      claimedByRole: user?.role || 'seller',
      reason: reason || '',
      createdAt: new Date()
    };

    sale.warrantyClaims = sale.warrantyClaims || [];
    sale.warrantyClaims.push(claimRecord);

    await sale.save();

    const updated = await Sale.findById(saleId).lean();
    return res.json({ success: true, sale: updated });
  } catch (e) {
    console.error('Warranty claim error', e);
    return res.status(500).json({ success: false, message: e.message || 'Warranty claim failed' });
  }
};

// Get recent refunds for notifications (GET /sales/refunds/recent)
exports.getRecentRefunds = async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 10;
    const sales = await Sale.find({ refunds: { $exists: true, $not: { $size: 0 } } })
      .sort({ 'refunds.0.createdAt': -1 })
      .limit(limit)
      .lean();
    
    const refunds = [];
    sales.forEach(sale => {
      (sale.refunds || []).forEach((refund, idx) => {
        refunds.push({
          id: `${sale._id}-refund-${idx}`,
          saleId: sale._id,
          invoiceNumber: sale.invoiceNumber,
          customerName: sale.customerName,
          items: refund.items,
          totalRefundQty: refund.totalRefundQty,
          totalRefundAmount: refund.totalRefundAmount,
          refundedBy: refund.refundedBy,
          refundedByName: refund.refundedByName,
          refundedByRole: refund.refundedByRole,
          reason: refund.reason,
          createdAt: refund.createdAt || sale.updatedAt,
          ts: new Date(refund.createdAt || sale.updatedAt).getTime()
        });
      });
    });
    
    refunds.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return res.json(refunds.slice(0, limit));
  } catch (e) {
    console.error('Error fetching recent refunds:', e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

// Get recent warranty claims for notifications (GET /sales/warranty/recent)
exports.getRecentWarrantyClaims = async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 10;
    const sales = await Sale.find({ warrantyClaims: { $exists: true, $not: { $size: 0 } } })
      .sort({ 'warrantyClaims.0.createdAt': -1 })
      .limit(limit)
      .lean();
    
    const claims = [];
    sales.forEach(sale => {
      (sale.warrantyClaims || []).forEach((claim, idx) => {
        claims.push({
          id: `${sale._id}-warranty-${idx}`,
          saleId: sale._id,
          invoiceNumber: sale.invoiceNumber,
          customerName: sale.customerName,
          items: claim.items,
          totalWarrantyQty: claim.totalWarrantyQty,
          claimedBy: claim.claimedBy,
          claimedByName: claim.claimedByName,
          claimedByRole: claim.claimedByRole,
          reason: claim.reason,
          createdAt: claim.createdAt || sale.updatedAt,
          ts: new Date(claim.createdAt || sale.updatedAt).getTime()
        });
      });
    });
    
    claims.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return res.json(claims.slice(0, limit));
  } catch (e) {
    console.error('Error fetching recent warranty claims:', e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

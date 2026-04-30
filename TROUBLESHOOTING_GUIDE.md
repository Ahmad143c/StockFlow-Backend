# StockFlow Backend - Error Troubleshooting Guide

## 🔴 Issue #1: 404 Errors with Double `/api/api/` in URLs

### Error Messages:
```
GET https://stockflow-backend-production-22de.up.railway.app/api/api/sales/refunds/recent?limit=10 404 (Not Found)
GET https://stockflow-backend-production-22de.up.railway.app/api/api/sales/warranty/recent?limit=10 404 (Not Found)
GET https://stockflow-backend-production-22de.up.railway.app/api/api/sales?limit=10 404 (Not Found)
```

### Root Cause:
**This is a FRONTEND issue, not a backend issue.**

The frontend is making requests to paths that **already include `/api/`**, but the API client is configured to **automatically prepend `/api/`** to all requests.

**Example:**
- Frontend tries to fetch: `/api/sales/refunds/recent`
- API client adds `/api/` prefix → `/api/` + `/api/sales/refunds/recent`
- Final request: `/api/api/sales/refunds/recent` ❌

### Backend Routes (CORRECT):
```
✅ app.use('/api/sales', require('./routes/sales'))
✅ router.get('/refunds/recent', ...)
✅ Final URL: /api/sales/refunds/recent
```

### Fix (FRONTEND - NOT BACKEND):

**Check your frontend's API client configuration.**

**Option 1: Use Relative Paths** (Recommended)
```javascript
// In your frontend API client (probably in src/services or similar)

// ❌ DON'T DO THIS (full path):
axios.get('http://api.com/api/sales/refunds/recent')

// ✅ DO THIS (relative path):
axios.get('/sales/refunds/recent')
// Let the baseURL or API client middleware add /api/
```

**Option 2: Remove `/api/` from Client Configuration**
Check your `axios.defaults.baseURL` or API client config:
```javascript
// ❌ Wrong:
const apiClient = axios.create({
  baseURL: 'https://api.com/api' // Adds /api/ automatically
});

// Then fetching from route that includes /api/sales/refunds
// Results in: /api + /api/sales/refunds = /api/api/sales/refunds ❌

// ✅ Correct:
const apiClient = axios.create({
  baseURL: 'https://api.com/api'
});
// Only use relative paths in your app: '/sales/refunds' (not '/api/sales/refunds')

// OR

const apiClient = axios.create({
  baseURL: 'https://api.com' // No /api/ here
});
// Use full paths: '/api/sales/refunds'
```

**Action Items:**
1. Find where your frontend makes HTTP requests (likely `src/services/api.js` or similar)
2. Check if using absolute paths like `/api/sales/...`
3. If yes, change to relative paths: `/sales/...` (let the baseURL handle `/api/`)
4. Redeploy frontend

---

## 🔴 Issue #2: Email Sending - Connection Timeout

### Error Messages:
```
Email send error: Connection timeout
Error fetching refunds: AxiosError: Request failed with status code 404
email is sending Failed please check
```

### Root Cause:
Nodemailer cannot connect to SMTP server (Gmail). This is usually due to:

1. **Missing or incorrect SMTP credentials in `.env`**
2. **Using Gmail password instead of App Password**
3. **Network connectivity issue** (production server can't reach Gmail SMTP)
4. **Firewall blocking outbound SMTP connections**
5. **Incorrect SMTP port or secure flag**

### ✅ Backend Fix Applied:
I've updated `saleController.js` with:
- Connection timeout: 15 seconds
- Socket timeout: 15 seconds  
- Better error messages for timeout vs auth failures
- Debug logging

### 📋 Checklist - Fix Email Issues:

#### Step 1: Verify `.env` Configuration

Check your `.env` file (in production server):

```bash
# Connect to your Railway production server and check:
echo $SMTP_USER    # Should show your email
echo $SMTP_PASS    # Should show app password (NOT your Gmail password)
echo $SMTP_HOST    # Should be: smtp.gmail.com
echo $SMTP_PORT    # Should be: 465
echo $SMTP_SECURE  # Should be: true
```

**Expected Configuration:**
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-16-character-app-password (NOT regular Gmail password!)
EMAIL_FROM="Company Name <your-email@gmail.com>"
```

#### Step 2: If Using Gmail - Create App Password

**This is critical! Regular Gmail passwords don't work with SMTP.**

1. Go to https://myaccount.google.com/
2. Click **Security** (left sidebar)
3. Scroll to **How you sign in to Google**
4. Ensure **2-Step Verification** is ON
5. Scroll to **App passwords** (only visible if 2-Step is enabled)
6. Select **Mail** and **Windows Computer** (or your platform)
7. Copy the 16-character app password
8. Update `.env`: `SMTP_PASS=<16-char-app-password>`

#### Step 3: Test SMTP Connection

**Option A: Command Line Test** (1 minute)
```bash
# SSH into your Railway container
railway up

# Create a test file:
cat > test-email.js << 'EOF'
const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  connectionTimeout: 15000,
  socketTimeout: 15000
});

transporter.verify((error, success) => {
  if (error) {
    console.error('❌ SMTP Error:', error.message);
  } else {
    console.log('✅ SMTP Connected successfully!');
  }
  process.exit(0);
});
EOF

node test-email.js
```

**Option B: Using Node REPL** (in production)
```javascript
// In Railway container console:
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

transporter.verify().then(valid => {
  console.log(valid ? '✅ SMTP OK' : '❌ SMTP Failed');
}).catch(err => console.error('❌', err.message));
```

#### Step 4: Check Network Connectivity

If SMTP test fails with timeout:
```bash
# Test connection to Gmail SMTP
telnet smtp.gmail.com 465
# Should show: Connected to smtp.gmail.com

# Or using nc:
nc -zv smtp.gmail.com 465
# Should show: Connection to smtp.gmail.com port 465 [tcp/esmtp] succeeded!
```

If connection refused:
- **Firewall issue**: Your Railway container can't reach external SMTP
- **Solution**: Contact Railway support about outbound SMTP access
- **Alternative**: Use a different email service (SendGrid, Mailgun, AWS SES)

---

## 🔧 Recommended Email Service Alternatives

If Gmail SMTP continues to have issues:

### Option 1: SendGrid (Recommended)
- Free tier: 100 emails/day
- More reliable than Gmail
- Setup: 5 minutes

### Option 2: Mailgun
- Free tier: 1,000 emails/month
- Lower latency
- Setup: 5 minutes

### Option 3: AWS SES
- Free tier: 200 emails/day
- Most reliable for production
- Setup: 15 minutes (AWS account required)

---

## 📊 Summary of Changes Made

### Backend Changes:
1. ✅ Added timeout configuration to nodemailer (15 seconds)
2. ✅ Improved error messages for connection timeouts
3. ✅ Added debug logging for development environment

### What YOU Need to Do:

**URGENT - Frontend Fix:**
- [ ] Fix the double `/api/` issue in frontend API client
- [ ] Test with corrected URLs

**Email Configuration:**
- [ ] Verify `.env` has all SMTP credentials
- [ ] If using Gmail: create and set App Password (NOT regular password)
- [ ] Run SMTP connection test
- [ ] Check network connectivity to Gmail SMTP (if timeout persists)
- [ ] Consider alternative email service if Gmail fails

---

## 🆘 Still Having Issues?

1. **For 404 errors**: Check frontend API client base URL configuration
2. **For email timeout**: 
   - Verify SMTP credentials with test script
   - Check telnet/nc connectivity to smtp.gmail.com:465
   - Check Railway logs for error details
3. **Need help?** Share:
   - `.env` SMTP settings (without passwords)
   - Output of SMTP test
   - Network connectivity test results


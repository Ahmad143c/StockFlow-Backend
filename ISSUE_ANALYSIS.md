# Issue Analysis & Solutions

## Issue 1: Double `/api/` in URL (404 Errors)

**Problem:**
- Error URL: `GET https://.../api/api/sales/refunds/recent` (double `/api/`)
- Expected URL: `GET https://.../api/sales/refunds/recent`

**Root Cause:**
This is a **FRONTEND issue**, not backend. The frontend client is:
1. Making request to a path that already includes `/api/sales`
2. But the HTTP client/axios is configured to prepend `/api/` to all requests
3. Result: `/api/` + `/api/sales/refunds/recent` = `/api/api/sales/refunds/recent`

**Backend Routes (CORRECT):**
- ✅ `app.use('/api/sales', require('./routes/sales'))` (server.js:103)
- ✅ `router.get('/refunds/recent', auth, saleController.getRecentRefunds)` (sales.js:15)
- ✅ Final route: `/api/sales/refunds/recent` ← This is correct

**Fix Needed (FRONTEND):**
Check your frontend's API client configuration. Either:
1. Use relative paths: `/sales/refunds/recent` (let `/api/` be added by client config)
2. Or remove the `/api/` prefix from client config if using full paths

---

## Issue 2: Email Sending - Connection Timeout

**Problem:**
- "Email send error: Connection timeout"
- "email is sending Failed"

**Root Cause Analysis:**
The `nodemailer` transporter is timing out when attempting to connect to SMTP server.

**Likely Causes:**
1. **Missing SMTP credentials in .env** - SMTP_USER and SMTP_PASS not configured
2. **Incorrect SMTP settings** (if using Gmail):
   - Must use App Password (not regular Gmail password)
   - Must have 2-Step Verification enabled
   - Port 465 with secure:true, or port 587 with secure:false
3. **Firewall/Network issue** - Production server cannot connect to SMTP host
4. **Invalid SMTP_HOST** - Wrong domain or unreachable

**Current SMTP Config (from code):**
- Host: `smtp.gmail.com` (default)
- Port: 465 or 587 (based on SMTP_SECURE)
- Auth: Uses SMTP_USER and SMTP_PASS from .env

**Solutions to Try:**

### 1. Verify .env Configuration
- Confirm `SMTP_USER` and `SMTP_PASS` are set
- If using Gmail: `SMTP_PASS` must be an App Password (see .env.example)
- Ensure `SMTP_HOST=smtp.gmail.com`
- Ensure `SMTP_PORT=465` and `SMTP_SECURE=true` (or port 587 with secure=false)

### 2. Add Timeout Configuration
- Current code has no timeout - requests hang indefinitely
- Recommendation: Add 10-15 second timeout to prevent hanging

### 3. Test SMTP Connection
- Create a test endpoint to verify SMTP works before sending real emails

---

## Summary of Files to Check:

1. **.env file** - Verify all SMTP credentials are set correctly
2. **Frontend API client** - Remove double `/api/` prefix
3. **saleController.js** (line 16-21) - Add timeout to transporter

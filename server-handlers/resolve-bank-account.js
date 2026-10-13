const json = (res, status, body) => {
  if (typeof res.status === 'function') return res.status(status).json(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const secret = process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET;
  if (!secret) return json(res, 500, { error: 'Account verification is not configured on the server.' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return json(res, 400, { error: 'Invalid JSON body.' });
    }
  }

  const accountNumber = String(body.accountNumber || '').replace(/\D/g, '');
  const bankCode = String(body.bankCode || '').trim();
  if (!/^\d{10}$/.test(accountNumber) || !bankCode) {
    return json(res, 400, { error: 'Enter a valid 10-digit account number and select a bank.' });
  }

  try {
    const response = await fetch(`https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${encodeURIComponent(bankCode)}`, {
      headers: { Authorization: `Bearer ${secret}` }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.status || !payload.data?.account_name) {
      return json(res, 422, { error: payload.message || 'The bank could not verify this account. Check the bank and account number.' });
    }
    return json(res, 200, { accountName: payload.data.account_name, accountNumber: payload.data.account_number, bankId: payload.data.bank_id });
  } catch (error) {
    console.error('Bank account verification failed:', error);
    return json(res, 502, { error: 'Bank verification is temporarily unavailable. Please try again.' });
  }
}

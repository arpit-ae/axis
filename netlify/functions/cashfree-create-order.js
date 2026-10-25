exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const clientId = process.env.CASHFREE_APP_ID;
  const clientSecret = process.env.CASHFREE_SECRET_KEY;
  const environment = (process.env.CASHFREE_ENV || 'sandbox').toLowerCase();
  if (!clientId || !clientSecret) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Cashfree credentials are not configured on the server.' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const name = String(body.name || '').trim().slice(0, 100);
    const email = String(body.email || '').trim().slice(0, 150);
    const phone = String(body.phone || '').replace(/\D/g, '').slice(-10);
    const purpose = String(body.purpose || '').trim().slice(0, 200);
    const amount = Number(body.amount);

    if (!name || !email || !/^\d{10}$/.test(phone) || !purpose || !Number.isFinite(amount) || amount < 1 || amount > 10000000) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please provide valid name, email, 10-digit mobile, purpose and amount (₹1 to ₹1 crore).' }) };
    }

    const orderId = `GOAXIS_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const siteUrl = (process.env.SITE_URL || 'https://goaxis.in').replace(/\/$/, '');
    const apiBase = environment === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';

    const cfResponse = await fetch(`${apiBase}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': '2025-01-01',
        'x-client-id': clientId,
        'x-client-secret': clientSecret,
        'x-request-id': orderId
      },
      body: JSON.stringify({
        order_id: orderId,
        order_amount: Number(amount.toFixed(2)),
        order_currency: 'INR',
        customer_details: {
          customer_id: `GOAXIS_${phone}`,
          customer_name: name,
          customer_email: email,
          customer_phone: phone
        },
        order_note: purpose,
        order_meta: {
          return_url: `${siteUrl}/payment-return.html?order_id={order_id}`,
          notify_url: `${siteUrl}/api/cashfree/webhook`
        }
      })
    });

    const result = await cfResponse.json();
    if (!cfResponse.ok) {
      console.error('Cashfree create order failed', cfResponse.status, result);
      return { statusCode: 502, headers, body: JSON.stringify({ error: result.message || 'Cashfree could not create the payment order.' }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        order_id: result.order_id || orderId,
        payment_session_id: result.payment_session_id,
        environment
      })
    };
  } catch (error) {
    console.error(error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Unable to start payment. Please try again.' }) };
  }
};

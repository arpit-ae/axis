exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const clientId = process.env.CASHFREE_APP_ID;
  const clientSecret = process.env.CASHFREE_SECRET_KEY;
  const environment = (process.env.CASHFREE_ENV || 'sandbox').toLowerCase();
  if (!clientId || !clientSecret) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Cashfree credentials are not configured on the server.' }) };

  const orderId = event.queryStringParameters?.order_id || event.path.split('/').filter(Boolean).pop();
  if (!orderId || orderId === 'order') return { statusCode: 400, headers, body: JSON.stringify({ error: 'Order ID is required.' }) };

  try {
    const apiBase = environment === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
    const response = await fetch(`${apiBase}/orders/${encodeURIComponent(orderId)}`, {
      headers: { 'x-api-version': '2025-01-01', 'x-client-id': clientId, 'x-client-secret': clientSecret }
    });
    const order = await response.json();
    if (!response.ok) return { statusCode: response.status, headers, body: JSON.stringify({ error: order.message || 'Could not retrieve order.' }) };

    const paymentsResponse = await fetch(`${apiBase}/orders/${encodeURIComponent(orderId)}/payments`, {
      headers: { 'x-api-version': '2025-01-01', 'x-client-id': clientId, 'x-client-secret': clientSecret }
    });
    const payments = paymentsResponse.ok ? await paymentsResponse.json() : [];
    const paid = Array.isArray(payments) && payments.some(p => p.payment_status === 'SUCCESS');

    return { statusCode: 200, headers, body: JSON.stringify({ order: { ...order, verified_status: paid ? 'PAID' : order.order_status }, payments }) };
  } catch (error) {
    console.error(error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Unable to retrieve payment status.' }) };
  }
};

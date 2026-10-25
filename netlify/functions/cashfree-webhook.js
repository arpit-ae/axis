const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const secret = process.env.CASHFREE_SECRET_KEY;
  if (!secret) return { statusCode: 500, body: 'Webhook secret is not configured' };

  const signature = event.headers['x-webhook-signature'] || event.headers['X-Webhook-Signature'];
  const timestamp = event.headers['x-webhook-timestamp'] || event.headers['X-Webhook-Timestamp'];
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  if (!signature || !timestamp) return { statusCode: 400, body: 'Missing webhook signature headers' };

  const expected = crypto.createHmac('sha256', secret).update(timestamp + rawBody).digest('base64');
  const valid = signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return { statusCode: 401, body: 'Invalid webhook signature' };

  try {
    const payload = JSON.parse(rawBody || '{}');
    console.log('Verified Cashfree webhook', JSON.stringify({
      type: payload.type,
      order_id: payload.data?.order?.order_id,
      order_status: payload.data?.order?.order_status,
      payment_status: payload.data?.payment?.payment_status
    }));
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (error) {
    console.error('Invalid webhook JSON', error);
    return { statusCode: 400, body: 'Invalid JSON' };
  }
};

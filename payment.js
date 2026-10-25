(() => {
  const form = document.getElementById('payment-form');
  if (!form) return;
  const button = document.getElementById('pay-button');
  const message = document.getElementById('payment-message');

  const setMessage = (text, type = '') => {
    message.textContent = text;
    message.className = `pay-note ${type}`;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const data = new FormData(form);
    const amount = Number(data.get('amount'));
    const phone = String(data.get('phone') || '').replace(/\D/g, '');
    if (!Number.isFinite(amount) || amount < 1) return setMessage('Please enter a valid amount.', 'pay-error');
    if (phone.length < 10) return setMessage('Please enter a valid mobile number.', 'pay-error');

    button.disabled = true;
    button.textContent = 'Creating secure payment…';
    setMessage('Please wait…');

    try {
      const response = await fetch('/api/cashfree/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(data.get('name')).trim(),
          phone,
          email: String(data.get('email')).trim(),
          amount: amount.toFixed(2),
          purpose: String(data.get('purpose')).trim()
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not create payment order.');
      if (!result.payment_session_id || !result.order_id) throw new Error('Cashfree did not return a payment session.');

      sessionStorage.setItem('goaxis_payment_customer', JSON.stringify({
        name: String(data.get('name')).trim(),
        phone,
        email: String(data.get('email')).trim(),
        amount: amount.toFixed(2),
        purpose: String(data.get('purpose')).trim(),
        orderId: result.order_id
      }));

      const script = document.createElement('script');
      script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
      script.onload = () => {
        const cashfree = Cashfree({ mode: result.environment === 'sandbox' ? 'sandbox' : 'production' });
        cashfree.checkout({ paymentSessionId: result.payment_session_id, redirectTarget: '_self' });
      };
      script.onerror = () => { throw new Error('Could not load Cashfree checkout. Please try again.'); };
      document.head.appendChild(script);
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Payment could not be started.', 'pay-error');
      button.disabled = false;
      button.textContent = 'Pay Now →';
    }
  });
})();

(() => {
  const form = document.getElementById('payment-form');
  if (!form) return;
  const button = document.getElementById('pay-button');
  const message = document.getElementById('payment-message');

  const setMessage = (text, type = '') => {
    message.textContent = text;
    message.className = `pay-note ${type}`;
  };

  const resetButton = () => {
    button.disabled = false;
    button.textContent = 'Pay Now →';
  };

  const showPaymentError = (error) => {
    console.error('GOAXIS payment could not be started', error);
    setMessage(
      error instanceof Error && error.message
        ? error.message
        : 'Payment could not be started. Please try again.',
      'pay-error'
    );
    resetButton();
  };

  const loadCashfreeSdk = () => {
    if (typeof window.Cashfree === 'function') return Promise.resolve();

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => {
        script.remove();
        reject(new Error('Cashfree checkout could not load. Please disable any ad/content blocker for this page or try another browser.'));
      }, 10000);

      script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
      script.async = true;
      script.onload = () => {
        clearTimeout(timeout);
        if (typeof window.Cashfree !== 'function') {
          reject(new Error('Cashfree checkout could not initialise. Please try again.'));
          return;
        }
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Cashfree checkout could not load. Please check your connection or browser extensions, then retry.'));
      };
      document.head.appendChild(script);
    });
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const data = new FormData(form);
    const amount = Number(data.get('amount'));
    const suppliedPhone = String(data.get('phone') || '').trim();
    let phone = suppliedPhone.replace(/\D/g, '');
    if (phone.length === 12 && phone.startsWith('91')) phone = phone.slice(2);
    if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) return setMessage('Enter an amount between ₹1 and ₹10,00,000.', 'pay-error');
    if (!/^[6-9]\d{9}$/.test(phone)) return setMessage('Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9. You may include +91.', 'pay-error');

    button.disabled = true;
    button.textContent = 'Creating secure payment…';
    setMessage('Creating your secure payment session. Please wait…');

    try {
      const response = await fetch('/api/cashfree/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: String(data.get('name')).trim(),
          phone,
          email: String(data.get('email')).trim(),
          amount: amount.toFixed(2),
          purpose: String(data.get('purpose')).trim()
        })
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Could not create payment order (HTTP ${response.status}).`);
      if (!result.payment_session_id || !result.order_id) throw new Error('Cashfree did not return a payment session.');

      // Session storage is only a convenience for the return page; payment must still work if storage is blocked.
      try {
        sessionStorage.setItem('goaxis_payment_customer', JSON.stringify({
          name: String(data.get('name')).trim(),
          phone,
          email: String(data.get('email')).trim(),
          amount: amount.toFixed(2),
          purpose: String(data.get('purpose')).trim(),
          orderId: result.order_id
        }));
      } catch (storageError) {
        console.warn('GOAXIS session storage unavailable; continuing checkout without saved form details.');
      }

      await loadCashfreeSdk();
      const cashfree = window.Cashfree({
        mode: result.environment === 'sandbox' ? 'sandbox' : 'production'
      });
      // Cashfree's hosted checkout owns the navigation. Do not await it: the SDK
      // can leave the page in a loading state while a browser extension blocks it.
      button.textContent = 'Opening secure checkout…';
      cashfree.checkout({
        paymentSessionId: result.payment_session_id
      });
    } catch (error) {
      showPaymentError(error);
    }
  });
})();

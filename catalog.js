export const packages = {
  "udyam": { amount: 100, title: "Udyam / MSME Registration Assistance" },
  "gst": { amount: 499, title: "GST Registration Assistance" },
  "fssai": { amount: 200, title: "FSSAI Registration Assistance (Priority)" },
  "iec": { amount: 700, title: "IEC Certificate Assistance" },
  "website-five-page": { amount: 1000, title: "5-Page Business Website Development" },
  "invoice-basic": { amount: 500, title: "Invoice Template" },
  "invoice-purchase-sale": { amount: 800, title: "Purchase + Sales Invoice Templates" },
  "invoice-challan": { amount: 1000, title: "Purchase + Sales Invoice + Delivery Challan Templates" },
  "website-ten-page": { amount: 2000, title: "Business Website + Sales/Purchase Invoice + Delivery Challan + Admin Controls (Starter Suite)" }
};

export const rupees = amount => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", minimumFractionDigits: 2
}).format(amount);

export function orderLines(ids, purpose, amount) {
  if (!ids.length) return [{ title: purpose, quantity: 1, price: amount }];
  return ids.map(id => ({ title: packages[id].title, quantity: 1, price: packages[id].amount }));
}

export function addressText(address) {
  return [address.line1, address.line2, address.city, address.state, address.postal, address.country].filter(Boolean).join(", ");
}

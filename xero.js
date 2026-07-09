// xero.js — handles the Xero OAuth2 connection and invoice creation/emailing.
const { XeroClient } = require('xero-node');
const db = require('./db');

const xero = new XeroClient({
  clientId: process.env.XERO_CLIENT_ID,
  clientSecret: process.env.XERO_CLIENT_SECRET,
  redirectUris: [process.env.XERO_REDIRECT_URI],
  scopes: 'openid profile email accounting.transactions accounting.contacts offline_access'.split(' '),
});

let tenantId = null;

function isConfigured() {
  return !!(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET && process.env.XERO_REDIRECT_URI);
}

async function getConsentUrl() {
  return xero.buildConsentUrl();
}

async function handleCallback(callbackUrl) {
  const tokenSet = await xero.apiCallback(callbackUrl);
  await xero.updateTenants();
  const tenant = xero.tenants[0];
  tenantId = tenant.tenantId;
  db.saveXeroTokens({
    tokenSet,
    tenantId,
    tenantName: tenant.tenantName,
    connectedAt: new Date().toISOString(),
  });
  return tenant;
}

async function ensureConnected() {
  const saved = db.getXeroTokens();
  if (!saved) return false;
  xero.setTokenSet(saved.tokenSet);
  tenantId = saved.tenantId;

  const expiresAt = saved.tokenSet.expires_at ? saved.tokenSet.expires_at * 1000 : 0;
  if (Date.now() > expiresAt - 60_000) {
    const newTokenSet = await xero.refreshToken();
    db.saveXeroTokens({ ...saved, tokenSet: newTokenSet });
  }
  return true;
}

function getStatus() {
  const saved = db.getXeroTokens();
  return {
    configured: isConfigured(),
    connected: !!saved,
    tenantName: saved ? saved.tenantName : null,
    connectedAt: saved ? saved.connectedAt : null,
  };
}

function disconnect() {
  db.saveXeroTokens(null);
  tenantId = null;
}

async function findOrCreateContact(customer) {
  const connected = await ensureConnected();
  if (!connected) throw new Error('Xero is not connected yet. Go to Admin > Xero Setup and connect first.');

  const existing = await xero.accountingApi.getContacts(
    tenantId,
    undefined, undefined, undefined, undefined, undefined, undefined,
    `EmailAddress="${customer.email}"`
  );

  if (existing.body.contacts && existing.body.contacts.length > 0) {
    return existing.body.contacts[0].contactID;
  }

  const created = await xero.accountingApi.createContacts(tenantId, {
    contacts: [{
      name: customer.fullName,
      firstName: customer.firstName,
      lastName: customer.lastName,
      emailAddress: customer.email,
      phones: customer.phone ? [{ phoneType: 'MOBILE', phoneNumber: customer.phone }] : undefined,
    }],
  });
  return created.body.contacts[0].contactID;
}

async function createInvoiceForBooking({ customer, booking, lineItems, sendEmail = true, accountCode }) {
  const connected = await ensureConnected();
  if (!connected) throw new Error('Xero is not connected yet. Go to Admin > Xero Setup and connect first.');

  const contactID = await findOrCreateContact(customer);

  const invoicePayload = {
    invoices: [{
      type: 'ACCREC',
      contact: { contactID },
      date: new Date().toISOString().slice(0, 10),
      dueDate: booking.date,
      lineAmountTypes: 'Exclusive',
      reference: `Booking #${booking.id}`,
      status: 'AUTHORISED',
      lineItems: lineItems.map((li) => ({
        description: li.description,
        quantity: li.quantity,
        unitAmount: li.unitAmount,
        accountCode: accountCode || process.env.XERO_DEFAULT_ACCOUNT_CODE || '200',
      })),
    }],
  };

  const result = await xero.accountingApi.createInvoices(tenantId, invoicePayload);
  const invoice = result.body.invoices[0];

  if (sendEmail) {
    await xero.accountingApi.emailInvoice(tenantId, invoice.invoiceID, {});
  }

  return invoice;
}

module.exports = {
  isConfigured,
  getConsentUrl,
  handleCallback,
  ensureConnected,
  getStatus,
  disconnect,
  createInvoiceForBooking,
};

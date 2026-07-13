// xero.js — handles the Xero OAuth2 connection and invoice creation/emailing.
const { XeroClient } = require('xero-node');
const db = require('./db');

const SCOPES = 'openid profile email accounting.settings.read accounting.invoices accounting.invoices.read accounting.contacts accounting.contacts.read offline_access'.split(' ');

function envConfig() {
  return {
    clientId: process.env.XERO_CLIENT_ID || '',
    clientSecret: process.env.XERO_CLIENT_SECRET || '',
    redirectUri: process.env.XERO_REDIRECT_URI || '',
  };
}

function storedConfig() {
  const saved = db.getXeroConfig() || {};
  return {
    clientId: saved.clientId || '',
    clientSecret: saved.clientSecret || '',
    redirectUri: saved.redirectUri || '',
  };
}

function getConfig() {
  const env = envConfig();
  const stored = storedConfig();
  return {
    clientId: env.clientId || stored.clientId,
    clientSecret: env.clientSecret || stored.clientSecret,
    redirectUri: env.redirectUri || stored.redirectUri,
    source: env.clientId && env.clientSecret ? 'environment' : (stored.clientId && stored.clientSecret ? 'admin' : 'missing'),
  };
}

function withRedirect(redirectUri) {
  const config = getConfig();
  if (redirectUri) config.redirectUri = redirectUri;
  return config;
}

function isConfigured(redirectUri) {
  const config = withRedirect(redirectUri);
  return !!(config.clientId && config.clientSecret && config.redirectUri);
}

function createClient(config = getConfig()) {
  return new XeroClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUris: [config.redirectUri],
    scopes: SCOPES,
  });
}

function publicConfig(redirectUri) {
  const config = withRedirect(redirectUri);
  return {
    configured: isConfigured(redirectUri),
    source: config.source,
    redirectUri: config.redirectUri || redirectUri || null,
    clientIdLast4: config.clientId ? config.clientId.slice(-4) : null,
    hasClientSecret: !!config.clientSecret,
    envLocked: !!(process.env.XERO_CLIENT_ID || process.env.XERO_CLIENT_SECRET || process.env.XERO_REDIRECT_URI),
  };
}

function saveConfig({ clientId, clientSecret, redirectUri }) {
  const current = storedConfig();
  const next = {
    clientId: (clientId || current.clientId || '').trim(),
    clientSecret: (clientSecret || current.clientSecret || '').trim(),
    redirectUri: (redirectUri || current.redirectUri || '').trim(),
    updatedAt: new Date().toISOString(),
  };
  if (!next.clientId || !next.clientSecret || !next.redirectUri) {
    throw new Error('Xero Client ID, Client Secret, and Redirect URI are required.');
  }
  db.saveXeroConfig(next);
  // Existing OAuth tokens belong to the previous app config, so clear them when config changes.
  db.saveXeroTokens(null);
  return publicConfig(next.redirectUri);
}

async function getConsentUrl(redirectUri) {
  const config = withRedirect(redirectUri);
  if (!isConfigured(config.redirectUri)) {
    throw new Error('Xero is not configured yet. Save your Xero Client ID, Client Secret, and Redirect URI first.');
  }
  return createClient(config).buildConsentUrl();
}

async function handleCallback(callbackUrl, redirectUri) {
  const config = withRedirect(redirectUri);
  if (!isConfigured(config.redirectUri)) throw new Error('Xero is not configured yet.');
  const client = createClient(config);
  const tokenSet = await client.apiCallback(callbackUrl);
  await client.updateTenants();
  const tenant = client.tenants[0];
  db.saveXeroTokens({
    tokenSet,
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
    connectedAt: new Date().toISOString(),
  });
  return tenant;
}

async function ensureConnected() {
  const saved = db.getXeroTokens();
  if (!saved) return { connected: false };
  const config = getConfig();
  if (!isConfigured(config.redirectUri)) return { connected: false };
  const client = createClient(config);
  client.setTokenSet(saved.tokenSet);
  let tokenSet = saved.tokenSet;

  const expiresAt = tokenSet.expires_at ? tokenSet.expires_at * 1000 : 0;
  if (Date.now() > expiresAt - 60_000) {
    if (!tokenSet.refresh_token) {
      db.saveXeroTokens(null);
      throw new Error('Xero connection expired and cannot be refreshed. Reconnect Xero from Admin > Xero Setup.');
    }
    // xero-node's refreshToken() depends on its OpenID client being initialized.
    // apiCallback() initializes it during OAuth, but a fresh server process restoring
    // saved tokens from DB does not. Use refreshWithRefreshToken so production restarts
    // can refresh persisted tokens safely.
    tokenSet = await client.refreshWithRefreshToken(config.clientId, config.clientSecret, tokenSet.refresh_token);
    db.saveXeroTokens({ ...saved, tokenSet });
    client.setTokenSet(tokenSet);
  }
  return { connected: true, client, tenantId: saved.tenantId, saved };
}

function getStatus(redirectUri) {
  const saved = db.getXeroTokens();
  return {
    ...publicConfig(redirectUri),
    connected: !!saved,
    tenantName: saved ? saved.tenantName : null,
    connectedAt: saved ? saved.connectedAt : null,
  };
}

function disconnect() {
  db.saveXeroTokens(null);
}

function clearConfig() {
  db.saveXeroTokens(null);
  db.saveXeroConfig(null);
}

async function findOrCreateContact(customer) {
  const conn = await ensureConnected();
  if (!conn.connected) throw new Error('Xero is not connected yet. Go to Admin > Xero Setup and connect first.');

  const existing = await conn.client.accountingApi.getContacts(
    conn.tenantId,
    undefined, undefined, undefined, undefined, undefined, undefined,
    `EmailAddress="${customer.email}"`
  );

  if (existing.body.contacts && existing.body.contacts.length > 0) {
    return { contactID: existing.body.contacts[0].contactID, client: conn.client, tenantId: conn.tenantId };
  }

  const created = await conn.client.accountingApi.createContacts(conn.tenantId, {
    contacts: [{
      name: customer.fullName,
      firstName: customer.firstName,
      lastName: customer.lastName,
      emailAddress: customer.email,
      phones: customer.phone ? [{ phoneType: 'MOBILE', phoneNumber: customer.phone }] : undefined,
    }],
  });
  return { contactID: created.body.contacts[0].contactID, client: conn.client, tenantId: conn.tenantId };
}

function normalizeLineAmountType(value) {
  const raw = String(value || process.env.XERO_LINE_AMOUNT_TYPES || 'Inclusive').trim().toLowerCase();
  if (raw === 'exclusive') return 'Exclusive';
  if (raw === 'notax' || raw === 'no_tax' || raw === 'no tax') return 'NoTax';
  return 'Inclusive';
}

function defaultTaxType(lineAmountTypes) {
  if (process.env.XERO_DEFAULT_TAX_TYPE) return process.env.XERO_DEFAULT_TAX_TYPE.trim();
  if (lineAmountTypes === 'NoTax') return 'NONE';
  return 'OUTPUT2'; // South African output VAT in Xero's standard chart; override with XERO_DEFAULT_TAX_TYPE if needed.
}

function buildInvoicePayload({ contactID, booking, lineItems, accountCode, lineAmountTypes }) {
  const resolvedLineAmountTypes = normalizeLineAmountType(lineAmountTypes);
  const fallbackAccountCode = accountCode || process.env.XERO_DEFAULT_ACCOUNT_CODE || '200';
  const fallbackTaxType = defaultTaxType(resolvedLineAmountTypes);

  return {
    invoices: [{
      type: 'ACCREC',
      contact: { contactID },
      date: new Date().toISOString().slice(0, 10),
      dueDate: booking.date,
      lineAmountTypes: resolvedLineAmountTypes,
      reference: `Booking #${booking.id}`,
      status: 'AUTHORISED',
      lineItems: lineItems.map((li) => {
        const payload = {
          description: li.description,
          quantity: li.quantity,
          unitAmount: li.unitAmount,
          accountCode: li.accountCode || fallbackAccountCode,
          taxType: li.taxType || fallbackTaxType,
        };
        if (li.itemCode) payload.itemCode = li.itemCode;
        return payload;
      }),
    }],
  };
}

async function createInvoiceForBooking({ customer, booking, lineItems, sendEmail = true, accountCode, lineAmountTypes }) {
  const { contactID, client, tenantId } = await findOrCreateContact(customer);

  const invoicePayload = buildInvoicePayload({ contactID, booking, lineItems, accountCode, lineAmountTypes });

  const result = await client.accountingApi.createInvoices(tenantId, invoicePayload);
  const invoice = result.body.invoices[0];

  if (sendEmail) {
    await client.accountingApi.emailInvoice(tenantId, invoice.invoiceID, {});
  }

  return invoice;
}

module.exports = {
  isConfigured,
  getConsentUrl,
  handleCallback,
  ensureConnected,
  getStatus,
  saveConfig,
  clearConfig,
  disconnect,
  buildInvoicePayload,
  createInvoiceForBooking,
};

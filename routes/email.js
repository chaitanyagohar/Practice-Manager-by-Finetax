const express = require('express');
const nodemailer = require('nodemailer');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const store = require('../db/store');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// ADDED ASYNC
async function getSmtpTransport() {
  const s = await store.findById('settings', 'firm') || {};
  if (!s.smtpHost || !s.smtpUser || !s.smtpPass) return null;
  return nodemailer.createTransport({
    host: s.smtpHost,
    port: Number(s.smtpPort) || 587,
    secure: !!s.smtpSecure,
    auth: { user: s.smtpUser, pass: s.smtpPass },
  });
}

router.post('/send-invoice/:invoiceId', async (req, res) => {
  const invoice = await store.findById('invoices', req.params.invoiceId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  
  const client = await store.findById('clients', invoice.clientId);
  const toAddress = req.body.to || (client && client.email);
  if (!toAddress) return res.status(400).json({ error: "No recipient email address — add one to the client record or provide one directly." });

  const transporter = await getSmtpTransport();
  if (!transporter) {
    return res.status(400).json({
      error: 'Email sending is not set up yet. Add your SMTP host, username and password in Firm Settings first.',
    });
  }

  const settings = await store.findById('settings', 'firm') || {};
  const buildInvoicePdf = require('./invoices').buildInvoicePdfBuffer;
  let pdfBuffer;
  try {
    pdfBuffer = await buildInvoicePdf(invoice, client, settings);
  } catch (e) {
    return res.status(500).json({ error: 'Could not generate the invoice PDF: ' + e.message });
  }

  try {
    await transporter.sendMail({
      from: `"${settings.smtpFromName || settings.firmName || 'Practice'}" <${settings.smtpUser}>`,
      to: toAddress,
      subject: `Invoice ${invoice.invoiceNumber} from ${settings.firmName || 'us'}`,
      text: req.body.message || `Please find attached invoice ${invoice.invoiceNumber} for ${formatAmountPlain(invoice.total)}.\n\nRegards,\n${settings.firmName || ''}`,
      attachments: [{ filename: `${invoice.invoiceNumber.replace(/\//g, '-')}.pdf`, content: pdfBuffer }],
    });
  } catch (e) {
    return res.status(500).json({ error: 'Sending failed: ' + e.message });
  }

  const sentLog = Array.isArray(invoice.sentLog) ? invoice.sentLog : [];
  sentLog.push({ to: toAddress, at: new Date().toISOString(), by: req.session.name || 'Unknown' });
  const patch = { sentLog };
  if (invoice.status === 'Draft') patch.status = 'Sent';
  const updated = await store.update('invoices', invoice.id, patch);

  res.json({ ok: true, invoice: updated });
});

function formatAmountPlain(n) {
  return 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

router.post('/test-smtp', requireRole('admin'), async (req, res) => {
  const transporter = await getSmtpTransport();
  if (!transporter) return res.status(400).json({ error: 'Enter and save SMTP host, username and password first.' });
  try {
    await transporter.verify();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: 'Could not connect: ' + e.message });
  }
});

router.get('/inbox/:clientId', async (req, res) => {
  const client = await store.findById('clients', req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!client.email) return res.status(400).json({ error: 'This client has no email address on file, so there is nothing to match against.' });

  const s = await store.findById('settings', 'firm') || {};
  if (!s.imapHost || !s.imapUser || !s.imapPass) {
    return res.status(400).json({
      error: 'Email inbox is not set up yet. Add your IMAP host, username and password in Firm Settings first.',
    });
  }

  const config = {
    imap: {
      user: s.imapUser,
      password: s.imapPass,
      host: s.imapHost,
      port: Number(s.imapPort) || 993,
      tls: s.imapTls !== false,
      authTimeout: 10000,
      tlsOptions: { rejectUnauthorized: false },
    },
  };

  let connection;
  try {
    connection = await imaps.connect(config);
    await connection.openBox('INBOX');
    const searchCriteria = [['FROM', client.email]];
    const fetchOptions = { bodies: [''], markSeen: false, struct: true };
    const results = await connection.search(searchCriteria, fetchOptions);

    const recent = results.slice(-25).reverse();
    const emails = await Promise.all(recent.map(async (item) => {
      const raw = item.parts.find((p) => p.which === '')?.body || '';
      const parsed = await simpleParser(raw);
      return {
        subject: parsed.subject || '(no subject)',
        from: parsed.from?.text || client.email,
        date: parsed.date ? parsed.date.toISOString() : null,
        snippet: (parsed.text || '').slice(0, 300),
      };
    }));

    res.json({ clientId: client.id, clientEmail: client.email, emails });
  } catch (e) {
    res.status(500).json({ error: 'Could not read the inbox: ' + e.message });
  } finally {
    if (connection) connection.end();
  }
});

module.exports = router;
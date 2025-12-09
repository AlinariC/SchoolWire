import express from 'express';
import morgan from 'morgan';
import { v4 as uuid } from 'uuid';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(morgan('dev'));

const contacts = new Map();
const templates = [
  {
    id: 'snow-day',
    name: 'Snow Day – All schools closed.',
    sms: 'School closed today due to weather. Stay safe.',
    voice: 'This is the district calling: School is closed today due to weather. Please check email for details.',
    emailSubject: 'Snow Day – All Schools Closed',
    emailBody: 'All schools are closed today. Buses will not run. We will update you with reopening details.'
  },
  {
    id: 'late-start',
    name: '2-Hour Late Start – Bus routes shifted.',
    sms: 'Two-hour late start today. Buses will run two hours later than usual.',
    voice: 'This is the district calling: We are on a two-hour late start today. Buses will run two hours later than normal.',
    emailSubject: 'Two-Hour Late Start',
    emailBody: 'We are on a two-hour late start today. School begins two hours later than normal and buses run accordingly.'
  },
  {
    id: 'school-closure',
    name: 'School-specific closure: [School Name].',
    sms: 'Closure notice for your student\'s school. Check email for details.',
    voice: 'This is the district calling about a school-specific closure. Please check your email for school-specific details.',
    emailSubject: 'School-Specific Closure',
    emailBody: 'A school-specific closure is in effect. Please review the attached details for your student\'s school.'
  }
];

const events = [];
const messageLog = [];

function upsertContact(contact) {
  const id = contact.id || uuid();
  const merged = { ...contacts.get(id), ...contact, id };
  contacts.set(id, merged);
  return merged;
}

function filterAudience(filters = {}) {
  return Array.from(contacts.values()).filter((contact) => {
    if (filters.school && contact.school !== filters.school) return false;
    if (filters.grade && contact.grade !== filters.grade) return false;
    if (filters.busRoute && contact.busRoute !== filters.busRoute) return false;
    if (filters.flag && contact.flags?.[filters.flag] !== true) return false;
    return true;
  });
}

function enqueueMessages({ eventId, recipients, channels, template, overrides }) {
  const now = new Date().toISOString();
  recipients.forEach((recipient) => {
    const consent = recipient.telephoneConsent === true;
    channels.forEach((channel) => {
      if (channel === 'sms' && (!recipient.phone || recipient.optOutSMS)) return;
      if (channel === 'voice' && (!recipient.phone || !consent)) return;
      if (channel === 'email' && !recipient.email) return;

      const logEntry = {
        id: uuid(),
        eventId,
        recipientId: recipient.id,
        channel,
        providerMessageId: `${channel}-${uuid()}`,
        status: 'queued',
        answered: null,
        createdAt: now,
        updatedAt: now,
        content: buildContent(template, overrides, channel)
      };
      messageLog.push(logEntry);
    });
  });
}

function buildContent(template, overrides = {}, channel) {
  if (channel === 'sms') return overrides.sms || template.sms;
  if (channel === 'voice') return overrides.voice || template.voice;
  return {
    subject: overrides.emailSubject || template.emailSubject,
    body: overrides.emailBody || template.emailBody
  };
}

function summarizeEvent(eventId) {
  const logs = messageLog.filter((log) => log.eventId === eventId);
  const totals = logs.reduce(
    (acc, log) => {
      acc.total += 1;
      acc.byStatus[log.status] = (acc.byStatus[log.status] || 0) + 1;
      return acc;
    },
    { total: 0, byStatus: {} }
  );
  return { total: totals.total, byStatus: totals.byStatus };
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/contacts/synergy-import', (req, res) => {
  const payload = Array.isArray(req.body) ? req.body : [];
  const saved = payload.map((contact) => upsertContact(contact));
  res.status(201).json({ imported: saved.length });
});

app.get('/api/templates', (_req, res) => {
  res.json({ templates });
});

app.post('/api/events', (req, res) => {
  const { templateId, audience = {}, overrides = {}, scheduledFor } = req.body;
  const template = templates.find((item) => item.id === templateId);
  if (!template) return res.status(400).json({ error: 'Unknown templateId' });

  const event = {
    id: uuid(),
    templateId,
    audience,
    overrides,
    scheduledFor: scheduledFor || new Date().toISOString(),
    createdAt: new Date().toISOString()
  };
  events.push(event);
  res.status(201).json({ event });
});

app.post('/api/events/:id/send', (req, res) => {
  const event = events.find((item) => item.id === req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const channels = req.body.channels || ['sms', 'voice', 'email'];
  const recipients = filterAudience(event.audience);
  const template = templates.find((item) => item.id === event.templateId);

  enqueueMessages({
    eventId: event.id,
    recipients,
    channels,
    template,
    overrides: event.overrides
  });

  res.json({ queued: messageLog.filter((log) => log.eventId === event.id).length });
});

app.get('/api/events/:id/report', (req, res) => {
  const event = events.find((item) => item.id === req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json({ event, summary: summarizeEvent(event.id) });
});

app.get('/api/recipients/:id/logs', (req, res) => {
  const logs = messageLog.filter((log) => log.recipientId === req.params.id);
  res.json({ logs });
});

app.post('/twilio/callback', (req, res) => {
  const { providerMessageId, status, answered } = req.body;
  const log = messageLog.find((entry) => entry.providerMessageId === providerMessageId);
  if (!log) return res.status(404).json({ error: 'Log not found' });
  log.status = status || log.status;
  log.answered = answered ?? log.answered;
  log.updatedAt = new Date().toISOString();
  res.json({ ok: true });
});

app.post('/email/callback', (req, res) => {
  const { providerMessageId, status } = req.body;
  const log = messageLog.find((entry) => entry.providerMessageId === providerMessageId);
  if (!log) return res.status(404).json({ error: 'Log not found' });
  log.status = status || log.status;
  log.updatedAt = new Date().toISOString();
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`SchoolWire notification app running on port ${port}`);
});

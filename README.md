# SchoolWire

SchoolWire is a lightweight notification portal for school districts. It pulls contact data from Synergy, lets authorized staff send multi-channel alerts (voice, SMS, email), and tracks delivery outcomes for audits and compliance.

## Features
- **Data intake:** Import parent/guardian contact data from Synergy SFTP exports or API into a single Contacts table.
- **Messaging engine:** Queue SMS/voice via Twilio (or similar) and email via SMTP2GO, keeping provider message IDs for callbacks.
- **Notification portal:** Simple authenticated experience where staff choose a template, audience, channels, and timing before sending.
- **Tracking & reporting:** Delivery log per event and per recipient, with webhook endpoints to keep statuses in sync.
- **Compliance:** FERPA-minded storage, opt-out handling, role-based access expectations, and audit logging of who sent what.

## Quick start
1. Install dependencies (Node.js 18+):
   ```bash
   npm install
   npm start
   ```
   The server listens on `http://localhost:3000` by default.

2. Health check:
   ```bash
   curl http://localhost:3000/health
   ```

## Configuration
Environment variables you will need in a real deployment:
- `PORT`: Server port (defaults to `3000`).
- `SYNERGY_SFTP_*` or `SYNERGY_API_*`: Credentials for nightly contact import.
- `TWILIO_*`: Account SID, auth token, from-numbers, webhook auth secret.
- `SMTP2GO_*`: SMTP credentials or API token, webhook auth secret.
- `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`: For Entra ID SSO (to be wired into your real auth layer).

## API overview
The current app uses in-memory storage to illustrate the workflow. Replace these with your database and provider SDK calls when you integrate.

### Import contacts (Synergy)
```http
POST /api/contacts/synergy-import
[
  {
    "id": "guardian-1",
    "name": "Carey Parent",
    "email": "carey@example.org",
    "phone": "+15035550100",
    "school": "Central High",
    "grade": "11",
    "busRoute": "B12",
    "flags": { "transportation": true },
    "telephoneConsent": true,
    "optOutSMS": false
  }
]
```
- Run nightly after pulling Synergy exports. Use `telephoneConsent` to prevent autodialing numbers without permission.
- Respect provider-managed opt-outs (e.g., Twilio STOP) by updating `optOutSMS`.

### List templates
```http
GET /api/templates
```
Returns built-in scenarios like snow day, late start, and school-specific closures.

### Create an event
```http
POST /api/events
{
  "templateId": "snow-day",
  "audience": { "school": "Central High" },
  "overrides": {
    "sms": "Central High closed today due to weather.",
    "emailSubject": "Central High closed",
    "emailBody": "Central High is closed today. Buses will not run."
  },
  "scheduledFor": "2024-12-20T12:00:00Z"
}
```
Audiences can be narrowed by `school`, `grade`, `busRoute`, or a flag key (e.g., `transportation`).

### Send an event
```http
POST /api/events/{eventId}/send
{
  "channels": ["sms", "voice", "email"]
}
```
Queues messages for the event audience. Voice requires `telephoneConsent=true` and skips contacts missing required channel data.

### Reporting
- **Event summary:** `GET /api/events/{eventId}/report` → `{ total, byStatus }` counts.
- **Recipient history:** `GET /api/recipients/{recipientId}/logs` → per-contact delivery history.

### Webhooks
- `POST /twilio/callback` with `{ providerMessageId, status, answered }`
- `POST /email/callback` with `{ providerMessageId, status }`

These endpoints update the message log so the UI reflects delivered/failed/voicemail statuses.

## Next steps for production
- Swap in a real database schema: `contacts`, `events`, `message_logs`, and `audit_logs` with indexed foreign keys.
- Add Entra ID SSO middleware and role-based authorization (e.g., only district office can send all-district alerts).
- Wire provider SDKs (Twilio, SMTP2GO) and secure webhooks with signatures or shared secrets.
- Schedule nightly Synergy imports (cron/KEDA/Cloud Scheduler) and add reconciliation for STOP/opt-outs.
- Export CSV/PDF reports for board packets and audits.

No logos or placeholder imagery are included—this repo focuses on backend workflow and documentation.

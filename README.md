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

## One-step install on Fedora (with Apache)
For a full setup behind Apache on Fedora, run the installer script and answer the prompts:

```bash
chmod +x install.sh
./install.sh
```

The script will:
- Install Node.js, npm, git, and Apache (`httpd`) via `dnf`.
- Prompt for all SchoolWire environment variables (Synergy SFTP/API, Twilio, SMTP2GO, Entra ID, and the app port) and write `.env`.
- Ask for the public FQDN and generate `/etc/httpd/conf.d/schoolwire.conf` with proxying to the Node.js app.
- Enable SELinux proxying for Apache, open HTTP in `firewalld` when available, and enable/reload `httpd`.
- Install npm dependencies, create/enable a `schoolwire.service` systemd unit, and start the app.

After completion, verify with:

```bash
sudo systemctl status schoolwire.service
curl http://<your-fqdn-or-host>/health
```

## Deploy on an existing LAMP server
You can host SchoolWire alongside an existing Apache/PHP/MySQL stack by running the Node.js app behind Apache. The steps below assume Ubuntu/Debian and that you already have Apache (with `mod_proxy` and `mod_proxy_http`) and MySQL installed.

1. Install Node.js 18+ and git:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs git
   ```

2. Clone the app (adjust path as needed):
   ```bash
   sudo mkdir -p /var/www/schoolwire
   sudo chown $(whoami) /var/www/schoolwire
   git clone https://github.com/your-org/SchoolWire.git /var/www/schoolwire
   cd /var/www/schoolwire
   ```

3. Configure environment (create `.env`):
   ```bash
   cat > .env <<'EOF'
   PORT=3000
   # Synergy/Twilio/SMTP2GO/Entra variables go here
   EOF
   ```
   If you plan to connect to MySQL later, add your DSN credentials; by default the app uses in-memory storage.

4. Install dependencies and start the service:
   ```bash
   npm install
   npm start
   ```
   You should see the server listening on port 3000. For long-running use, wrap this in a process manager such as `pm2` or a `systemd` unit.

5. Add an Apache reverse proxy so users can reach the app on your existing site (replace `schoolwire.example.org` with your host):
   ```apache
   <VirtualHost *:80>
     ServerName schoolwire.example.org
     ProxyPreserveHost On
     ProxyPass / http://127.0.0.1:3000/
     ProxyPassReverse / http://127.0.0.1:3000/
   </VirtualHost>
   ```
   Enable the site and reload Apache:
   ```bash
   sudo a2enmod proxy proxy_http
   sudo a2ensite schoolwire.conf
   sudo systemctl reload apache2
   ```

6. Verify through Apache:
   ```bash
   curl -I http://schoolwire.example.org/health
   ```
   You should receive `200 OK`. If you use HTTPS, add TLS directives (or run `certbot --apache`) in the VirtualHost.

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

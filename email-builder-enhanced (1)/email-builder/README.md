# Email Builder — Self-Hosted on GitHub Pages

A complete email-building platform hosted on GitHub Pages. Build professional HTML/CSS emails, embed images, attach files, preview, and send through your own Gmail via Google Apps Script.

**The platform never sends emails. All sending happens through your own deployed Google Apps Script.**

---

## Architecture

```
User → Platform (GitHub Pages) → User's Apps Script → User's Gmail → Recipient
```

- You own the Gmail
- You own the Apps Script
- You own the sending quota and history
- The platform only helps you build and trigger sends

---

## Modules

### Module 1 — Registration + Apps Script Generator (`index.html`)

1. Enter your Gmail address
2. Click **Generate**
3. Platform generates SHA256 of your email + a complete, deployment-ready Apps Script
4. Copy the script and deploy it on [script.google.com](https://script.google.com)
5. Note your **Web App URL** and **Script ID**

### Module 2 — Email Builder + Sender (`builder.html`)

1. Configure account: From Email + Apps Script URL + Script ID
2. Compose: TO / CC / BCC / Subject / Text Description
3. Bucket (Webpage Builder Area): Add HTML + CSS + Images → builds webpage-like content
4. Throw bucket items to the Stack Container
5. Stack Container: Arrange modules (Edit / Move / Delete / Drag-Drop)
6. Preview → Submit → Send
7. Apps Script triggers, verifies ownership (SHA256), sends email
8. Sent Emails module: browse all sent records with full delivery details

---

## Deployment (GitHub Pages)

1. Clone or download this repository
2. Push to a GitHub repository
3. Go to **Settings → Pages**
4. Set Source to `main` branch, `/ (root)` folder
5. Click **Save**
6. Your site is live at `https://yourusername.github.io/repo-name/`

No build step required — pure HTML/CSS/JS.

---

## Apps Script Deployment

After generating your script in Module 1:

1. Open [script.google.com](https://script.google.com)
2. Create a New Project
3. Paste the generated code (replace all existing code)
4. Save (`Ctrl+S`)
5. Click **Deploy → New Deployment**
6. Type: **Web App**
7. Execute as: **Me**
8. Who has access: **Anyone**
9. Click **Deploy**, authorize permissions
10. Copy the **Web App URL** → use as "Apps Script URL" in Module 2
11. Copy the **Script ID** from the project URL → use as "Apps Script ID" in Module 2

---

## Security Model

- SHA256 of your registered email is embedded inside your Apps Script
- On every send, Apps Script verifies: `SHA256(fromEmail) === storedHash`
- If verification fails: request is rejected, no email sent
- If verification passes: working process executes

---

## Features

- **Bucket (Webpage Builder)**: HTML, CSS, Images (embedded inline), Files (attached)
- **Stack Container**: Visual email construction — drag-drop, move up/down, edit, delete
- **Preview**: Live from current Stack state only — never from bucket or hidden state
- **Duplicate Detection**: Case-insensitive duplicate email detection across TO/CC/BCC
- **Image Rule**: jpg/jpeg/png/gif/webp → embedded inline in email body
- **Attachment Rule**: pdf/docx/pptx/xlsx/zip/txt → email attachments
- **Multiple Recipients**: 3-second delay between sends (in Apps Script)
- **Sent Emails Module**: Full inspection — TO/CC/BCC/Subject/Status/How It Was Sent/Preview
- **State Transitions**: Compose → Send → Sent (compose entry removed, moved to Sent)

---

## File Structure

```
email-builder/
├── index.html          Module 1: Registration + Apps Script Generator
├── builder.html        Module 2: Email Builder + Sender
├── css/
│   └── styles.css      All styles
├── js/
│   ├── sha256.js       SHA-256 (Web Crypto API + pure JS fallback)
│   ├── module1.js      Registration + script generation logic
│   └── module2.js      Email builder: bucket, stack, preview, send, sent
└── README.md
```

---

## Browser Support

- Chrome 80+, Firefox 75+, Edge 80+, Safari 14+
- Requires JavaScript enabled
- Uses Web Crypto API for SHA-256 (falls back to pure JS implementation)
- Uses localStorage for account config and sent email history

---

## Local Development

No build step. Open directly in browser:

```bash
# Option 1: Simple HTTP server
python3 -m http.server 8080
# Then open http://localhost:8080

# Option 2: VS Code Live Server extension
# Right-click index.html → Open with Live Server
```

---

## Notes

- Sent email history is stored in browser localStorage
- Apps Script history is stored in Google Apps Script Properties (server-side)
- The platform is entirely client-side — no data is sent to any server other than your own Apps Script

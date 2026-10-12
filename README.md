# 📲 Buy&Sell TKMCE — WhatsApp Notification Microservice

A dedicated, lightweight microservice powered by `whatsapp-web.js` that sends automated WhatsApp notifications (e.g., *"An agent will contact you within 24 hours"*) to buyers when they express interest in a listing.

---

## 🚀 Features

- 📱 **100% Free** — Uses `whatsapp-web.js` with zero per-message API fees.
- 🌐 **Web QR Code Viewer (`/qr`)** — Scan the QR code directly from your mobile camera by visiting the web page.
- 🛡️ **Protected Endpoints** — All outgoing message requests require `WHATSAPP_SERVICE_SECRET`.
- 🩺 **Health Check (`/health`)** — Keep-alive endpoint to prevent Render free tier from sleeping.
- 📦 **Docker-Ready** — Includes `Dockerfile` with pre-installed Chromium for 1-click cloud deployment.

---

## 🛠️ Local Development

### 1. Install Dependencies
```bash
cd whatsapp-service
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```env
PORT=5001
WHATSAPP_SERVICE_SECRET=buysell_super_secret_whatsapp_key_2026
SESSION_DATA_PATH=./.wwebjs_auth
```

### 3. Run the Microservice
```bash
npm start
```

### 4. Link WhatsApp
- Terminal will display a QR code.
- Alternatively, open **`http://localhost:5001/qr`** in your browser.
- Open **WhatsApp** on your phone > **Linked Devices** > **Link a Device** and scan the QR code.
- Once connected, you will see `✅ WhatsApp Client is READY!`

---

## 📡 API Endpoints

### 1. Health Check
`GET /health`
Returns connection status and logged-in account details.

### 2. Send Buyer Notification
`POST /api/notify-buyer`
Headers:
```http
Authorization: Bearer buysell_super_secret_whatsapp_key_2026
Content-Type: application/json
```
Body:
```json
{
  "buyerPhone": "9876543210",
  "buyerName": "Rahul Sharma",
  "listingTitle": "S3 ME Engineering Drawing Board",
  "price": 450
}
```

---

## ☁️ Deploying to Render (Free Tier)

1. Push this folder to a GitHub repository.
2. In [Render Dashboard](https://dashboard.render.com/), click **New +** > **Web Service**.
3. Connect your repository.
4. Select **Docker** environment (it automatically detects `Dockerfile`).
5. Set Environment Variables:
   - `PORT` = `5001`
   - `WHATSAPP_SERVICE_SECRET` = `your_secure_random_key`
6. Click **Deploy Web Service**.
7. Once deployed, open `https://your-service.onrender.com/qr` on your mobile phone to scan the QR code!
8. To keep it awake 24/7 on free tier, add a free 10-minute ping on [Cron-job.org](https://cron-job.org) pointing to `https://your-service.onrender.com/health`.

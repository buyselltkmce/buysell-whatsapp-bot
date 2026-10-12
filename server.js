import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pino from 'pino';
import QRCode from 'qrcode';
import { MongoClient } from 'mongodb';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  Browsers
} from 'baileys';
import { useMongoAuthState } from './mongoAuthState.js';

dotenv.config();

// Crash prevention
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason?.stack || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.stack || err);
});

// Periodic lightweight memory logger
setInterval(() => {
  const mb = (n) => Math.round(n / 1024 / 1024);
  const m = process.memoryUsage();
  console.log(`[memory] rss=${mb(m.rss)}MB heap=${mb(m.heapUsed)}MB`);
}, 60000);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5001;
const API_SECRET = process.env.WHATSAPP_SERVICE_SECRET || 'buysell_super_secret_whatsapp_key_2026';

// State management
let sock = null;
let isReady = false;
let latestQr = null;
let qrDataUrl = null;
let connectedUser = null;
let lastError = null;

// Phone number formatter for WhatsApp JID
const formatPhoneJid = (rawPhone) => {
  if (!rawPhone) return null;
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits || digits.length < 10) return null;
  const fullPhone = digits.length === 10 ? `91${digits}` : digits;
  return `${fullPhone}@s.whatsapp.net`;
};

// API Key Authentication Middleware
const requireApiKey = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const providedKey = (authHeader && authHeader.startsWith('Bearer '))
    ? authHeader.split(' ')[1]
    : req.headers['x-api-key'] || req.body.apiKey;

  if (!providedKey || providedKey !== API_SECRET) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing API secret'
    });
  }
  next();
};

// ================= BAILEYS INITIALIZATION ================= //

async function initWhatsApp() {
  try {
    let authState;
    let saveCreds;

    // Use MongoDB auth if MONGO_URI is set (ideal for Render free tier!)
    if (process.env.MONGO_URI) {
      console.log('📦 Connecting to MongoDB for persistent WhatsApp session...');
      const mongoClient = new MongoClient(process.env.MONGO_URI);
      await mongoClient.connect();
      const db = mongoClient.db('buysell_whatsapp');
      const collection = db.collection('auth_sessions');
      const mongoAuth = await useMongoAuthState(collection);
      authState = mongoAuth.state;
      saveCreds = mongoAuth.saveCreds;
      console.log('✅ MongoDB session store connected!');
    } else {
      console.log('📁 Using local file-based auth state...');
      const fileAuth = await useMultiFileAuthState(process.env.SESSION_DATA_PATH || './.baileys_auth');
      authState = fileAuth.state;
      saveCreds = fileAuth.saveCreds;
    }

    console.log('🚀 Initializing Baileys WhatsApp socket...');

    sock = makeWASocket({
      auth: authState,
      logger: pino({ level: 'silent' }),
      browser: Browsers.ubuntu('Chrome'),
      printQRInTerminal: true,
      syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        latestQr = qr;
        try {
          qrDataUrl = await QRCode.toDataURL(qr, { scale: 8, margin: 2 });
          console.log(`⚡ New QR code ready. Visit http://localhost:${PORT}/qr`);
        } catch (e) {
          console.error('Failed to generate QR data URL:', e);
        }
      }

      if (connection === 'open') {
        isReady = true;
        latestQr = null;
        qrDataUrl = null;
        connectedUser = sock.user;
        lastError = null;
        console.log(`\n=================================================`);
        console.log(`✅ WhatsApp Connected successfully via Baileys!`);
        console.log(`📱 Logged in as: ${connectedUser?.name || 'Account'} (${connectedUser?.id?.split(':')[0] || 'Unknown'})`);
        console.log(`=================================================\n`);
      }

      if (connection === 'close') {
        isReady = false;
        connectedUser = null;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`⚠️ Connection closed. Status code: ${statusCode}. Reconnecting: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(initWhatsApp, 3000);
        } else {
          console.log('❌ Device logged out. Please re-link WhatsApp.');
          setTimeout(initWhatsApp, 5000);
        }
      }
    });

  } catch (err) {
    console.error('❌ Failed to initialize Baileys:', err);
    lastError = err.message;
    setTimeout(initWhatsApp, 5000);
  }
}

// Start WhatsApp
initWhatsApp();

// ================= ROUTES ================= //

/**
 * @route GET /health
 * @desc  Health check endpoint for Render keep-alive (Cron-job.org / UptimeRobot)
 */
app.get('/health', (req, res) => {
  const mb = (n) => Math.round(n / 1024 / 1024);
  res.json({
    status: 'ok',
    engine: 'baileys',
    whatsappConnected: isReady,
    account: connectedUser ? { name: connectedUser.name, phone: connectedUser.id?.split(':')[0] } : null,
    hasQr: !!latestQr,
    memoryMb: mb(process.memoryUsage().rss),
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

/**
 * @route GET /qr
 * @desc  Web UI for scanning QR or linking with phone number
 */
app.get('/qr', (req, res) => {
  if (isReady) {
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>WhatsApp Connected | Buy&Sell TKMCE</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0b141a; color: #e9edef; text-align: center; }
            .card { background: #111b21; padding: 40px; border-radius: 20px; border: 1px solid #222e35; max-width: 400px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            .badge { background: #00a884; color: white; padding: 6px 16px; border-radius: 20px; font-weight: bold; font-size: 14px; display: inline-block; margin-bottom: 16px; }
            h2 { margin: 0 0 10px 0; color: #fff; }
            p { color: #8696a0; margin: 0; line-height: 1.5; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="badge">CONNECTED</div>
            <h2>WhatsApp is Ready</h2>
            <p>Engine: <strong>Baileys (Ultralight)</strong></p>
            <p style="margin-top: 10px;">Logged in as: <strong>${connectedUser?.name || 'Connected User'}</strong><br/>(${connectedUser?.id?.split(':')[0] || ''})</p>
            <p style="margin-top: 20px; font-size: 12px; color: #00a884;">Active and listening for outgoing buyer alerts.</p>
          </div>
        </body>
      </html>
    `);
  }

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Link WhatsApp | Buy&Sell TKMCE</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0b141a; color: #e9edef; text-align: center; padding: 20px; box-sizing: border-box; }
          .card { background: #111b21; padding: 32px; border-radius: 24px; border: 1px solid #222e35; max-width: 440px; width: 100%; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
          h2 { margin: 0 0 8px 0; color: #fff; font-size: 22px; }
          p { color: #8696a0; font-size: 14px; margin: 0 0 20px 0; }
          .qr-box { background: white; padding: 12px; border-radius: 16px; display: inline-block; margin-bottom: 16px; min-width: 250px; min-height: 250px; }
          .qr-box img { display: block; width: 250px; height: 250px; }
          .placeholder { width: 250px; height: 250px; display: flex; align-items: center; justify-content: center; color: #555; font-size: 13px; font-weight: bold; }
          .method-box { background: #182229; padding: 18px; border-radius: 14px; text-align: left; margin-top: 18px; }
          .status-indicator { margin-top: 14px; font-size: 12px; color: #00a884; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px; }
          .pulse { width: 8px; height: 8px; background: #00a884; border-radius: 50%; animation: pulse 1.5s infinite; }
          @keyframes pulse { 0% { opacity: 0.3; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.2); } 100% { opacity: 0.3; transform: scale(0.9); } }
          .btn-refresh { margin-top: 14px; background: transparent; border: 1px solid #222e35; color: #8696a0; padding: 6px 14px; border-radius: 8px; font-size: 12px; cursor: pointer; }
          .btn-refresh:hover { color: #fff; border-color: #00a884; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Link WhatsApp Account</h2>
          <p>Powered by Baileys (Ultralight &amp; Fast)</p>
          
          <div class="qr-box">
            ${qrDataUrl ? `<img src="${qrDataUrl}" alt="WhatsApp QR Code" />` : `<div class="placeholder">Generating QR code...</div>`}
          </div>

          <div class="status-indicator">
            <span class="pulse"></span> Waiting for connection...
          </div>

          <div style="margin: 20px 0 14px 0; border-top: 1px solid #222e35; position: relative;">
            <span style="position: absolute; top: -10px; left: 50%; transform: translateX(-50%); background: #111b21; padding: 0 10px; color: #8696a0; font-size: 11px; text-transform: uppercase;">or link with phone number</span>
          </div>

          <div class="method-box">
            <h4 style="margin: 0 0 6px 0; color: #fff; font-size: 14px;">Link with Phone Number (Recommended)</h4>
            <p style="margin: 0 0 12px 0; font-size: 12px; color: #8696a0;">Works seamlessly for WhatsApp Business &amp; Personal.</p>
            
            <div style="display: flex; gap: 8px;">
              <input id="phone-input" type="tel" placeholder="e.g. 9876543210" style="flex: 1; background: #111b21; border: 1px solid #222e35; color: #fff; padding: 10px 12px; border-radius: 8px; font-size: 14px; outline: none;" />
              <button id="get-code-btn" onclick="requestPairingCode()" style="background: #00a884; color: #fff; border: none; padding: 10px 14px; border-radius: 8px; font-weight: bold; font-size: 13px; cursor: pointer;">Get Code</button>
            </div>

            <div id="code-result" style="display: none; margin-top: 14px; padding: 12px; background: #111b21; border: 1px dashed #00a884; border-radius: 10px; text-align: center;">
              <p style="margin: 0 0 4px 0; font-size: 11px; color: #8696a0;">Enter this 8-character code on WhatsApp:</p>
              <div id="code-display" style="font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #00a884;"></div>
              <p style="margin: 8px 0 0 0; font-size: 11px; color: #aebac1;">WhatsApp &gt; Linked Devices &gt; Link a Device &gt; <em>Link with phone number instead</em></p>
            </div>
          </div>

          <button class="btn-refresh" onclick="location.reload()">🔄 Refresh Page</button>
        </div>

        <script>
          async function requestPairingCode() {
            const phone = document.getElementById('phone-input').value.trim();
            if (!phone) return alert('Please enter your 10-digit WhatsApp number');
            
            const btn = document.getElementById('get-code-btn');
            btn.innerText = 'Requesting...';
            btn.disabled = true;

            try {
              const res = await fetch('/api/pair-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone })
              });
              const data = await res.json();
              if (data.success && data.code) {
                document.getElementById('code-result').style.display = 'block';
                document.getElementById('code-display').innerText = data.code;
                btn.innerText = 'Done!';
              } else {
                alert(data.error || 'Failed to get pairing code');
                btn.innerText = 'Try Again';
                btn.disabled = false;
              }
            } catch (e) {
              alert('Error: ' + e.message);
              btn.innerText = 'Try Again';
              btn.disabled = false;
            }
          }

          // Auto-reload to connected screen when linked
          setInterval(async () => {
            try {
              const res = await fetch('/health');
              const data = await res.json();
              if (data.whatsappConnected) {
                location.reload();
              }
            } catch (e) {}
          }, 3000);
        </script>
      </body>
    </html>
  `);
});

/**
 * @route POST /api/pair-code
 * @desc  Generate 8-character pairing code for linking with phone number
 */
app.post('/api/pair-code', async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ success: false, error: 'Phone number is required' });
  }

  const digits = phone.replace(/\D/g, '');
  if (!digits || digits.length < 10) {
    return res.status(400).json({ success: false, error: 'Please enter a valid 10-digit phone number' });
  }

  const fullPhone = digits.length === 10 ? `91${digits}` : digits;

  if (!sock) {
    return res.status(503).json({ success: false, error: 'WhatsApp socket is initializing, please wait 5 seconds.' });
  }

  try {
    console.log(`[Pairing] Requesting pairing code for +${fullPhone}...`);
    const rawCode = await sock.requestPairingCode(fullPhone);
    const formattedCode = rawCode && rawCode.length === 8 ? `${rawCode.slice(0, 4)}-${rawCode.slice(4)}` : rawCode;
    console.log(`[Pairing] Generated pairing code: ${formattedCode}`);
    return res.json({ success: true, code: formattedCode });
  } catch (err) {
    console.error('[Pairing Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message || 'Failed to request pairing code' });
  }
});

/**
 * @route POST /api/send-message
 * @desc  Generic raw text message sender
 */
app.post('/api/send-message', requireApiKey, async (req, res) => {
  const { phone, message } = req.body;

  if (!phone || !message?.trim()) {
    return res.status(400).json({ success: false, error: 'Phone and message are required' });
  }

  if (!isReady || !sock) {
    return res.status(503).json({
      success: false,
      error: 'WhatsApp client is not connected. Please link your device at /qr'
    });
  }

  const jid = formatPhoneJid(phone);
  if (!jid) {
    return res.status(400).json({ success: false, error: 'Invalid phone number format' });
  }

  try {
    const sentMsg = await sock.sendMessage(jid, { text: message.trim() });
    return res.json({
      success: true,
      messageId: sentMsg.key.id,
      deliveredTo: jid.replace('@s.whatsapp.net', '')
    });
  } catch (err) {
    console.error('[Send Error]:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @route POST /api/notify-buyer
 * @desc  Pre-formatted buyer transaction acknowledgement
 */
app.post('/api/notify-buyer', requireApiKey, async (req, res) => {
  const { buyerPhone, buyerName, listingTitle, price, listingId } = req.body;

  if (!buyerPhone || !listingTitle) {
    return res.status(400).json({ success: false, error: 'buyerPhone and listingTitle are required' });
  }

  if (!isReady || !sock) {
    return res.status(503).json({
      success: false,
      error: 'WhatsApp client is not connected. Please link your device at /qr'
    });
  }

  const jid = formatPhoneJid(buyerPhone);
  if (!jid) {
    return res.status(400).json({ success: false, error: 'Invalid phone number format' });
  }

  const nameGreeting = buyerName ? ` *${buyerName}*` : '';
  const priceDisplay = price ? ` (₹${price})` : '';

  const messageText = 
    `👋 Hi${nameGreeting},\n\n` +
    `Thanks for showing interest in *"${listingTitle}"*${priceDisplay} on *Buy&Sell TKMCE*! 🛍️\n\n` +
    `🤝 Your assigned *Class Agent* has been notified and will contact you on this number within *24 hours* to confirm availability and coordinate a safe campus meetup.\n\n` +
    `📌 *Important Campus Guidelines:*\n` +
    `• Never pay in advance online before inspecting the item.\n` +
    `• Always meet in open campus zones (Canteen, Library porch, Department lobbies).\n\n` +
    `Happy Buying! 🎓\n` +
    `_Buy&Sell TKMCE Team_`;

  try {
    const sentMsg = await sock.sendMessage(jid, { text: messageText });
    console.log(`[Notification] Sent 24hr confirmation to ${jid.replace('@s.whatsapp.net', '')} for item "${listingTitle}"`);
    return res.json({
      success: true,
      messageId: sentMsg.key.id,
      deliveredTo: jid.replace('@s.whatsapp.net', '')
    });
  } catch (err) {
    console.error('[Notification Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`\n=================================================`);
  console.log(`🚀 Buy&Sell WhatsApp Microservice (Baileys) on port ${PORT}`);
  console.log(`📡 Health Check: http://localhost:${PORT}/health`);
  console.log(`📱 Link Page:   http://localhost:${PORT}/qr`);
  console.log(`=================================================\n`);
});

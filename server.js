import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5001;
const API_SECRET = process.env.WHATSAPP_SERVICE_SECRET || 'buysell_super_secret_whatsapp_key_2026';

// State management
let isReady = false;
let isAuthenticating = false;
let latestQr = null;
let clientInfo = null;
let lastError = null;

// Initialize WhatsApp Web client
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: process.env.SESSION_DATA_PATH || './.wwebjs_auth'
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  }
});

// Event: QR Code generated
client.on('qr', (qr) => {
  latestQr = qr;
  isReady = false;
  isAuthenticating = true;
  console.log('\n========================================');
  console.log('⚡ Scan this QR Code to connect WhatsApp:');
  console.log(`Or visit: http://localhost:${PORT}/qr`);
  console.log('========================================\n');
  qrcodeTerminal.generate(qr, { small: true });
});

// Event: Successfully authenticated
client.on('authenticated', () => {
  console.log('🔐 WhatsApp Client Authenticated successfully!');
  isAuthenticating = false;
  latestQr = null;
});

// Event: Client is ready to send messages
client.on('ready', () => {
  isReady = true;
  latestQr = null;
  clientInfo = client.info;
  console.log(`\n✅ WhatsApp Client is READY!`);
  console.log(`📱 Logged in as: ${clientInfo?.pushname || 'User'} (${clientInfo?.wid?.user || 'Unknown'})\n`);
});

// Event: Auth failure
client.on('auth_failure', (msg) => {
  console.error('❌ WhatsApp Authentication failure:', msg);
  isReady = false;
  lastError = msg;
});

// Event: Disconnected
client.on('disconnected', (reason) => {
  console.warn('⚠️ WhatsApp Client disconnected:', reason);
  isReady = false;
  clientInfo = null;
  lastError = reason;
  // Re-initialize after 5 seconds
  setTimeout(() => {
    console.log('🔄 Re-initializing WhatsApp Client...');
    client.initialize().catch((err) => console.error('Re-init failed:', err));
  }, 5000);
});

// Start the client
console.log('🚀 Initializing WhatsApp Web Client...');
client.initialize().catch((err) => {
  console.error('❌ Failed to initialize client:', err.message);
  lastError = err.message;
});

// Middleware for API Security
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

// Helper: Sanitize & Format Indian/International Phone Numbers
const formatWhatsAppChatId = (rawPhone) => {
  if (!rawPhone) return null;
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits) return null;

  // If 10-digit standard Indian phone number, prepend 91
  const fullPhone = digits.length === 10 ? `91${digits}` : digits;
  return `${fullPhone}@c.us`;
};

// ================= ROUTES ================= //

/**
 * @route GET /health
 * @desc  Health check endpoint (useful for Render keep-alive / UptimeRobot)
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'buysell-whatsapp-microservice',
    whatsappConnected: isReady,
    account: clientInfo ? { name: clientInfo.pushname, phone: clientInfo.wid?.user } : null,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

/**
 * @route GET /qr
 * @desc  Browser UI to view and scan the QR code easily on mobile
 */
app.get('/qr', async (req, res) => {
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
            <p>Logged in as: <strong>${clientInfo?.pushname || 'Connected User'}</strong><br/>(${clientInfo?.wid?.user || ''})</p>
            <p style="margin-top: 20px; font-size: 12px; color: #00a884;">Active and listening for outgoing messages.</p>
          </div>
        </body>
      </html>
    `);
  }

  if (!latestQr) {
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Generating QR | Buy&Sell TKMCE</title>
          <meta http-equiv="refresh" content="3">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0b141a; color: #e9edef; text-align: center; }
            .loader { border: 4px solid #222e35; border-top: 4px solid #00a884; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 20px; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <div>
            <div class="loader"></div>
            <h3>Starting WhatsApp Web Client...</h3>
            <p style="color: #8696a0;">Please wait, generating QR code...</p>
          </div>
        </body>
      </html>
    `);
  }

  try {
    const qrDataUrl = await QRCode.toDataURL(latestQr, { scale: 8, margin: 2 });
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Scan WhatsApp QR | Buy&Sell TKMCE</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta http-equiv="refresh" content="20">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0b141a; color: #e9edef; text-align: center; padding: 20px; box-sizing: border-box; }
            .card { background: #111b21; padding: 32px; border-radius: 24px; border: 1px solid #222e35; max-width: 420px; width: 100%; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
            h2 { margin: 0 0 8px 0; color: #fff; font-size: 22px; }
            p { color: #8696a0; font-size: 14px; margin: 0 0 20px 0; }
            .qr-box { background: white; padding: 12px; border-radius: 16px; display: inline-block; margin-bottom: 20px; }
            .qr-box img { display: block; width: 240px; height: 240px; }
            .instructions { text-align: left; background: #182229; padding: 16px 20px; border-radius: 12px; font-size: 13px; color: #aebac1; }
            .instructions ol { margin: 0; padding-left: 20px; }
            .instructions li { margin-bottom: 6px; }
            .timer { font-size: 11px; color: #8696a0; margin-top: 16px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Link WhatsApp Account</h2>
            <p>Scan this QR code with the WhatsApp account used to send buyer alerts.</p>
            <div class="qr-box">
              <img src="${qrDataUrl}" alt="WhatsApp QR Code" />
            </div>
            <div class="instructions">
              <ol>
                <li>Open <strong>WhatsApp</strong> on your phone</li>
                <li>Tap <strong>Settings / Menu (⋮)</strong> &gt; <strong>Linked Devices</strong></li>
                <li>Tap <strong>Link a Device</strong> and point your camera here</li>
              </ol>
            </div>
            <div class="timer">🔄 Page automatically refreshes every 20 seconds</div>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Error rendering QR code: ' + err.message);
  }
});

/**
 * @route POST /api/send-message
 * @desc  Generic raw message sender
 */
app.post('/api/send-message', requireApiKey, async (req, res) => {
  const { phone, message } = req.body;

  if (!phone || !message?.trim()) {
    return res.status(400).json({ success: false, error: 'Phone and message are required' });
  }

  if (!isReady) {
    return res.status(503).json({
      success: false,
      error: 'WhatsApp client is not ready. Please scan the QR code first.'
    });
  }

  const chatId = formatWhatsAppChatId(phone);
  if (!chatId) {
    return res.status(400).json({ success: false, error: 'Invalid phone number format' });
  }

  try {
    const sentMsg = await client.sendMessage(chatId, message.trim());
    return res.json({
      success: true,
      messageId: sentMsg.id._serialized,
      deliveredTo: chatId.replace('@c.us', '')
    });
  } catch (err) {
    console.error('Failed to send WhatsApp message:', err);
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

  if (!isReady) {
    return res.status(503).json({
      success: false,
      error: 'WhatsApp client is not ready. Please scan the QR code first.'
    });
  }

  const chatId = formatWhatsAppChatId(buyerPhone);
  if (!chatId) {
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
    const sentMsg = await client.sendMessage(chatId, messageText);
    console.log(`[Notification] Sent 24hr confirmation to ${chatId.replace('@c.us', '')} for item "${listingTitle}"`);
    return res.json({
      success: true,
      messageId: sentMsg.id._serialized,
      deliveredTo: chatId.replace('@c.us', '')
    });
  } catch (err) {
    console.error('[Notification Error] Failed to send message:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`\n=================================================`);
  console.log(`🚀 Buy&Sell WhatsApp Microservice running on port ${PORT}`);
  console.log(`📡 Health Check: http://localhost:${PORT}/health`);
  console.log(`📱 QR Code Page: http://localhost:${PORT}/qr`);
  console.log(`=================================================\n`);
});

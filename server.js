import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';

dotenv.config();

// Prevent a single whatsapp-web.js/Puppeteer error from killing the whole process
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason?.stack || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.stack || err);
});

// Log memory every 30s so out-of-memory restarts are visible in Render logs
setInterval(() => {
  const mb = (n) => Math.round(n / 1024 / 1024);
  const m = process.memoryUsage();
  console.log(`[memory] rss=${mb(m.rss)}MB heapUsed=${mb(m.heapUsed)}MB`);
}, 30000);

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

// Initialize WhatsApp Web client with stealth and modern version caching
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: process.env.SESSION_DATA_PATH || './.wwebjs_auth'
  }),
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1045021694-alpha.html'
  },
  takeoverOnConflict: true,
  takeoverTimeoutMs: 0,
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
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
    hasQr: !!latestQr,
    lastError: lastError || null,
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
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0b141a; color: #e9edef; text-align: center; padding: 20px; box-sizing: border-box; }
            .card { background: #111b21; padding: 32px; border-radius: 24px; border: 1px solid #222e35; max-width: 420px; width: 100%; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
            h2 { margin: 0 0 8px 0; color: #fff; font-size: 22px; }
            p { color: #8696a0; font-size: 14px; margin: 0 0 20px 0; }
            .qr-box { background: white; padding: 12px; border-radius: 16px; display: inline-block; margin-bottom: 20px; }
            .qr-box img { display: block; width: 250px; height: 250px; }
            .instructions { text-align: left; background: #182229; padding: 16px 20px; border-radius: 12px; font-size: 13px; color: #aebac1; }
            .instructions ol { margin: 0; padding-left: 20px; }
            .instructions li { margin-bottom: 6px; }
            .status-indicator { margin-top: 16px; font-size: 12px; color: #00a884; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px; }
            .pulse { width: 8px; height: 8px; background: #00a884; border-radius: 50%; animation: pulse 1.5s infinite; }
            @keyframes pulse { 0% { opacity: 0.3; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.2); } 100% { opacity: 0.3; transform: scale(0.9); } }
            .btn-refresh { margin-top: 14px; background: transparent; border: 1px solid #222e35; color: #8696a0; padding: 6px 14px; border-radius: 8px; font-size: 12px; cursor: pointer; transition: all 0.2s; }
            .btn-refresh:hover { color: #fff; border-color: #00a884; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Link WhatsApp Account</h2>
            <p>Scan this QR code with your WhatsApp Business or personal account.</p>
            <div class="qr-box">
              <img id="qr-img" src="${qrDataUrl}" alt="WhatsApp QR Code" />
            </div>
            <div class="instructions">
              <ol>
                <li>Open <strong>WhatsApp</strong> on your phone</li>
                <li>Tap <strong>Settings / Menu (⋮)</strong> &gt; <strong>Linked Devices</strong></li>
                <li>Tap <strong>Link a Device</strong> and point your camera here</li>
              </ol>
            </div>
            <div class="status-indicator">
              <span class="pulse"></span> Listening for connection...
            </div>
            
            <div style="margin: 24px 0 16px 0; border-top: 1px solid #222e35; position: relative;">
              <span style="position: absolute; top: -10px; left: 50%; transform: translateX(-50%); background: #111b21; padding: 0 10px; color: #8696a0; font-size: 11px; text-transform: uppercase;">or use phone number</span>
            </div>

            <div style="background: #182229; padding: 18px; border-radius: 14px; text-align: left;">
              <h4 style="margin: 0 0 6px 0; color: #fff; font-size: 14px;">Link with Phone Number</h4>
              <p style="margin: 0 0 12px 0; font-size: 12px; color: #8696a0;">Recommended for WhatsApp Business accounts.</p>
              
              <div style="display: flex; gap: 8px;">
                <input id="phone-input" type="tel" placeholder="e.g. 9876543210" style="flex: 1; background: #111b21; border: 1px solid #222e35; color: #fff; padding: 10px 12px; border-radius: 8px; font-size: 14px; outline: none;" />
                <button id="get-code-btn" onclick="requestPairingCode()" style="background: #00a884; color: #fff; border: none; padding: 10px 14px; border-radius: 8px; font-weight: bold; font-size: 13px; cursor: pointer;">Get Code</button>
              </div>

              <div id="code-result" style="display: none; margin-top: 14px; padding: 12px; background: #111b21; border: 1px dashed #00a884; border-radius: 10px; text-align: center;">
                <p style="margin: 0 0 4px 0; font-size: 11px; color: #8696a0;">Enter this code on your WhatsApp:</p>
                <div id="code-display" style="font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #00a884;"></div>
                <p style="margin: 8px 0 0 0; font-size: 11px; color: #aebac1;">WhatsApp &gt; Linked Devices &gt; Link a Device &gt; <em>Link with phone number instead</em></p>
              </div>
            </div>

            <button class="btn-refresh" onclick="location.reload()" style="margin-top: 20px;">🔄 Refresh Page</button>
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
                alert('Connection error: ' + e.message);
                btn.innerText = 'Try Again';
                btn.disabled = false;
              }
            }

            // Poll health endpoint every 3 seconds; auto-reload immediately when linked
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
  } catch (err) {
    res.status(500).send('Error rendering QR code: ' + err.message);
  }
});

/**
 * @route POST /api/pair-code
 * @desc  Generate 8-character pairing code for linking with phone number instead of QR
 */
app.post('/api/pair-code', async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ success: false, error: 'Phone number is required' });
  }

  const digits = phone.replace(/\D/g, '');
  if (!digits || digits.length < 10) {
    return res.status(400).json({ success: false, error: 'Please enter a valid phone number with at least 10 digits' });
  }

  // Prepend 91 for Indian numbers if only 10 digits
  const fullPhone = digits.length === 10 ? `91${digits}` : digits;

  try {
    console.log(`[Pairing] Requesting pairing code for +${fullPhone}...`);
    const rawCode = await client.requestPairingCode(fullPhone);
    const formattedCode = rawCode && rawCode.length === 8 ? `${rawCode.slice(0, 4)}-${rawCode.slice(4)}` : rawCode;
    console.log(`[Pairing] Successfully generated pairing code: ${formattedCode}`);
    return res.json({ success: true, code: formattedCode });
  } catch (err) {
    console.error('[Pairing Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message || 'Failed to request pairing code' });
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

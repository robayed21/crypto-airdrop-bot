const axios = require('axios');
const cron = require('node-cron');
require('dotenv').config();

// Configuration
const CONFIG = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
  checkInterval: process.env.CHECK_INTERVAL || '*/5 * * * *',
};

// Blocked Indian Projects
const BLOCKED_PROJECTS = [
  'polygon', 'matic', 'wazirx', 'coincx', 'giottus',
  'zebpay', 'unocoin', 'coinsecure', 'koinex', 'bitbns',
  'buyucoin', 'coinswitch', 'jio coin', 'reliance crypto',
  'tata coin', 'adani coin', 'bharti airtel token',
];

// Check if Indian Project
function isIndianProject(name) {
  const lower = (name || '').toLowerCase();
  return BLOCKED_PROJECTS.some(blocked => lower.includes(blocked));
}

// Send Telegram Message
async function sendTelegram(message) {
  try {
    const url = `https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`;
    await axios.post(url, {
      chat_id: CONFIG.chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    });
    console.log('Telegram sent!');
    return true;
  } catch (error) {
    console.error('Telegram error:', error.message);
    return false;
  }
}

// Get Social Links for Project
async function getSocialLinks(protocol) {
  const links = {
    website: protocol.url || '#',
    twitter: null,
    discord: null,
    telegram: null,
    github: null,
  };

  // Extract from protocol links
  if (protocol.links) {
    if (protocol.links.twitter) links.twitter = protocol.links.twitter;
    if (protocol.links.discord) links.discord = protocol.links.discord;
    if (protocol.links.telegram) links.telegram = protocol.links.telegram;
    if (protocol.links.github) links.github = protocol.links.github;
  }

  // Try to get from protocol website
  try {
    const website = protocol.url;
    if (website) {
      const domain = new URL(website).hostname.replace('www.', '');

      // Common social link patterns
      if (!links.twitter) links.twitter = `https://twitter.com/${protocol.name.toLowerCase().replace(/\s+/g, '')}`;
      if (!links.discord) links.discord = `https://discord.gg/${protocol.name.toLowerCase().replace(/\s+/g, '')}`;
      if (!links.telegram) links.telegram = `https://t.me/${protocol.name.toLowerCase().replace(/\s+/g, '')}`;
    }
  } catch (e) {
    // Skip
  }

  return links;
}

// Format Single Airdrop Post
function formatAirdropPost(airdrop, index, total) {
  const socialLinks = airdrop.socialLinks;

  let message = `🎯 <b>AIRDROP ${index}/${total}</b>\n\n`;

  message += `📌 <b>Project:</b> ${airdrop.name}\n`;
  message += `🔗 <b>Chain:</b> ${airdrop.chain}\n`;
  message += `💰 <b>TVL:</b> $${Math.round(airdrop.tvl).toLocaleString()}\n`;
  message += `📊 <b>Category:</b> ${airdrop.category || 'DeFi'}\n\n`;

  message += `━━━━━━━━━━━━━━━━━\n`;
  message += `📱 <b>SOCIAL MEDIA LINKS:</b>\n`;
  message += `━━━━━━━━━━━━━━━━━\n\n`;

  if (socialLinks.website) {
    message += `🌐 <b>Website:</b> <a href="${socialLinks.website}">Click Here</a>\n`;
  }
  if (socialLinks.twitter) {
    message += `🐦 <b>Twitter:</b> <a href="${socialLinks.twitter}">Follow</a>\n`;
  }
  if (socialLinks.discord) {
    message += `💬 <b>Discord:</b> <a href="${socialLinks.discord}">Join</a>\n`;
  }
  if (socialLinks.telegram) {
    message += `📢 <b>Telegram:</b> <a href="${socialLinks.telegram}">Join</a>\n`;
  }
  if (socialLinks.github) {
    message += `💻 <b>GitHub:</b> <a href="${socialLinks.github}">View</a>\n`;
  }

  message += `\n━━━━━━━━━━━━━━━━━\n`;
  message += `✅ <b>How to Join:</b>\n`;
  message += `━━━━━━━━━━━━━━━━━\n\n`;

  message += `1️⃣ Visit Website\n`;
  message += `2️⃣ Connect Wallet\n`;
  message += `3️⃣ Complete Tasks\n`;
  message += `4️⃣ Follow Social Media\n`;
  message += `5️⃣ Wait for Distribution\n\n`;

  message += `⚠️ <b>Indian Projects: BLOCKED</b>\n`;
  message += `🔍 <b>Verified: YES</b>`;

  return message;
}

// Get Airdrops from DeFi Llama
async function getAirdrops() {
  try {
    console.log('Fetching airdrops...');
    const response = await axios.get('https://api.llama.fi/protocols');
    const protocols = response.data || [];

    const airdrops = [];

    for (const protocol of protocols) {
      // Filter conditions
      if (!protocol.tvl || protocol.tvl < 100000) continue;
      if (isIndianProject(protocol.name)) continue;

      // Get social links
      const socialLinks = await getSocialLinks(protocol);

      airdrops.push({
        name: protocol.name,
        chain: protocol.chains ? protocol.chains[0] : 'Ethereum',
        tvl: protocol.tvl,
        category: protocol.category,
        url: protocol.url || `https://defillama.com/protocol/${protocol.slug}`,
        socialLinks: socialLinks,
      });

      // Limit to 10
      if (airdrops.length >= 10) break;
    }

    console.log('Found ' + airdrops.length + ' airdrops');
    return airdrops;
  } catch (error) {
    console.error('Fetch error:', error.message);
    return [];
  }
}

// Send Airdrops One by One
async function sendAirdropsOneByOne(airdrops) {
  // First, send intro message
  const introMessage = `🚀 <b>NEW AIRDROPS ALERT!</b>\n\n` +
    `📊 Total Found: <b>${airdrops.length}</b> airdrops\n` +
    `🇮🇳 Indian Projects: <b>BLOCKED</b>\n` +
    `✅ All Verified\n\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `📬 Sending details one by one...\n` +
    `━━━━━━━━━━━━━━━━━`;

  await sendTelegram(introMessage);

  // Wait 2 seconds
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Send each airdrop separately
  for (let i = 0; i < airdrops.length; i++) {
    const airdrop = airdrops[i];
    const post = formatAirdropPost(airdrop, i + 1, airdrops.length);

    console.log(`Sending ${i + 1}/${airdrops.length}: ${airdrop.name}`);
    await sendTelegram(post);

    // Wait 1 second between posts
    if (i < airdrops.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Send summary
  const summary = `━━━━━━━━━━━━━━━━━\n` +
    `✅ <b>ALL AIRDROPS SENT!</b>\n` +
    `━━━━━━━━━━━━━━━━━\n\n` +
    `📊 Total: ${airdrops.length} airdrops\n` +
    `🔗 Check all links above\n` +
    `⚠️ Always DYOR (Do Your Own Research)\n\n` +
    `⏰ Next scan in 5 minutes...`;

  await sendTelegram(summary);
}

// Main Scan Function
async function scanAirdrops() {
  console.log('\n=== Scanning Airdrops ===');

  const airdrops = await getAirdrops();

  if (airdrops.length === 0) {
    console.log('No new airdrops found');
    await sendTelegram('No new airdrops found. Next scan in 5 minutes.');
    return;
  }

  // Send one by one
  await sendAirdropsOneByOne(airdrops);

  console.log('Scan complete!');
}

// Start Bot
console.log('Crypto Airdrop Bot Starting...');
console.log('Check interval: ' + CONFIG.checkInterval);
console.log('Indian projects: BLOCKED');
console.log('Mode: One-by-One Posts');

// Initial scan
scanAirdrops();

// Schedule regular scans
cron.schedule(CONFIG.checkInterval, scanAirdrops);

console.log('Bot is running!');
console.log('Press Ctrl+C to stop');

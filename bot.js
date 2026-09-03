const axios = require('axios');
const cron = require('node-cron');
const NodeCache = require('node-cache');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const { getInstantOffers, formatInstantOfferMessage } = require('./offers');
require('dotenv').config();

// Configuration
const CONFIG = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
  checkInterval: process.env.CHECK_INTERVAL || '*/5 * * * *',
  mongodbUri: process.env.MONGODB_URI,
  etherscanApiKey: process.env.ETHERSCAN_API_KEY,
};

// Cache System (24 hour TTL for tracking)
const cache = new NodeCache({ stdTTL: 86400 });

// Rate Limiter (100 requests per minute)
const rateLimiter = new RateLimiterMemory({
  points: 100,
  duration: 60,
});

// Database Connection (MongoDB)
let db = null;
async function connectDB() {
  if (!CONFIG.mongodbUri) {
    console.log('⚠️ MongoDB not configured - using memory only');
    return null;
  }
  
  try {
    const { MongoClient } = require('mongodb');
    const client = await MongoClient.connect(CONFIG.mongodbUri);
    db = client.db('airdrop_bot');
    console.log('✅ MongoDB connected');
    
    // Create indexes
    await db.collection('airdrops').createIndex({ name: 1 }, { unique: true });
    await db.collection('claimed').createIndex({ name: 1 });
    await db.collection('blacklist').createIndex({ name: 1 });
    
    return db;
  } catch (error) {
    console.error('❌ MongoDB error:', error.message);
    return null;
  }
}

// Blocked Indian Projects
const BLOCKED_PROJECTS = [
  'polygon', 'matic', 'wazirx', 'coincx', 'giottus',
  'zebpay', 'unocoin', 'coinsecure', 'koinex', 'bitbns',
  'buyucoin', 'coinswitch', 'jio coin', 'reliance crypto',
  'tata coin', 'adani coin', 'bharti airtel token',
];

// Blacklist (scam projects)
const BLACKLIST = [
  'rugpull', 'scam', 'fake', 'phishing', 'hack',
];

// Check if Indian Project
function isIndianProject(name) {
  const lower = (name || '').toLowerCase();
  return BLOCKED_PROJECTS.some(blocked => lower.includes(blocked));
}

// Check if Blacklisted
function isBlacklisted(name) {
  const lower = (name || '').toLowerCase();
  return BLACKLIST.some(item => lower.includes(item));
}

// Rate Limiter Wrapper
async function rateLimit() {
  try {
    await rateLimiter.consume('telegram');
    return true;
  } catch (error) {
    console.log('⚠️ Rate limited - waiting...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    return true;
  }
}

// Send Telegram Message (with Rate Limiting)
async function sendTelegram(message) {
  if (!CONFIG.telegramToken || !CONFIG.chatId) {
    console.log('⚠️ Telegram not configured');
    return false;
  }

  try {
    await rateLimit();
    
    const url = `https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`;
    await axios.post(url, {
      chat_id: CONFIG.chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    });
    console.log('📱 Telegram sent!');
    return true;
  } catch (error) {
    console.error('❌ Telegram error:', error.message);
    return false;
  }
}

// Get Social Links for Project (Real links only from API)
async function getSocialLinks(protocol) {
  const links = {
    website: protocol.url || null,
    twitter: null,
    discord: null,
    telegram: null,
    github: null,
  };

  // Only use REAL links from DeFi Llama API
  if (protocol.links) {
    if (protocol.links.twitter) links.twitter = protocol.links.twitter;
    if (protocol.links.discord) links.discord = protocol.links.discord;
    if (protocol.links.telegram) links.telegram = protocol.links.telegram;
    if (protocol.links.github) links.github = protocol.links.github;
  }

  return links;
}

// Smart Contract Audit Check
async function checkSmartContract(address, chain) {
  try {
    if (!CONFIG.etherscanApiKey) {
      return { verified: false, audit: 'Unknown' };
    }

    const chainIds = {
      ethereum: 1,
      bsc: 56,
      polygon: 137,
      arbitrum: 42161,
      optimism: 10,
    };

    const chainId = chainIds[chain?.toLowerCase()] || 1;
    
    // Check if contract is verified
    const url = `https://api.etherscan.io/api?module=contract&action=getabi&address=${address}&apikey=${CONFIG.etherscanApiKey}&chainid=${chainId}`;
    const response = await axios.get(url);
    
    const verified = response.data.status === '1';
    
    return {
      verified,
      audit: verified ? 'Verified' : 'Not Verified',
    };
  } catch (error) {
    return { verified: false, audit: 'Check Failed' };
  }
}

// Team Background Check
async function checkTeamBackground(protocol) {
  try {
    const checks = {
      githubActive: false,
      teamPublic: false,
      auditPassed: false,
    };

    // Check GitHub activity
    if (protocol.links?.github) {
      try {
        const githubUrl = protocol.links.github;
        const response = await axios.get(githubUrl);
        checks.githubActive = response.status === 200;
      } catch (e) {
        checks.githubActive = false;
      }
    }

    // Check if team is public (heuristic: has website + social)
    checks.teamPublic = !!(protocol.url && protocol.links);

    // Check audit status
    checks.auditPassed = protocol.audits && protocol.audits.length > 0;

    return checks;
  } catch (error) {
    return { githubActive: false, teamPublic: false, auditPassed: false };
  }
}

// Calculate Profit Potential
function calculateProfit(tvl, category) {
  const profitMultipliers = {
    'Liquid Staking': 0.15,
    'Lending': 0.10,
    'DEX': 0.12,
    'CDP': 0.08,
    'Bridge': 0.05,
    'CeFi': 0.20,
    'Derivatives': 0.18,
  };

  const multiplier = profitMultipliers[category] || 0.10;
  const estimatedProfit = tvl * multiplier / 1000000;

  return {
    low: Math.round(estimatedProfit * 0.5),
    mid: Math.round(estimatedProfit),
    high: Math.round(estimatedProfit * 2),
  };
}

// Check if Already Claimed
async function isClaimed(name) {
  // Check cache (24 hour TTL)
  const cacheKey = `claimed_${name}`;
  if (cache.get(cacheKey)) return true;

  // Check database
  if (db) {
    try {
      const claimed = await db.collection('claimed').findOne({ name });
      if (claimed) {
        cache.set(cacheKey, true);
        return true;
      }
    } catch (error) {
      // Skip
    }
  }

  return false;
}

// Mark as Claimed
async function markClaimed(name, details) {
  // Set cache (24 hour TTL)
  cache.set(`claimed_${name}`, true, 86400);

  // Save to database
  if (db) {
    try {
      await db.collection('claimed').insertOne({
        name,
        details,
        claimedAt: new Date(),
      });
    } catch (error) {
      // Skip
    }
  }
}

// Check if in Blacklist
async function isInBlacklist(name) {
  // Check cache
  const cacheKey = `blacklist_${name}`;
  if (cache.get(cacheKey)) return true;

  // Check database
  if (db) {
    try {
      const blacklisted = await db.collection('blacklist').findOne({ name });
      if (blacklisted) {
        cache.set(cacheKey, true);
        return true;
      }
    } catch (error) {
      // Skip
    }
  }

  // Check hardcoded blacklist
  return isBlacklisted(name);
}

// Save Airdrop to Database
async function saveAirdrop(airdrop) {
  if (db) {
    try {
      await db.collection('airdrops').updateOne(
        { name: airdrop.name },
        { $set: { ...airdrop, updatedAt: new Date() } },
        { upsert: true }
      );
    } catch (error) {
      // Skip
    }
  }
}

// Get Airdrops from DeFi Llama (with Caching)
async function getAirdrops() {
  // Check cache first
  const cachedAirdrops = cache.get('airdrops');
  if (cachedAirdrops) {
    console.log('📦 Using cached airdrops');
    // Filter out already claimed airdrops from cache
    const unclaimed = [];
    for (const airdrop of cachedAirdrops) {
      if (!await isClaimed(airdrop.name)) {
        unclaimed.push(airdrop);
      }
    }
    console.log(`📦 ${unclaimed.length} unclaimed from cache`);
    return unclaimed;
  }

  try {
    console.log('🔍 Fetching airdrops...');
    const response = await axios.get('https://api.llama.fi/protocols');
    const protocols = response.data || [];

    const airdrops = [];
    let count = 0;

    for (const protocol of protocols) {
      // Filter conditions
      if (!protocol.tvl || protocol.tvl < 100000) continue;
      if (isIndianProject(protocol.name)) {
        console.log(`🚫 Blocked Indian project: ${protocol.name}`);
        continue;
      }
      if (await isInBlacklist(protocol.name)) {
        console.log(`🚫 Blacklisted project: ${protocol.name}`);
        continue;
      }
      if (await isClaimed(protocol.name)) {
        console.log(`✅ Already claimed: ${protocol.name}`);
        continue;
      }

      // Get social links
      const socialLinks = await getSocialLinks(protocol);

      // Smart contract check
      const contractCheck = await checkSmartContract(
        protocol.address,
        protocol.chains?.[0]
      );

      // Team background check
      const teamCheck = await checkTeamBackground(protocol);

      // Profit calculation
      const profit = calculateProfit(protocol.tvl, protocol.category);

      airdrops.push({
        name: protocol.name,
        chain: protocol.chains ? protocol.chains[0] : 'Ethereum',
        tvl: protocol.tvl,
        category: protocol.category,
        url: protocol.url || `https://defillama.com/protocol/${protocol.slug}`,
        socialLinks,
        contractCheck,
        teamCheck,
        profit,
      });

      count++;
      // Limit to 10 airdrops per scan
      if (count >= 10) break;
    }

    // Cache for 10 minutes
    cache.set('airdrops', airdrops, 600);

    console.log(`✅ Found ${airdrops.length} airdrops`);
    return airdrops;
  } catch (error) {
    console.error('❌ Fetch error:', error.message);
    return [];
  }
}

// Get How to Join Instructions based on Category
function getHowToJoin(category) {
  const instructions = {
    'DEX': [
      '1️⃣ Visit DEX Website',
      '2️⃣ Swap tokens',
      '3️⃣ Provide liquidity',
      '4️⃣ Trade regularly',
      '5️⃣ Wait for snapshot'
    ],
    'Lending': [
      '1️⃣ Visit Lending Platform',
      '2️⃣ Deposit tokens as collateral',
      '3️⃣ Borrow tokens',
      '4️⃣ Maintain position',
      '5️⃣ Wait for distribution'
    ],
    'Liquid Staking': [
      '1️⃣ Visit Staking Platform',
      '2️⃣ Stake your tokens',
      '3️⃣ Receive staked tokens',
      '4️⃣ Hold position',
      '5️⃣ Claim rewards'
    ],
    'Bridge': [
      '1️⃣ Visit Bridge Platform',
      '2️⃣ Connect wallet',
      '3️⃣ Bridge tokens',
      '4️⃣ Complete multiple bridges',
      '5️⃣ Wait for eligibility'
    ],
    'CDP': [
      '1️⃣ Visit CDP Platform',
      '2️⃣ Deposit collateral',
      '3️⃣ Mint stablecoins',
      '4️⃣ Maintain healthy position',
      '5️⃣ Wait for distribution'
    ],
    'Derivatives': [
      '1️⃣ Visit Trading Platform',
      '2️⃣ Connect wallet',
      '3️⃣ Trade perpetuals',
      '4️⃣ Reach trading volume',
      '5️⃣ Wait for rewards'
    ],
    'Yield': [
      '1️⃣ Visit Yield Platform',
      '2️⃣ Deposit tokens',
      '3️⃣ Farm yield',
      '4️⃣ Compound rewards',
      '5️⃣ Wait for airdrop'
    ],
    'Restaking': [
      '1️⃣ Visit Restaking Platform',
      '2️⃣ Stake ETH first',
      '3️⃣ Restake tokens',
      '4️⃣ Secure networks',
      '5️⃣ Earn multiple rewards'
    ],
    'CeFi': [
      '1️⃣ Visit Exchange',
      '2️⃣ Create account',
      '3️⃣ Complete KYC',
      '4️⃣ Trade or hold tokens',
      '5️⃣ Wait for distribution'
    ],
    'Default': [
      '1️⃣ Visit Website',
      '2️⃣ Connect Wallet',
      '3️⃣ Complete Tasks',
      '4️⃣ Follow Social Media',
      '5️⃣ Wait for Distribution'
    ]
  };

  return instructions[category] || instructions['Default'];
}

// Format Single Airdrop Post (Simple & Clean)
function formatAirdropPost(airdrop) {
  const socialLinks = airdrop.socialLinks;
  const profit = airdrop.profit;
  const howToJoin = getHowToJoin(airdrop.category);

  let message = `🎯 <b>AIRDROP ALERT</b>\n\n`;

  message += `📌 <b>${airdrop.name}</b>\n`;
  message += `🔗 Chain: ${airdrop.chain}\n`;
  message += `💰 TVL: $${Math.round(airdrop.tvl).toLocaleString()}\n`;
  message += `📊 Category: ${airdrop.category || 'DeFi'}\n`;
  message += `📡 Source: DeFi Llama\n\n`;

  message += `📱 <b>Links:</b>\n`;
  if (socialLinks.website) {
    message += `🌐 <a href="${socialLinks.website}">Website</a>`;
  }
  if (socialLinks.twitter) {
    message += ` | 🐦 <a href="${socialLinks.twitter}">Twitter</a>`;
  }
  if (socialLinks.discord) {
    message += ` | 💬 <a href="${socialLinks.discord}">Discord</a>`;
  }
  if (socialLinks.telegram) {
    message += ` | 📢 <a href="${socialLinks.telegram}">Telegram</a>`;
  }
  message += `\n\n`;

  message += `💰 <b>Profit Potential:</b>\n`;
  message += `📉 Low: $${profit.low} | 📊 Mid: $${profit.mid} | 📈 High: $${profit.high}\n\n`;

  message += `✅ <b>How to Join (${airdrop.category || 'DeFi'}):</b>\n`;
  howToJoin.forEach(step => {
    message += `${step}\n`;
  });
  message += `\n`;

  message += `⚠️ Indian Projects: BLOCKED`;

  return message;
}

// Queue System for Posts
let postQueue = [];
let isProcessingQueue = false;

// Add to Queue
function addToQueue(type, data) {
  postQueue.push({ type, data });
  console.log(`📥 Added to queue: ${data.name} (Queue size: ${postQueue.length})`);
}

// Process Queue (one by one with 5 min delay)
async function processQueue() {
  if (isProcessingQueue || postQueue.length === 0) {
    return;
  }

  isProcessingQueue = true;
  console.log(`\n📤 Processing queue (${postQueue.length} items)...`);

  while (postQueue.length > 0) {
    const item = postQueue.shift();
    const postKey = `${item.type}_${item.data.name}`;

    // Skip if already sent
    if (sentPosts.has(postKey)) {
      console.log(`⏭️ Skipping duplicate: ${item.data.name}`);
      continue;
    }

    let message;
    if (item.type === 'airdrop') {
      message = formatAirdropPost(item.data);
    } else if (item.type === 'offer') {
      message = formatInstantOfferMessage(item.data, 1, 1);
    }

    console.log(`📤 Sending: ${item.data.name}`);
    const sent = await sendTelegram(message);

    if (sent) {
      sentPosts.add(postKey);
      await markClaimed(item.data.name, { type: item.type });
    }

    // Wait 5 minutes between posts (if more items in queue)
    if (postQueue.length > 0) {
      console.log(`⏳ Waiting 5 minutes before next post... (${postQueue.length} remaining)`);
      await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
    }
  }

  isProcessingQueue = false;
  console.log('✅ Queue processing complete!');
}

// Track sent posts (prevent duplicates)
let sentPosts = new Set();

// Scan lock (prevent multiple scans at same time)
let isScanning = false;

// Main Scan Function
async function scanAirdrops() {
  // Prevent multiple scans at same time
  if (isScanning) {
    console.log('⚠️ Scan already in progress - skipping');
    return;
  }

  isScanning = true;
  console.log('\n=== Scanning Airdrops & Instant Offers ===');

  try {
    // Scan regular airdrops
    const airdrops = await getAirdrops();
    if (airdrops.length > 0) {
      console.log(`\n📋 Found ${airdrops.length} regular airdrops`);
      for (const airdrop of airdrops) {
        addToQueue('airdrop', airdrop);
      }
    }

    // Scan instant offers
    const instantOffers = await getInstantOffers();
    if (instantOffers.length > 0) {
      console.log(`\n🎁 Found ${instantOffers.length} instant offers`);
      for (const offer of instantOffers) {
        addToQueue('offer', offer);
      }
    }

    if (airdrops.length === 0 && instantOffers.length === 0) {
      console.log('No new airdrops or offers found');
      // Don't send any message - only post when there's something to share
    }

    console.log(`📊 Queue size: ${postQueue.length}`);
  } catch (error) {
    console.error('❌ Scan error:', error.message);
  } finally {
    isScanning = false;
  }

  // Start processing queue if not already running
  await processQueue();
}

// Start Bot
async function startBot() {
  console.log('🚀 Crypto Airdrop Bot Starting...');
  console.log('⏰ Check interval: ' + CONFIG.checkInterval);
  console.log('🇮🇳 Indian projects: BLOCKED');
  console.log('📤 Mode: One-by-One Posts (5 min interval)');
  console.log('🗄️ Database: ' + (CONFIG.mongodbUri ? 'MongoDB' : 'Memory'));

  // Connect to database
  await connectDB();

  // Schedule regular scans (every 5 minutes)
  cron.schedule(CONFIG.checkInterval, scanAirdrops, {
    scheduled: true,
    timezone: "Asia/Dhaka"
  });

  // Run first scan after 30 seconds
  setTimeout(() => {
    console.log('🔄 Running initial scan...');
    scanAirdrops();
  }, 30000);

  console.log('✅ Bot is running!');
  console.log('📌 Press Ctrl+C to stop');
}

// Start the bot
startBot();

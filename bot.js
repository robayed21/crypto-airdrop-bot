const axios = require('axios');
const cron = require('node-cron');
const NodeCache = require('node-cache');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const { getInstantOffers, formatInstantOfferMessage } = require('./offers');
const { getAllAirdrops } = require('./sources');
require('dotenv').config();

// Configuration
const CONFIG = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
  checkInterval: process.env.CHECK_INTERVAL || '*/5 * * * *',
  mongodbUri: process.env.MONGODB_URI,
  etherscanApiKey: process.env.ETHERSCAN_API_KEY,
  // Custom Filters (user-configurable via .env / Railway Variables)
  minTvl: parseInt(process.env.MIN_TVL) || 100000,
  minReward: parseInt(process.env.MIN_REWARD) || 0,
  allowedChains: process.env.ALLOWED_CHAINS ? process.env.ALLOWED_CHAINS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : null,
  allowedTypes: process.env.ALLOWED_TYPES ? process.env.ALLOWED_TYPES.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : null,
  blockedKeywords: process.env.BLOCKED_KEYWORDS ? process.env.BLOCKED_KEYWORDS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [],
  maxRiskLevel: process.env.MAX_RISK_LEVEL || null, // e.g. 'MEDIUM' = only LOW & VERY LOW allowed
  enableMoreSources: process.env.ENABLE_MORE_SOURCES !== 'false', // true by default
  dailySummaryTime: process.env.DAILY_SUMMARY_TIME || '09:00',
  dailySummaryEnabled: process.env.DAILY_SUMMARY_ENABLED !== 'false',
};

// Daily Stats Tracking
let dailyStats = {
  date: new Date().toDateString(),
  scanned: 0,
  verified: 0,
  queued: 0,
  sent: 0,
  blocked: 0,
  skipped: 0,
  sourcesUsed: [],
  startTime: new Date(),
};

function resetDailyStatsIfNewDay() {
  const today = new Date().toDateString();
  if (dailyStats.date !== today) {
    dailyStats = {
      date: today,
      scanned: 0,
      verified: 0,
      queued: 0,
      sent: 0,
      blocked: 0,
      skipped: 0,
      sourcesUsed: [],
      startTime: new Date(),
    };
  }
}

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

// Custom Filter Check (user-configurable)
function passesCustomFilter(airdrop) {
  // Check MIN_TVL
  if (airdrop.tvl && airdrop.tvl < CONFIG.minTvl) {
    console.log(`   🚫 Filtered by MIN_TVL: ${airdrop.name} ($${airdrop.tvl} < $${CONFIG.minTvl})`);
    return false;
  }

  // Check ALLOWED_CHAINS
  if (CONFIG.allowedChains && CONFIG.allowedChains.length > 0) {
    const chain = (airdrop.chain || '').toLowerCase();
    const chains = (airdrop.chains || [airdrop.chain]).map(c => (c || '').toLowerCase());
    const matches = CONFIG.allowedChains.some(allowed => 
      chain.includes(allowed) || chains.some(c => c.includes(allowed))
    );
    if (!matches) {
      console.log(`   🚫 Filtered by ALLOWED_CHAINS: ${airdrop.name} (${airdrop.chain})`);
      return false;
    }
  }

  // Check ALLOWED_TYPES / Category
  if (CONFIG.allowedTypes && CONFIG.allowedTypes.length > 0) {
    const type = (airdrop.type || '').toLowerCase();
    const category = (airdrop.category || '').toLowerCase();
    const matches = CONFIG.allowedTypes.some(allowed => 
      type.includes(allowed) || category.includes(allowed)
    );
    if (!matches) {
      console.log(`   🚫 Filtered by ALLOWED_TYPES: ${airdrop.name} (${airdrop.category}/${airdrop.type})`);
      return false;
    }
  }

  // Check BLOCKED_KEYWORDS
  if (CONFIG.blockedKeywords && CONFIG.blockedKeywords.length > 0) {
    const name = (airdrop.name || '').toLowerCase();
    const blocked = CONFIG.blockedKeywords.some(kw => name.includes(kw));
    if (blocked) {
      console.log(`   🚫 Filtered by BLOCKED_KEYWORDS: ${airdrop.name}`);
      return false;
    }
  }

  // Check MIN_REWARD (for offers: parse $ value)
  if (CONFIG.minReward > 0 && airdrop.reward) {
    const match = airdrop.reward.match(/\$(\d+)/);
    if (match) {
      const rewardValue = parseInt(match[1]);
      if (rewardValue < CONFIG.minReward) {
        console.log(`   🚫 Filtered by MIN_REWARD: ${airdrop.name} ($${rewardValue} < $${CONFIG.minReward})`);
        return false;
      }
    }
  }

  return true;
}

// Check Instant Offer passes custom filter
function passesOfferFilter(offer) {
  if (CONFIG.allowedTypes && CONFIG.allowedTypes.length > 0) {
    const type = (offer.type || '').toLowerCase();
    const matches = CONFIG.allowedTypes.some(allowed => type.includes(allowed));
    if (!matches) {
      console.log(`   🚫 Offer filtered by ALLOWED_TYPES: ${offer.name} (${offer.type})`);
      return false;
    }
  }
  if (CONFIG.allowedChains && CONFIG.allowedChains.length > 0) {
    const chains = (offer.chains || []).map(c => (c || '').toLowerCase());
    const matches = CONFIG.allowedChains.some(allowed => 
      chains.some(c => c.includes(allowed) || allowed === 'multiple')
    );
    if (!matches) {
      console.log(`   🚫 Offer filtered by ALLOWED_CHAINS: ${offer.name}`);
      return false;
    }
  }
  if (CONFIG.blockedKeywords && CONFIG.blockedKeywords.length > 0) {
    const name = (offer.name || '').toLowerCase();
    if (CONFIG.blockedKeywords.some(kw => name.includes(kw))) {
      console.log(`   🚫 Offer filtered by BLOCKED_KEYWORDS: ${offer.name}`);
      return false;
    }
  }
  if (CONFIG.minReward > 0 && offer.reward) {
    const match = offer.reward.match(/\$(\d+)/);
    if (match && parseInt(match[1]) < CONFIG.minReward) {
      console.log(`   🚫 Offer filtered by MIN_REWARD: ${offer.name}`);
      return false;
    }
  }
  return true;
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

// Get Airdrops from DeFi Llama + More Sources (with Caching & Custom Filters)
async function getAirdrops() {
  // Check cache first
  const cachedAirdrops = cache.get('airdrops');
  if (cachedAirdrops) {
    console.log('📦 Using cached airdrops');
    const unclaimed = [];
    for (const airdrop of cachedAirdrops) {
      if (!await isClaimed(airdrop.name)) {
        if (passesCustomFilter(airdrop)) {
          unclaimed.push(airdrop);
        }
      }
    }
    console.log(`📦 ${unclaimed.length} unclaimed from cache (after custom filter)`);
    return unclaimed;
  }

  try {
    resetDailyStatsIfNewDay();
    console.log('🔍 Fetching airdrops...');
    
    let protocols = [];
    
    if (CONFIG.enableMoreSources) {
      console.log('📡 Using MORE SOURCES mode (DeFi Llama + CoinGecko + Galxe + Layer3 + Alert Sites)');
      const allAirdrops = await getAllAirdrops();
      // Convert allAirdrops to protocol-like objects for filtering
      // For DeFi Llama items we enrich, for others we use as-is
      protocols = allAirdrops.map(a => ({
        name: a.name,
        slug: a.slug || a.name.toLowerCase().replace(/\s+/g, '-'),
        url: a.url,
        chains: a.chains || [a.chain],
        tvl: a.tvl || 500000, // default for quest/trending sources
        category: a.category || a.type || 'DeFi',
        source: a.source,
        type: a.type,
        links: a.links || null,
        address: a.address || null,
      }));
      dailyStats.sourcesUsed = [...new Set(allAirdrops.map(a => a.source))];
      console.log(`📊 Aggregated ${protocols.length} items from all sources`);
    } else {
      console.log('📡 Using DeFi Llama only (ENABLE_MORE_SOURCES=false)');
      const response = await axios.get('https://api.llama.fi/protocols');
      protocols = response.data || [];
      dailyStats.sourcesUsed = ['defillama'];
    }

    const airdrops = [];
    let count = 0;
    let scanned = 0;

    for (const protocol of protocols) {
      scanned++;
      // TVL filter (use custom MIN_TVL)
      if (protocol.tvl && protocol.tvl < CONFIG.minTvl) continue;
      if (!protocol.tvl && CONFIG.minTvl > 100000) {
        // Skip TVL check for quest/trending sources (they have tvl 0)
        if (protocol.source === 'defillama') continue;
      }
      if (isIndianProject(protocol.name)) {
        console.log(`🚫 Blocked Indian project: ${protocol.name}`);
        dailyStats.blocked++;
        continue;
      }
      if (await isInBlacklist(protocol.name)) {
        console.log(`🚫 Blacklisted project: ${protocol.name}`);
        dailyStats.blocked++;
        continue;
      }
      if (await isClaimed(protocol.name)) {
        console.log(`✅ Already claimed: ${protocol.name}`);
        dailyStats.skipped++;
        continue;
      }

      // Custom filter check
      const tempAirdrop = {
        name: protocol.name,
        chain: protocol.chains ? protocol.chains[0] : protocol.chain || 'Ethereum',
        chains: protocol.chains || [protocol.chain],
        tvl: protocol.tvl,
        category: protocol.category,
        type: protocol.type,
        reward: protocol.reward || null,
      };
      if (!passesCustomFilter(tempAirdrop)) {
        dailyStats.skipped++;
        continue;
      }

      // Get social links
      const socialLinks = await getSocialLinks(protocol);

      // Smart contract check
      const contractCheck = await checkSmartContract(
        protocol.address,
        protocol.chains?.[0] || protocol.chain
      );

      // Team background check
      const teamCheck = await checkTeamBackground(protocol);

      // Profit calculation
      const profit = calculateProfit(protocol.tvl || 500000, protocol.category);

      airdrops.push({
        name: protocol.name,
        chain: protocol.chains ? protocol.chains[0] : protocol.chain || 'Ethereum',
        chains: protocol.chains || [protocol.chain],
        tvl: protocol.tvl || 500000,
        category: protocol.category || 'DeFi',
        url: protocol.url || `https://defillama.com/protocol/${protocol.slug}`,
        source: protocol.source || 'defillama',
        type: protocol.type || 'protocol',
        socialLinks,
        contractCheck,
        teamCheck,
        profit,
      });

      count++;
      // Limit to 10 airdrops per scan
      if (count >= 10) break;
    }

    dailyStats.scanned += scanned;
    dailyStats.verified += airdrops.length;

    // Cache for 10 minutes
    cache.set('airdrops', airdrops, 600);

    console.log(`✅ Found ${airdrops.length} airdrops (scanned ${scanned}, sources: ${dailyStats.sourcesUsed.join(', ')})`);
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

// Get Country/Region based on Chain
function getCountry(chain) {
  const chainCountries = {
    'Ethereum': 'Global (USA/EU)',
    'Bitcoin': 'Global (USA)',
    'Solana': 'Global (USA)',
    'Arbitrum': 'Global (USA/EU)',
    'Optimism': 'Global (USA/EU)',
    'Base': 'Global (USA)',
    'Polygon': 'India (BLOCKED)',
    'BSC': 'Global (Singapore)',
    'Avalanche': 'Global (USA)',
    'Fantom': 'Global (South Korea)',
    'Cronos': 'Global (Australia)',
    'Near': 'Global (Switzerland)',
    'Cosmos': 'Global (Switzerland)',
    'Cardano': 'Global (Japan/UK)',
    'Polkadot': 'Global (Germany)',
    'Tron': 'Global (Singapore)',
    'OKX Chain': 'Global (Seychelles)',
    'Sui': 'Global (USA)',
    'Aptos': 'Global (USA)',
  };

  return chainCountries[chain] || 'Global (Unknown)';
}

// Format Daily Summary Message
function formatDailySummary() {
  resetDailyStatsIfNewDay();
  const uptimeHours = Math.round((new Date() - dailyStats.startTime) / (1000 * 60 * 60));
  const queueSize = postQueue.length;
  const sentCount = sentPosts.size;
  
  let message = `📊 <b>DAILY SUMMARY</b> - ${dailyStats.date}\n\n`;
  
  message += `🔍 <b>Scanned:</b> ${dailyStats.scanned} projects\n`;
  message += `✅ <b>Verified:</b> ${dailyStats.verified} airdrops\n`;
  message += `📥 <b>Queued:</b> ${dailyStats.queued} posts\n`;
  message += `📤 <b>Sent:</b> ${dailyStats.sent} posts (Total sent: ${sentCount})\n`;
  message += `🚫 <b>Blocked:</b> ${dailyStats.blocked} (Indian/Blacklist)\n`;
  message += `⏭️ <b>Skipped:</b> ${dailyStats.skipped} (claimed/filtered)\n`;
  message += `📋 <b>Queue:</b> ${queueSize} remaining\n\n`;
  
  message += `📡 <b>Sources:</b> ${dailyStats.sourcesUsed.length > 0 ? dailyStats.sourcesUsed.join(', ') : 'DeFi Llama'}\n`;
  message += `⏰ <b>Uptime:</b> ${uptimeHours}h\n`;
  message += `⚙️ <b>Filters:</b> TVL ≥ $${CONFIG.minTvl.toLocaleString()}`;
  if (CONFIG.allowedChains) message += ` | Chains: ${CONFIG.allowedChains.join(',')}`;
  if (CONFIG.allowedTypes) message += ` | Types: ${CONFIG.allowedTypes.join(',')}`;
  if (CONFIG.minReward > 0) message += ` | Min Reward: $${CONFIG.minReward}`;
  message += `\n`;
  message += `🔄 <b>More Sources:</b> ${CONFIG.enableMoreSources ? 'ON' : 'OFF'}\n\n`;
  
  if (queueSize === 0 && dailyStats.verified === 0) {
    message += `💤 No new airdrops today - bot is watching 24/7!`;
  } else if (queueSize > 0) {
    message += `⏳ ${queueSize} posts will be sent one-by-one (5 min interval)`;
  } else {
    message += `✅ All caught up! Next scan in 5 minutes`;
  }
  
  return message;
}

// Send Daily Summary
async function sendDailySummary() {
  if (!CONFIG.dailySummaryEnabled) {
    console.log('📊 Daily summary disabled (DAILY_SUMMARY_ENABLED=false)');
    return;
  }
  console.log('\n📊 Sending Daily Summary...');
  const message = formatDailySummary();
  await sendTelegram(message);
  console.log('✅ Daily summary sent!');
}

// Format Single Airdrop Post (Simple & Clean)
function formatAirdropPost(airdrop) {
  const socialLinks = airdrop.socialLinks;
  const profit = airdrop.profit;
  const howToJoin = getHowToJoin(airdrop.category);
  const country = getCountry(airdrop.chain);

  let message = `🎯 <b>AIRDROP ALERT</b>\n\n`;

  message += `📌 <b>${airdrop.name}</b>\n`;
  message += `🔗 Chain: ${airdrop.chain}\n`;
  message += `🌍 Country: ${country}\n`;
  message += `💰 TVL: $${Math.round(airdrop.tvl).toLocaleString()}\n`;
  message += `📊 Category: ${airdrop.category || 'DeFi'}\n`;
  message += `📡 Source: ${airdrop.source ? airdrop.source.charAt(0).toUpperCase() + airdrop.source.slice(1) : 'DeFi Llama'}\n\n`;

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
  dailyStats.queued++;
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
      dailyStats.sent++;
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

    // Scan instant offers (with custom filter)
    const instantOffers = await getInstantOffers();
    if (instantOffers.length > 0) {
      console.log(`\n🎁 Found ${instantOffers.length} instant offers (before filter)`);
      let filteredOffers = 0;
      for (const offer of instantOffers) {
        if (!passesOfferFilter(offer)) {
          dailyStats.skipped++;
          continue;
        }
        filteredOffers++;
        addToQueue('offer', offer);
      }
      console.log(`🎁 ${filteredOffers}/${instantOffers.length} offers passed custom filter`);
    }

    if (airdrops.length === 0 && instantOffers.length === 0) {
      console.log('No new airdrops or offers found');
      // Don't send any message - only post when there's something to share
    }

    console.log(`📊 Queue size: ${postQueue.length} | Daily Stats: scanned=${dailyStats.scanned} verified=${dailyStats.verified} queued=${dailyStats.queued} sent=${dailyStats.sent}`);
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
  console.log('⚙️ Custom Filters:');
  console.log(`   MIN_TVL: $${CONFIG.minTvl.toLocaleString()}`);
  console.log(`   ALLOWED_CHAINS: ${CONFIG.allowedChains ? CONFIG.allowedChains.join(', ') : 'ALL'}`);
  console.log(`   ALLOWED_TYPES: ${CONFIG.allowedTypes ? CONFIG.allowedTypes.join(', ') : 'ALL'}`);
  console.log(`   MIN_REWARD: $${CONFIG.minReward}`);
  console.log(`   BLOCKED_KEYWORDS: ${CONFIG.blockedKeywords.length > 0 ? CONFIG.blockedKeywords.join(', ') : 'NONE'}`);
  console.log(`   MORE_SOURCES: ${CONFIG.enableMoreSources ? 'ENABLED (6 sources)' : 'DISABLED (DeFi Llama only)'}`);
  console.log(`   DAILY_SUMMARY: ${CONFIG.dailySummaryEnabled ? `ENABLED at ${CONFIG.dailySummaryTime} Asia/Dhaka` : 'DISABLED'}`);

  // Connect to database
  await connectDB();

  // Schedule regular scans (every 5 minutes)
  cron.schedule(CONFIG.checkInterval, scanAirdrops, {
    scheduled: true,
    timezone: "Asia/Dhaka"
  });

  // Schedule Daily Summary
  if (CONFIG.dailySummaryEnabled) {
    const [hour, minute] = CONFIG.dailySummaryTime.split(':').map(Number);
    const cronTime = `${minute} ${hour} * * *`;
    cron.schedule(cronTime, sendDailySummary, {
      scheduled: true,
      timezone: "Asia/Dhaka"
    });
    console.log(`📊 Daily Summary scheduled at ${CONFIG.dailySummaryTime} Asia/Dhaka (cron: ${cronTime})`);
  }

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

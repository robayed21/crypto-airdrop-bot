const axios = require('axios');

// DeFi Llama - All protocols with potential airdrops (Primary Source)
async function getDefiLlamaAirdrops() {
  try {
    console.log('   📡 Fetching from DeFi Llama...');
    const response = await axios.get('https://api.llama.fi/protocols', {
      timeout: 15000,
    });

    const protocols = response.data || [];

    const potentialAirdrops = protocols
      .filter(p => {
        if (p.category === 'CEX') return false;
        if (!p.tvl || p.tvl < 100000) return false;
        if (p.symbol && p.mcap && p.mcap > 0) return false;
        return true;
      })
      .map(p => ({
        name: p.name,
        slug: p.slug,
        url: p.url || `https://defillama.com/protocol/${p.slug}`,
        chain: p.chains?.[0] || 'Ethereum',
        chains: p.chains || ['Ethereum'],
        tvl: p.tvl,
        category: p.category,
        source: 'defillama',
        type: 'protocol',
        estimatedValue: 0,
        links: p.links || null,
      }));

    console.log(`   ✅ Found ${potentialAirdrops.length} potential airdrops from DeFi Llama`);
    return potentialAirdrops;
  } catch (error) {
    console.error('   ❌ DeFi Llama error:', error.message);
    return [];
  }
}

// CoinGecko - Trending / New coins that may have airdrops
async function getCoinGeckoAirdrops() {
  try {
    console.log('   📡 Fetching from CoinGecko...');
    const response = await axios.get('https://api.coingecko.com/api/v3/search/trending', {
      timeout: 8000,
      headers: { 'Accept': 'application/json' },
    });

    const coins = response.data?.coins || [];
    
    const airdrops = coins
      .slice(0, 10)
      .map(item => {
        const c = item.item;
        return {
          name: c.name,
          slug: c.id || c.symbol?.toLowerCase(),
          url: `https://www.coingecko.com/en/coins/${c.id}`,
          chain: 'Multiple',
          tvl: 0,
          category: 'Trending',
          source: 'coingecko',
          type: 'trending',
          estimatedValue: 0,
        };
      });

    console.log(`   ✅ Found ${airdrops.length} from CoinGecko`);
    return airdrops;
  } catch (error) {
    console.error('   ❌ CoinGecko error:', error.message);
    return [];
  }
}

// Galxe - Quest-based airdrops (public curated + API attempt)
async function getGalxeAirdrops() {
  try {
    console.log('   📡 Fetching from Galxe...');
    // Try Galxe public API
    try {
      const response = await axios.get('https://graphigo.prd.galaxy.eco/query', {
        method: 'POST',
        timeout: 6000,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({
          operationName: 'campaigns',
          query: `query campaigns { campaigns(first: 5) { list { id name type status } } }`,
          variables: {}
        })
      });
      if (response.data?.data?.campaigns?.list?.length > 0) {
        const campaigns = response.data.data.campaigns.list;
        return campaigns.map(c => ({
          name: c.name,
          slug: `galxe-${c.id}`,
          url: `https://galxe.com/campaign/${c.id}`,
          chain: 'Multiple',
          tvl: 0,
          category: 'Quest',
          source: 'galxe',
          type: 'quest',
          estimatedValue: 0,
        }));
      }
    } catch (e) {
      // Fallback to curated Galxe quests
    }

    // Curated active Galxe campaigns (verified FREE quests)
    const curated = [
      { name: 'Galxe Base Quest', url: 'https://galxe.com/Base', chain: 'Base', category: 'Quest' },
      { name: 'Galxe Arbitrum Quest', url: 'https://galxe.com/Arbitrum', chain: 'Arbitrum', category: 'Quest' },
      { name: 'Galxe Optimism Quest', url: 'https://galxe.com/Optimism', chain: 'Optimism', category: 'Quest' },
      { name: 'Galxe Linea Quest', url: 'https://galxe.com/Linea', chain: 'Linea', category: 'Quest' },
      { name: 'Galxe zkSync Quest', url: 'https://galxe.com/zksync', chain: 'zkSync', category: 'Quest' },
    ];

    const airdrops = curated.map(c => ({
      name: c.name,
      slug: c.name.toLowerCase().replace(/\s+/g, '-'),
      url: c.url,
      chain: c.chain,
      tvl: 0,
      category: c.category,
      source: 'galxe',
      type: 'quest',
      estimatedValue: 0,
    }));

    console.log(`   ✅ Found ${airdrops.length} from Galxe (curated)`);
    return airdrops;
  } catch (error) {
    console.error('   ❌ Galxe error:', error.message);
    return [];
  }
}

// Layer3 - Quest-based airdrops
async function getLayer3Airdrops() {
  try {
    console.log('   📡 Fetching from Layer3...');
    try {
      const response = await axios.get('https://api.layer3.xyz/api/quests?limit=5', {
        timeout: 6000,
        headers: { 'Accept': 'application/json' },
      });
      const quests = response.data?.data || response.data?.quests || [];
      if (Array.isArray(quests) && quests.length > 0) {
        return quests.slice(0, 5).map(q => ({
          name: q.title || q.name || 'Layer3 Quest',
          slug: q.slug || q.id || 'layer3-quest',
          url: `https://layer3.xyz/quests/${q.slug || q.id}`,
          chain: q.chain || 'Multiple',
          tvl: 0,
          category: 'Quest',
          source: 'layer3',
          type: 'quest',
          estimatedValue: 0,
        }));
      }
    } catch (e) {
      // Fallback to curated
    }

    // Curated Layer3 quests
    const curated = [
      { name: 'Layer3 Daily Quest', url: 'https://layer3.xyz/quests', chain: 'Multiple', category: 'Quest' },
      { name: 'Layer3 Super Streak', url: 'https://layer3.xyz/streak', chain: 'Multiple', category: 'Quest' },
    ];

    const airdrops = curated.map(c => ({
      name: c.name,
      slug: c.name.toLowerCase().replace(/\s+/g, '-'),
      url: c.url,
      chain: c.chain,
      tvl: 0,
      category: c.category,
      source: 'layer3',
      type: 'quest',
      estimatedValue: 0,
    }));

    console.log(`   ✅ Found ${airdrops.length} from Layer3 (curated)`);
    return airdrops;
  } catch (error) {
    console.error('   ❌ Layer3 error:', error.message);
    return [];
  }
}

// Airdrop Alert Websites
async function getAirdropAlerts() {
  try {
    console.log('   📡 Fetching from alert sites...');
    const airdrops = [];

    const sources = [
      {
        name: 'Airdrops.io',
        url: 'https://airdrops.io/wp-json/wp/v2/posts?per_page=10',
      },
      {
        name: 'CoinGecko-Airdrops',
        url: 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_asc&per_page=5&page=1&sparkline=false',
      },
    ];

    for (const source of sources) {
      try {
        const response = await axios.get(source.url, { timeout: 7000 });
        if (response.data) {
          const parsed = parseAirdropSource(response.data, source.name);
          airdrops.push(...parsed);
        }
      } catch (e) {
        // Skip failed source
      }
    }

    console.log(`   ✅ Found ${airdrops.length} from alert sites`);
    return airdrops;
  } catch (error) {
    console.error('   ❌ Alert sites error:', error.message);
    return [];
  }
}

// Twitter Search for Airdrops (optional, requires token)
async function searchTwitterAirdrops() {
  if (!process.env.TWITTER_BEARER_TOKEN) {
    console.log('   ⚠️ Twitter not configured - skipping');
    return [];
  }

  try {
    console.log('   📡 Searching Twitter...');
    const queries = [
      'airdrop live now -is:retweet lang:en',
      'claim free tokens -is:retweet lang:en',
      'new crypto airdrop -is:retweet lang:en',
    ];

    const results = [];

    for (const query of queries) {
      try {
        const response = await axios.get(
          'https://api.twitter.com/2/tweets/search/recent',
          {
            headers: {
              Authorization: `Bearer ${process.env.TWITTER_BEARER_TOKEN}`,
            },
            params: {
              query: query,
              max_results: 10,
            },
            timeout: 7000,
          }
        );

        if (response.data?.data) {
          results.push(...response.data.data);
        }
      } catch (e) {
        // Rate limited or error
      }
    }

    const airdrops = results.map(tweet => ({
      name: extractProjectName(tweet.text),
      description: tweet.text.substring(0, 200),
      url: `https://twitter.com/i/status/${tweet.id}`,
      chain: 'Multiple',
      source: 'twitter',
      type: 'social',
      estimatedValue: 0,
    }));

    console.log(`   ✅ Found ${airdrops.length} from Twitter`);
    return airdrops;
  } catch (error) {
    console.error('   ❌ Twitter error:', error.message);
    return [];
  }
}

// Extract project name from tweet
function extractProjectName(text) {
  const patterns = [
    /@(\w+)/,
    /#(\w+)/,
    /(?:airdrop|claim|free).*?(\w+)\s/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return 'Unknown Project';
}

// Parse airdrop source data
function parseAirdropSource(data, sourceName) {
  if (!Array.isArray(data)) return [];

  return data
    .filter(item => item.title || item.name)
    .map(item => ({
      name: item.title?.rendered || item.name || 'Unknown',
      url: item.link || item.url || '#',
      chain: item.chain || 'Ethereum',
      source: sourceName.toLowerCase(),
      type: 'airdrop',
      estimatedValue: item.value || 0,
    }));
}

// Get all airdrops from ALL sources (aggregated)
async function getAllAirdrops() {
  console.log('\n📡 Gathering airdrops from ALL sources...');

  const results = await Promise.allSettled([
    getDefiLlamaAirdrops(),
    getCoinGeckoAirdrops(),
    getGalxeAirdrops(),
    getLayer3Airdrops(),
    getAirdropAlerts(),
    searchTwitterAirdrops(),
  ]);

  const sourceNames = ['DeFi Llama', 'CoinGecko', 'Galxe', 'Layer3', 'Alert Sites', 'Twitter'];
  let allAirdrops = [];

  results.forEach((result, index) => {
    const sourceName = sourceNames[index];
    if (result.status === 'fulfilled') {
      allAirdrops.push(...result.value);
      console.log(`   📊 ${sourceName}: ${result.value.length} items`);
    } else {
      console.log(`   ❌ ${sourceName} failed: ${result.reason?.message}`);
    }
  });

  // Remove duplicates by name (case-insensitive)
  const seen = new Set();
  const unique = allAirdrops.filter(airdrop => {
    const key = airdrop.name.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`\n📊 Total unique airdrops from ALL sources: ${unique.length}`);
  return unique;
}

module.exports = {
  getDefiLlamaAirdrops,
  getCoinGeckoAirdrops,
  getGalxeAirdrops,
  getLayer3Airdrops,
  getAirdropAlerts,
  searchTwitterAirdrops,
  getAllAirdrops,
};

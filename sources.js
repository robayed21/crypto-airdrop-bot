const axios = require('axios');

// DeFi Llama - All protocols with potential airdrops
async function getDefiLlamaAirdrops() {
  try {
    console.log('   📡 Fetching from DeFi Llama...');
    const response = await axios.get('https://api.llama.fi/protocols', {
      timeout: 10000,
    });

    const protocols = response.data || [];

    // Filter protocols that might have airdrops
    const potentialAirdrops = protocols
      .filter(p => {
        // Not CEX
        if (p.category === 'CEX') return false;
        // Has TVL
        if (!p.tvl || p.tvl < 100000) return false;
        // Not already token launched (heuristic)
        if (p.symbol && p.mcap && p.mcap > 0) return false;
        return true;
      })
      .map(p => ({
        name: p.name,
        slug: p.slug,
        url: `https://defillama.com/protocol/${p.slug}`,
        chain: p.chains?.[0] || 'Ethereum',
        tvl: p.tvl,
        category: p.category,
        source: 'defillama',
        type: 'protocol',
        estimatedValue: 0,
      }));

    console.log(`   ✅ Found ${potentialAirdrops.length} potential airdrops`);
    return potentialAirdrops;
  } catch (error) {
    console.error('   ❌ DeFi Llama error:', error.message);
    return [];
  }
}

// Airdrop Alert Websites
async function getAirdropAlerts() {
  try {
    console.log('   📡 Fetching from alert sites...');
    const airdrops = [];

    // Try multiple sources
    const sources = [
      {
        name: 'Airdrops.io',
        url: 'https://airdrops.io/wp-json/wp/v2/posts?per_page=10',
      },
      {
        name: 'CoinGecko',
        url: 'https://api.coingecko.com/api/v3/airdrops',
      },
    ];

    for (const source of sources) {
      try {
        const response = await axios.get(source.url, { timeout: 5000 });

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

// Twitter Search for Airdrops
async function searchTwitterAirdrops() {
  if (!process.env.TWITTER_BEARER_TOKEN) {
    console.log('   ⚠️ Twitter not configured');
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
            timeout: 5000,
          }
        );

        if (response.data?.data) {
          results.push(...response.data.data);
        }
      } catch (e) {
        // Rate limited or error
      }
    }

    // Parse tweets into airdrop objects
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
  // Try to find project name patterns
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

// Get all airdrops from all sources
async function getAllAirdrops() {
  console.log('\n📡 Gathering airdrops from all sources...');

  const results = await Promise.allSettled([
    getDefiLlamaAirdrops(),
    getAirdropAlerts(),
    searchTwitterAirdrops(),
  ]);

  let allAirdrops = [];

  results.forEach((result, index) => {
    const sourceName = ['DeFi Llama', 'Alert Sites', 'Twitter'][index];
    if (result.status === 'fulfilled') {
      allAirdrops.push(...result.value);
    } else {
      console.log(`   ❌ ${sourceName} failed`);
    }
  });

  // Remove duplicates by name
  const unique = allAirdrops.filter(
    (airdrop, index, self) =>
      index === self.findIndex(a => a.name === airdrop.name)
  );

  console.log(`\n📊 Total unique airdrops: ${unique.length}`);
  return unique;
}

module.exports = {
  getDefiLlamaAirdrops,
  getAirdropAlerts,
  searchTwitterAirdrops,
  getAllAirdrops,
};

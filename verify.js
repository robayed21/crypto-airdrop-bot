const axios = require('axios');

// Indian Projects List (BLOCKED)
const INDIAN_PROJECTS = [
  'polygon', 'matic', 'wazirx', 'coincx', 'giottus',
  'zebpay', 'unocoin', 'coinsecure', 'koinex', 'bitbns',
  'buyucoin', 'coinswitch', 'cowry', 'paytm crypto',
  'jio coin', 'reliance crypto', 'tata coin', 'adani coin',
];

// Suspicious Keywords
const SUSPICIOUS_KEYWORDS = [
  'rug', 'scam', 'honeypot', 'ponzi', 'too good to be true',
  'guaranteed profit', '100x', 'get rich quick',
];

// Check if Indian Project
function isIndianProject(project) {
  const name = (project.name || '').toLowerCase();
  const desc = (project.description || '').toLowerCase();

  return INDIAN_PROJECTS.some(indian =>
    name.includes(indian) || desc.includes(indian)
  );
}

// Check if Suspicious
function isSuspicious(project) {
  const name = (project.name || '').toLowerCase();
  const desc = (project.description || '').toLowerCase();

  return SUSPICIOUS_KEYWORDS.some(word =>
    name.includes(word) || desc.includes(word)
  );
}

// Check Social Media Presence
async function checkSocialPresence(project) {
  try {
    // Check Twitter
    if (project.twitter) {
      const twitterRes = await axios.get(
        `https://api.twitter.com/2/users/by/username/${project.twitter}`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.TWITTER_BEARER_TOKEN}`,
          },
        }
      );

      const followers = twitterRes.data?.data?.public_metrics?.followers_count || 0;
      if (followers < 500) return false;
    }

    // Check Discord
    if (project.discordId) {
      const discordRes = await axios.get(
        `https://discord.com/api/guilds/${project.discordId}`
      );

      const members = discordRes.data?.approximate_member_count || 0;
      if (members < 1000) return false;
    }

    return true;
  } catch (error) {
    return false;
  }
}

// Check Contract Audit
async function checkAudit(project) {
  try {
    if (!project.contractAddress) return false;

    // Check with various audit APIs
    const auditServices = [
      `https://api.gopluslabs.com/api/v1/token_security/${project.chainId || 1}?contract_addresses=${project.contractAddress}`,
    ];

    for (const service of auditServices) {
      try {
        const response = await axios.get(service, { timeout: 3000 });
        if (response.data?.result?.is_open_source === '1') {
          return true;
        }
      } catch (e) {
        // Continue to next service
      }
    }

    return false;
  } catch (error) {
    return false;
  }
}

// Check Liquidity
async function checkLiquidity(project) {
  try {
    if (!project.contractAddress) return true; // Skip if no contract

    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${project.contractAddress}`,
      { timeout: 3000 }
    );

    const pairs = response.data?.pairs || [];
    const totalLiquidity = pairs.reduce(
      (sum, pair) => sum + (pair.liquidity?.usd || 0),
      0
    );

    return totalLiquidity >= 10000; // Minimum $10k liquidity
  } catch (error) {
    return false;
  }
}

// Main Verification Function
async function verifyProject(project) {
  console.log(`\n🔍 Verifying: ${project.name}`);

  const checks = {
    // 1. Not Indian
    notIndian: !isIndianProject(project),
    // 2. Not Suspicious
    notSuspicious: !isSuspicious(project),
    // 3. Has Social
    hasSocial: await checkSocialPresence(project),
    // 4. Has Liquidity
    hasLiquidity: await checkLiquidity(project),
    // 5. Contract Verified (optional)
    contractVerified: await checkAudit(project),
  };

  const passed = Object.values(checks).filter(v => v === true).length;
  const total = Object.keys(checks).length;

  const result = {
    verified: passed >= 4,
    score: passed,
    total: total,
    checks: checks,
    riskLevel: passed >= 5 ? 'LOW' : passed >= 4 ? 'MEDIUM' : 'HIGH',
  };

  console.log(`   Score: ${passed}/${total}`);
  console.log(`   Risk: ${result.riskLevel}`);

  return result;
}

module.exports = {
  verifyProject,
  isIndianProject,
  isSuspicious,
  checkSocialPresence,
  checkAudit,
  checkLiquidity,
  INDIAN_PROJECTS,
};

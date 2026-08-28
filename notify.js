const axios = require('axios');

// Send Telegram Message
async function sendTelegram(message) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log('   ⚠️ Telegram not configured');
    return false;
  }

  try {
    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }
    );
    console.log('   📱 Telegram sent!');
    return true;
  } catch (error) {
    console.error('   ❌ Telegram error:', error.message);
    return false;
  }
}

// Send Discord Webhook
async function sendDiscord(message) {
  if (!process.env.DISCORD_WEBHOOK) {
    console.log('   ⚠️ Discord not configured');
    return false;
  }

  try {
    await axios.post(process.env.DISCORD_WEBHOOK, {
      content: message.replace(/\*/g, '').replace(/_/g, ''),
    });
    console.log('   💬 Discord sent!');
    return true;
  } catch (error) {
    console.error('   ❌ Discord error:', error.message);
    return false;
  }
}

// Notify New Airdrop Found
async function notifyNewAirdrop(airdrop, verification) {
  const message = `
🔔 *NEW AIRDROP FOUND!*

*Project:* ${airdrop.name}
*Chain:* ${airdrop.chain || 'Multiple'}
*Value:* $${airdrop.estimatedValue || 'TBA'}
*Source:* ${airdrop.source}

*Verification:* ${verification.verified ? '✅ PASSED' : '⚠️ PENDING'}
*Risk Level:* ${verification.riskLevel}
*Score:* ${verification.score}/${verification.total}

*Link:* ${airdrop.url}

_Gas Optimization: ON_
_Auto-Claim: ${verification.verified ? 'ENABLED' : 'WAITING'}_
  `.trim();

  await sendTelegram(message);
  await sendDiscord(message);
}

// Notify Claim Success
async function notifyClaimSuccess(airdrop, txHash) {
  const chainExplorer = {
    ethereum: 'https://etherscan.io/tx/',
    bsc: 'https://bscscan.com/tx/',
    polygon: 'https://polygonscan.com/tx/',
    arbitrum: 'https://arbiscan.io/tx/',
    optimism: 'https://optimistic.etherscan.io/tx/',
  };

  const explorer = chainExplorer[airdrop.chain?.toLowerCase()] || 'https://etherscan.io/tx/';

  const message = `
✅ *AIRDROP CLAIMED!*

*Project:* ${airdrop.name}
*Chain:* ${airdrop.chain}
*Value:* $${airdrop.estimatedValue || 'Unknown'}

*Transaction:* [View](${explorer}${txHash})

_Claimed successfully! Check your wallet._
  `.trim();

  await sendTelegram(message);
  await sendDiscord(message);
}

// Notify Claim Failed
async function notifyClaimFailed(airdrop, error) {
  const message = `
❌ *CLAIM FAILED*

*Project:* ${airdrop.name}
*Chain:* ${airdrop.chain}
*Error:* ${error}

_May require manual claim. Check the project website._
  `.trim();

  await sendTelegram(message);
  await sendDiscord(message);
}

// Notify Daily Summary
async function notifyDailySummary(stats) {
  const message = `
📊 *DAILY SUMMARY*

*Scanned:* ${stats.scanned} projects
*Verified:* ${stats.verified} projects
*Claimed:* ${stats.claimed} airdrops
*Failed:* ${stats.failed} airdrops
*Skipped:* ${stats.skipped} (Indian/Suspicious)

*Total Value:* $${stats.totalValue || 'Calculating...'}

_Next scan in 5 minutes_
  `.trim();

  await sendTelegram(message);
  await sendDiscord(message);
}

module.exports = {
  sendTelegram,
  sendDiscord,
  notifyNewAirdrop,
  notifyClaimSuccess,
  notifyClaimFailed,
  notifyDailySummary,
};

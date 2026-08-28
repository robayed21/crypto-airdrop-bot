# 🚀 Crypto Airdrop Hunter Bot

Auto-detect and claim crypto airdrops with verification system.

## ✅ Features

- **Auto Monitor** - 24/7 scan new airdrops
- **Indian Project Filter** - Auto-block Indian projects
- **Verification System** - 5-step verification before claim
- **Auto Claim** - Instant airdrop claiming
- **Notifications** - Telegram/Discord alerts
- **Gas Optimization** - Wait for low gas fees

## 📦 Installation

```bash
# Clone project
cd crypto-airdrop-bot

# Install dependencies
npm install

# Setup config
cp .env.example .env
# Edit .env with your details
```

## ⚙️ Configuration

Edit `.env` file:

```env
# Your wallet
WALLET_ADDRESS=0xYourAddress
PRIVATE_KEY=your_private_key

# RPC Provider (Alchemy/Infura)
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY

# Telegram Notification
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Twitter (Optional)
TWITTER_BEARER_TOKEN=your_token
```

## 🚀 Run Bot

```bash
# Start bot
npm start

# Or with auto-restart
npm run dev
```

## 📁 Project Structure

```
crypto-airdrop-bot/
├── bot.js          # Main bot logic
├── verify.js       # Verification system
├── sources.js      # Airdrop sources
├── notify.js       # Notifications
├── test.js         # Test file
├── .env            # Config (don't commit!)
├── package.json
└── README.md
```

## 🔐 Verification Checks

| Check | Description |
|-------|-------------|
| ✅ Not Indian | Block Indian projects |
| ✅ Not Suspicious | Avoid scams |
| ✅ Has Social | Twitter/Discord presence |
| ✅ Has Liquidity | Minimum $10k |
| ✅ Contract Verified | Audited contract |

## 🛡️ Safety

- Use a **separate wallet** for airdrops
- **Never share** your private key
- **Test first** with small amounts
- **Verify** contracts before approving

## 📱 Notifications

### Telegram Setup
1. Create bot via @BotFather
2. Get bot token
3. Get chat ID via @userinfobot
4. Add to `.env`

### Discord Setup
1. Server Settings > Integrations > Webhooks
2. Create webhook
3. Copy URL to `.env`

## 🔧 Supported Chains

- Ethereum
- BSC (Binance Smart Chain)
- Polygon
- Arbitrum
- Optimism

## ⚠️ Disclaimer

This bot is for educational purposes. Use at your own risk. Always verify airdrops before claiming.

## 📝 License

ISC

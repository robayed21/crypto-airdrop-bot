// Test file for crypto airdrop bot

const { verifyProject, isIndianProject } = require('./verify');
const { getAllAirdrops } = require('./sources');
const { sendTelegram } = require('./notify');

// Test Indian Project Filter
console.log('=== Testing Indian Project Filter ===\n');

const testProjects = [
  { name: 'Polygon', description: 'Indian blockchain' },
  { name: 'WazirX', description: 'Indian exchange' },
  { name: 'Uniswap', description: 'DEX on Ethereum' },
  { name: 'Aave', description: 'DeFi lending' },
  { name: 'Optimism', description: 'L2 scaling' },
];

testProjects.forEach(project => {
  const result = isIndianProject(project);
  console.log(`${project.name}: ${result ? '❌ BLOCKED (Indian)' : '✅ ALLOWED'}`);
});

// Test Verification
console.log('\n=== Testing Verification ===\n');

const testAirdrop = {
  name: 'Test Protocol',
  chain: 'Ethereum',
  url: 'https://example.com',
  source: 'defillama',
  tvl: 500000,
};

verifyProject(testAirdrop).then(result => {
  console.log('\nVerification Result:', result);
});

// Test Sources (optional - uncomment to test)
/*
console.log('\n=== Testing Sources ===\n');

getAllAirdrops().then(airdrops => {
  console.log('\nAirdrops found:', airdrops.length);
  airdrops.slice(0, 5).forEach(airdrop => {
    console.log(`- ${airdrop.name} (${airdrop.chain})`);
  });
});
*/

console.log('\n=== Tests Complete ===');

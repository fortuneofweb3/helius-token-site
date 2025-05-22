const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const HELIUS_API_KEY = 'bdd50eae-c7f0-4924-8594-fff7f2199038';
const HELIUS_BASE_URL = 'https://api.helius.xyz';
const WALLET_ADDRESS = 'BAGSB9TpGrZxQbEsrEznv5jXXdwyP6AXerN8aVRiAmcv';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const CACHE_REFRESH_MS = 300000; // 5 minutes
const MAX_MINTS = 100;
const MAX_RETRIES = 7;
const BASE_DELAY_MS = 1000;

// In-memory cache
let cache = {
  mints: [],
  lastFetchTimestamp: 0,
};

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.static(path.join(__dirname, 'public')));

// Utility: Delay execution
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Utility: Make Helius API call with retries
async function makeHeliusApiCall(path, retries = MAX_RETRIES, callName = 'Helius API') {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const url = `${HELIUS_BASE_URL}${path}${path.includes('?') ? '&' : '?'}api-key=${HELIUS_API_KEY}`;
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      if (error.response?.status === 429) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`429 error on ${callName}. Retrying (${attempt}/${retries}) after ${delayMs}ms...`);
        await delay(delayMs);
        continue;
      }
      console.error(`Attempt ${attempt} failed for ${callName}: ${error.message}`);
      if (attempt === retries) throw new Error(`Failed ${callName} after ${retries} retries: ${error.message}`);
    }
  }
}

// Check if transaction creates a token mint
async function isTokenMintTransaction(tx) {
  if (!tx) {
    console.log(`Skipping tx: No transaction data`);
    return null;
  }

  console.log(`Inspecting tx ${tx.signature}:`, {
    type: tx.type,
    feePayer: tx.feePayer,
    tokenTransfers: tx.tokenTransfers ? tx.tokenTransfers.map(t => t.mint) : null,
    hasTokenProgram: tx.instructions.some(ix => ix.programId === TOKEN_PROGRAM_ID),
  });

  if (tx.feePayer !== WALLET_ADDRESS) {
    console.log(`Skipping tx ${tx.signature}: ${WALLET_ADDRESS} is not the feePayer`);
    return null;
  }

  if (tx.type === 'TOKEN_MINT' && tx.tokenTransfers && tx.tokenTransfers.length > 0 && tx.tokenTransfers[0].mint) {
    console.log(`Found mint in tx ${tx.signature}: ${tx.tokenTransfers[0].mint}`);
    return {
      mint: tx.tokenTransfers[0].mint,
      timestamp: tx.timestamp,
      signature: tx.signature,
    };
  }

  const innerInstructions = tx.instructions
    .filter(ix => ix.programId === TOKEN_PROGRAM_ID)
    .flatMap(ix => ix.innerInstructions || []);

  for (const innerIx of innerInstructions) {
    for (const instruction of innerIx) {
      if (
        instruction.programId === TOKEN_PROGRAM_ID &&
        instruction.parsed?.type === 'initializeMint2' &&
        instruction.parsed.info.mint
      ) {
        console.log(`Found mint in tx ${tx.signature} (initializeMint2): ${instruction.parsed.info.mint}`);
        return {
          mint: instruction.parsed.info.mint,
          timestamp: tx.timestamp,
          signature: tx.signature,
        };
      }
    }
  }

  console.log(`Skipping tx ${tx.signature}: No mint found`);
  return null;
}

// Cache endpoint
app.get('/cache', async (req, res) => {
  try {
    const now = Date.now();
    if (now - cache.lastFetchTimestamp < CACHE_REFRESH_MS && cache.mints.length > 0) {
      console.log('Serving cached mints');
      return res.json({ mints: cache.mints, fromCache: true });
    }

    console.log('Fetching new mints');
    const mints = [];
    let before = '';
    let mintCount = 0;

    while (mintCount < MAX_MINTS) {
      const path = `/v0/addresses/${WALLET_ADDRESS}/transactions${before ? `&before=${before}` : ''}`;
      const transactions = await makeHeliusApiCall(path, MAX_RETRIES, 'Wallet Transactions');

      if (!transactions || transactions.length === 0) {
        console.log('No more transactions to process');
        break;
      }

      console.log('Fetched transaction signatures:', transactions.map(tx => tx.signature));

      for (const tx of transactions) {
        const mintData = await isTokenMintTransaction(tx);
        if (mintData) {
          mints.push(mintData);
          mintCount++;
          console.log(`Mint ${mintCount}/${MAX_MINTS} added: ${mintData.mint}`);
          if (mintCount >= MAX_MINTS) break;
        }
        await delay(1000); // Throttle requests
      }

      if (mintCount >= MAX_MINTS) break;
      before = transactions[transactions.length - 1].signature;
    }

    cache = {
      mints: mints.sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_MINTS),
      lastFetchTimestamp: now,
    };

    res.json({ mints: cache.mints, fromCache: false });
  } catch (error) {
    console.error('Error fetching mints:', error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy endpoint for Helius API (kept for potential other uses)
app.get('/proxy/helius', async (req, res) => {
  try {
    const apiPath = req.query.path;
    if (!apiPath) return res.status(400).json({ error: 'Missing path query parameter' });
    const data = await makeHeliusApiCall(apiPath);
    res.json(data);
  } catch (error) {
    console.error(`Proxy error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

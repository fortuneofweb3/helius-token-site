console.log('Script loaded: index.js');

const PROXY_URL = '/proxy/helius';
const WALLET_ADDRESS = 'BAGSB9TpGrZxQbEsrEznv5jXXdwyP6AXerN8aVRiAmcv';
const CACHE_EXPIRY_MS = 3600000; // 1 hour for individual mints
const CACHE_REFRESH_MS = 300000; // 5 minutes for refetch
const MAX_RETRIES = 7;
const BASE_DELAY_MS = 1000;
const REQUESTS_PER_SECOND = 1;
const MAX_MINTS = 100;

// Utility: Delay execution
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Utility: Format timestamp
const formatTimestamp = timestamp => new Date(timestamp * 1000).toLocaleString();

// Utility: Make API call with retries
async function makeApiCall(path, retries = MAX_RETRIES, callName = 'API') {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${PROXY_URL}?path=${encodeURIComponent(path)}`);
      if (response.status === 429) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`429 error on ${callName}. Retrying (${attempt}/${retries}) after ${delayMs}ms...`);
        await delay(delayMs);
        continue;
      }
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`HTTP error! Status: ${response.status}, Details: ${JSON.stringify(errorData)}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Attempt ${attempt} failed for ${callName}: ${error.message}`);
      if (attempt === retries) throw new Error(`Failed ${callName} after ${retries} retries: ${error.message}`);
    }
  }
}

// Cache management
const getCachedData = key => {
  const data = localStorage.getItem(key);
  if (!data) return null;
  const { value, timestamp } = JSON.parse(data);
  if (Date.now() - timestamp > CACHE_EXPIRY_MS) {
    localStorage.removeItem(key);
    return null;
  }
  return value;
};

const setCachedData = (key, value) => {
  localStorage.setItem(key, JSON.stringify({ value, timestamp: Date.now() }));
};

const getAllCachedData = () => {
  const allData = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('mint_')) {
      const mint = getCachedData(key);
      if (mint) allData.push(mint);
    }
  }
  return allData.sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_MINTS);
};

const getLastFetchTimestamp = () => {
  const data = localStorage.getItem('lastFetchTimestamp');
  if (!data) return 0;
  const { timestamp } = JSON.parse(data);
  return timestamp;
};

const setLastFetchTimestamp = () => {
  localStorage.setItem('lastFetchTimestamp', JSON.stringify({ timestamp: Date.now() }));
};

// Initialize table with cached data
function initializeTable(resultDiv, cachedMints = []) {
  let tableHtml = `
    <table id="mintTable">
      <thead>
        <tr>
          <th>Mint Address</th>
          <th>Created At</th>
          <th>Transaction</th>
        </tr>
      </thead>
      <tbody id="mintTableBody">
  `;
  cachedMints.forEach(mint => {
    tableHtml += `
      <tr>
        <td>${mint.mint}</td>
        <td>${formatTimestamp(mint.timestamp)}</td>
        <td><a href="https://explorer.solana.com/tx/${mint.signature}" target="_blank">${mint.signature.slice(0, 8)}...</a></td>
      </tr>
    `;
  });
  tableHtml += `
      </tbody>
    </table>
    <p id="status" class="loading">${cachedMints.length > 0 ? `Showing ${cachedMints.length} cached mints, fetching new data...` : 'Fetching token mints...'}</p>
  `;
  resultDiv.innerHTML = tableHtml;
}

// Append or update a single mint in the table
function appendMintToTable(mintData) {
  const tableBody = document.getElementById('mintTableBody');
  if (!tableBody) return;

  // Check if mint already exists (by signature)
  const existingRow = Array.from(tableBody.getElementsByTagName('tr')).find(row =>
    row.cells[2].innerHTML.includes(mintData.signature.slice(0, 8))
  );

  const row = document.createElement('tr');
  row.innerHTML

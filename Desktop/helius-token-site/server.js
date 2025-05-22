const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const HELIUS_API_KEY = 'bdd50eae-c7f0-4924-8594-fff7f2199038';
const HELIUS_BASE_URL = 'https://api.helius.xyz';

// Middleware
app.use(cors({ origin: '*' })); // Restrict to your site URL in production
app.use(express.static(path.join(__dirname, 'public')));

// Proxy endpoint for Helius API
app.get('/proxy/helius', async (req, res) => {
  try {
    const apiPath = req.query.path;
    if (!apiPath) {
      return res.status(400).json({ error: 'Missing path query parameter' });
    }
    const url = `${HELIUS_BASE_URL}${apiPath}${apiPath.includes('?') ? '&' : '?'}api-key=${HELIUS_API_KEY}`;
    console.log(`Proxy request: ${url}`);
    const response = await axios.get(url);
    res.json(response.data);
  } catch (error) {
    console.error(`Proxy error: ${error.message}`, {
      status: error.response?.status,
      data: error.response?.data,
    });
    res.status(error.response?.status || 500).json({
      error: error.message,
      details: error.response?.data,
    });
  }
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
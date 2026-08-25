/**
 * Deterministic test server for Runtime Investigator
 *
 * Serves test-page.html and API endpoints with controlled behavior
 * - GET /api/cart → { currency: null, items: [...] }
 * - POST /api/checkout (currency=null) → 422
 * - POST /api/checkout (currency=USD) → 200
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3000;

function serveTestPage(res) {
  const filePath = path.join(__dirname, 'public', 'test-page.html');
  const content = fs.readFileSync(filePath, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(content);
}

function apiGetCart(res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    currency: null,
    items: [{ id: 1, name: 'Test Item', price: 99.99 }],
    total: 99.99
  }));
}

function apiPostCheckout(body, res) {
  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  // Validation: currency is required
  if (!data.currency) {
    res.writeHead(422, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'currency_required',
      details: 'Currency must be specified'
    }));
    return;
  }

  // Success
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    orderId: `order_${Date.now()}`,
    status: 'success',
    amount: data.amount,
    currency: data.currency
  }));
}

const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Serve test page
  if (pathname === '/' || pathname === '/test-page.html') {
    serveTestPage(res);
    return;
  }

  // API endpoints
  if (pathname === '/api/cart') {
    apiGetCart(res);
    return;
  }

  if (pathname === '/api/checkout') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        apiPostCheckout(body, res);
      });
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`Test server listening on http://localhost:${PORT}`);
  console.log(`  - Test page: http://localhost:${PORT}/`);
  console.log(`  - API: POST http://localhost:${PORT}/api/checkout`);
  console.log('');
  console.log('Expected failure scenario:');
  console.log('  1. Load http://localhost:3000/');
  console.log('  2. Leave currency blank');
  console.log('  3. Click Checkout');
  console.log('  4. Expected: 422 + "currency_required" error');
});

'use strict';

const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3000;
const HALOPSA_URL = process.env.HALOPSA_URL || 'https://876cec92-f11e-46a8-b4e4-d6ac4f346b41.mock.pstmn.io/api/Tickets';

const SEVERITY_TO_PRIORITY = {
  critical: 1,
  warning: 2,
  info: 3,
};

function getPriorityId(severity) {
  return SEVERITY_TO_PRIORITY[severity] !== undefined
    ? SEVERITY_TO_PRIORITY[severity]
    : 4;
}

function postToHaloPSA(ticketPayload) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new url.URL(HALOPSA_URL);
    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;
    const body = JSON.stringify(ticketPayload);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + (parsedUrl.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });

    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', (err) => reject(err));
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url);

  if (req.method === 'GET' && parsedUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/webhook') {
    let rawBody;
    try {
      rawBody = await readBody(req);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read request body' }));
      return;
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      return;
    }

    const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
    const firingAlerts = alerts.filter((a) => a.status === 'firing');
    console.log(`[webhook] Received ${alerts.length} alert(s), ${firingAlerts.length} firing.`);

    const results = [];

    for (const alert of firingAlerts) {
      const summary = (alert.annotations && alert.annotations.summary) || 'No summary provided';
      const severity = (alert.labels && alert.labels.severity) || '';
      const priorityId = getPriorityId(severity);

      console.log(`[webhook] alert: summary="${summary}", severity="${severity}", priority_id=${priorityId}`);

      try {
        const response = await postToHaloPSA([{ summary, priority_id: priorityId }]);
        console.log(`[webhook] HaloPSA responded with status ${response.statusCode}`);
        results.push({
          alert: summary,
          severity,
          priority_id: priorityId,
          halopsa_status: response.statusCode,
          halopsa_response: JSON.parse(response.body),
        });
      } catch (err) {
        console.error(`[webhook] Failed to POST ticket for "${summary}":`, err.message);
        results.push({ alert: summary, severity, priority_id: priorityId, error: err.message });
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ processed: results.length, tickets: results }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`[server] Adapter listening on port ${PORT}`);
  console.log(`[server] HaloPSA target: ${HALOPSA_URL}`);
});
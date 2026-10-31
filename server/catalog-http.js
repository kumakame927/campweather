import https from 'node:https';
export function requestJson(url, { agent, body, timeout = 10000, maxBytes = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { agent, method: body ? 'POST' : 'GET', headers: { Accept: 'application/json', 'User-Agent': 'HareCamp-Catalog/1.0 (+https://github.com/kumakame927/campweather)', ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}) } }, res => {
      if (res.statusCode !== 200) { res.resume(); const error = new Error(`データ提供元がHTTP ${res.statusCode}を返しました。`); error.status = res.statusCode; error.retryAfter = Number(res.headers['retry-after']); reject(error); return; }
      const chunks = []; let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) req.destroy(new Error('データ量の上限を超えました。')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('JSONの応答を確認できません。')); } });
    });
    const timer = setTimeout(() => req.destroy(new Error('データ取得がタイムアウトしました。')), timeout);
    req.on('close', () => clearTimeout(timer)); req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const dns = require('dns').promises;
const net = require('net');

const allowed = new Set([80, 443]);
function blocked(h) {
  const x = h.toLowerCase().replace(/\.$/, '');
  if (x === 'localhost' || x.endsWith('.local')) return true;
  if (/^127\./.test(x) || /^10\./.test(x) || /^192\.168\./.test(x) || /^169\.254\./.test(x)) return true;
  const m = x.match(/^172\.(\d+)\./);
  return !!(m && +m[1] >= 16 && +m[1] <= 31);
}

async function test(host, port) {
  if (!allowed.has(port) || blocked(host)) return { host, port, ok:false, error:'blocked_or_port_not_allowed' };
  const started = Date.now();
  let addrs;
  try { addrs = await dns.lookup(host, { all: true, verbatim: false }); }
  catch (e) { return { host, port, ok:false, error:'dns_failed', detail:e.code || e.message }; }
  const ordered = [...addrs].sort((a,b) => (a.family === 4 ? -1 : 1));
  for (const a of ordered) {
    const result = await new Promise(resolve => {
      const s = net.createConnection({ host:a.address, port, family:a.family });
      const timer = setTimeout(() => { s.destroy(); resolve({ ok:false, error:'timeout' }); }, 7000);
      s.once('connect', () => { clearTimeout(timer); s.destroy(); resolve({ok:true}); });
      s.once('error', e => { clearTimeout(timer); resolve({ok:false,error:e.code || e.message}); });
    });
    if (result.ok) return { host, port, ok:true, family:a.family, address:a.address, connectMs:Date.now()-started };
  }
  return { host, port, ok:false, error:'all_addresses_failed', addresses:ordered.map(x=>({address:x.address,family:x.family})), connectMs:Date.now()-started };
}

module.exports = async (req, res) => {
  const targets = [
    ['google.com',443], ['youtube.com',443], ['instagram.com',443],
    ['telegram.org',443], ['cloudflare.com',443]
  ];
  const results = [];
  for (const [host,port] of targets) results.push(await test(host,port));
  res.setHeader('Cache-Control','no-store');
  res.status(200).json({ ok:true, service:'vless-ws-v4.6-diagnostic', results });
};

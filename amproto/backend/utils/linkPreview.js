const https = require('https');
const http = require('http');

const MAX_BODY = 1000000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function fetchPreview(urlStr, redirects = 0) {
    return new Promise((resolve) => {
        let parsedUrl;
        try {
            parsedUrl = new URL(urlStr);
        } catch (e) {
            return resolve(null);
        }

        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            return resolve(null);
        }

        const client = parsedUrl.protocol === 'https:' ? https : http;
        let done = false;
        const finish = (val) => {
            if (!done) {
                done = true;
                resolve(val);
            }
        };

        let req;
        try {
            req = client.get(urlStr, {
                timeout: TIMEOUT_MS,
                headers: {
                    'User-Agent': UA,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    if (redirects < MAX_REDIRECTS) {
                        try {
                            const next = new URL(res.headers.location, urlStr).href;
                            return fetchPreview(next, redirects + 1).then(finish);
                        } catch (e) {
                            return finish(null);
                        }
                    }
                    return finish(null);
                }

                if (res.statusCode !== 200) {
                    res.resume();
                    return finish(null);
                }

                let data = '';
                let tooBig = false;
                res.on('data', (chunk) => {
                    if (!tooBig) {
                        data += chunk;
                        if (data.length > MAX_BODY) {
                            data = data.slice(0, MAX_BODY);
                            tooBig = true;
                        }
                    }
                });
                res.on('end', () => finish(parsePreview(data, urlStr)));
                res.on('error', () => finish(null));
            });
            req.on('timeout', () => {
                try { req.destroy(); } catch (e) {}
                finish(null);
            });
            req.on('error', () => finish(null));
            const hardTimer = setTimeout(() => {
                try { req.destroy(); } catch (e) {}
                finish(null);
            }, TIMEOUT_MS + 2000);
            if (req.socket) req.socket.on('close', () => clearTimeout(hardTimer));
            else req.on('socket', (sock) => sock.on('close', () => clearTimeout(hardTimer)));
        } catch (e) {
            finish(null);
        }
    });
}

function parsePreview(html, urlStr) {
    let title = null;
    let image = null;
    let description = null;

    const metaRe = /<meta\b[^>]*>/gi;
    let m;
    while ((m = metaRe.exec(html)) !== null) {
        const tag = m[0];
        const getAttr = (name) => {
            const am = tag.match(new RegExp(name + '\\s*=\\s*([\'"])(.*?)\\1', 'i'));
            return am ? am[2] : null;
        };
        const prop = (getAttr('property') || getAttr('name') || getAttr('itemprop') || '').toLowerCase();
        if (!prop) continue;
        const content = getAttr('content');
        if (!content) continue;
        if (!title && (prop === 'og:title' || prop === 'twitter:title')) title = content;
        else if (!image && (prop === 'og:image' || prop === 'twitter:image' || prop === 'twitter:image:src')) image = content;
        else if (!description && (prop === 'og:description' || prop === 'twitter:description' || prop === 'description')) description = content;
    }

    if (!title) {
        const tm = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        if (tm) title = tm[1];
    }

    if (title) title = decodeHTMLEntities(title);
    if (description) description = decodeHTMLEntities(description);

    return { title, image, description, url: urlStr };
}

function decodeHTMLEntities(text) {
    return text.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
               .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
               .replace(/&quot;/g, '"')
               .replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/&apos;/g, "'")
               .replace(/&nbsp;/g, ' ');
}

module.exports = { fetchPreview };

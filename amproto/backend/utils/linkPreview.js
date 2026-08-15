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
                res.on('end', () => {
                    const base = parsePreview(data, urlStr);
                    const oembedHref = findOEmbed(data);
                    let endpoint = null;
                    if (oembedHref) {
                        try { endpoint = new URL(oembedHref, urlStr).href; } catch (e) { endpoint = null; }
                    } else if (isSpotify(urlStr)) {
                        endpoint = 'https://open.spotify.com/oembed?url=' + encodeURIComponent(urlStr);
                    }
                    if (endpoint) {
                        return fetchOEmbed(endpoint).then((o) => finish(mergePreview(base, o)));
                    }
                    finish(base);
                });
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

function fetchOEmbed(endpointUrl) {
    return new Promise((resolve) => {
        let parsedUrl;
        try {
            parsedUrl = new URL(endpointUrl);
        } catch (e) {
            return resolve(null);
        }
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            return resolve(null);
        }

        const client = parsedUrl.protocol === 'https:' ? https : http;
        let done = false;
        const fin = (v) => {
            if (!done) {
                done = true;
                resolve(v);
            }
        };

        let req;
        try {
            req = client.get(endpointUrl, {
                timeout: TIMEOUT_MS,
                headers: { 'User-Agent': UA, 'Accept': 'application/json' }
            }, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    return fin(null);
                }
                let data = '';
                res.on('data', (chunk) => {
                    if (data.length < 300000) data += chunk;
                });
                res.on('end', () => {
                    try {
                        const j = JSON.parse(data);
                        fin({
                            title: j.title || null,
                            image: j.thumbnail_url || j.thumbnailUrl || null,
                            description: j.description || null
                        });
                    } catch (e) {
                        fin(null);
                    }
                });
                res.on('error', () => fin(null));
            });
            req.on('timeout', () => {
                try { req.destroy(); } catch (e) {}
                fin(null);
            });
            req.on('error', () => fin(null));
        } catch (e) {
            fin(null);
        }
    });
}

function resolveUrl(img, baseUrl) {
    if (!img) return null;
    try {
        return new URL(img, baseUrl).href;
    } catch (e) {
        return img;
    }
}

function mergePreview(base, oembed) {
    if (!oembed) return base;
    return {
        title: oembed.title || base.title,
        image: resolveUrl(oembed.image || base.image, base.url),
        description: oembed.description || base.description,
        url: base.url
    };
}

function isSpotify(urlStr) {
    try {
        return new URL(urlStr).hostname === 'open.spotify.com';
    } catch (e) {
        return false;
    }
}

function findOEmbed(html) {
    const m = html.match(/<link[^>]*type="application\/json\+oembed"[^>]*>/i);
    if (!m) return null;
    const href = m[0].match(/href\s*=\s*["']([^"']+)["']/i);
    return href ? href[1] : null;
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

    return { title, image: resolveUrl(image, urlStr), description, url: urlStr };
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

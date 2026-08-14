const https = require('https');
const http = require('http');

function fetchPreview(urlStr) {
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
        
        const req = client.get(urlStr, {
            timeout: 3000,
            headers: {
                'User-Agent': 'WhisprBot/1.0 (Link Preview)'
            }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return resolve(null);
            }

            if (res.statusCode !== 200) {
                res.resume();
                return resolve(null);
            }

            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
                if (data.length > 500000) {
                    res.destroy();
                }
            });

            res.on('end', () => {
                const titleMatch = data.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"[^>]*>|<meta[^>]*content="([^"]*)"[^>]*property="og:title"[^>]*>|<title>([^<]*)<\/title>/i);
                const imageMatch = data.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"[^>]*>|<meta[^>]*content="([^"]*)"[^>]*property="og:image"[^>]*>/i);
                const descMatch = data.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"[^>]*>|<meta[^>]*content="([^"]*)"[^>]*property="og:description"[^>]*>|<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i);

                let title = null;
                let image = null;
                let description = null;

                if (titleMatch) title = titleMatch[1] || titleMatch[2] || titleMatch[3];
                if (imageMatch) image = imageMatch[1] || imageMatch[2];
                if (descMatch) description = descMatch[1] || descMatch[2] || descMatch[3];

                if (title) title = decodeHTMLEntities(title);
                if (description) description = decodeHTMLEntities(description);

                resolve({ title, image, description, url: urlStr });
            });
        });

        req.on('error', () => resolve(null));
        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });
    });
}

function decodeHTMLEntities(text) {
    return text.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
               .replace(/&quot;/g, '"')
               .replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/&apos;/g, "'");
}

module.exports = { fetchPreview };

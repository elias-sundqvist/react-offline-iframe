export async function httpsGet(url): Promise<Buffer> {
    console.log(`Getting ${url} using httpsGet`);
    function get(url, resolve, reject) {
        global.require('https').get(
            url,
            {
                headers: {
                    Accept: '*/*',
                    'Accept-Encoding': '*',
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) obsidian/0.12.3 Chrome/89.0.4389.128 Electron/12.0.6 Safari/537.36'
                }
            },
            res => {
                // if any other status codes are returned, those needed to be added here
                if (res.statusCode === 301 || res.statusCode === 302) {
                    return get(res.headers.location, resolve, reject);
                }

                const data = [];

                res.on('data', function (chunk) {
                    data.push(chunk);
                }).on('end', function () {
                    resolve(Buffer.concat(data));
                });
            }
        );
    }
    return await new Promise((resolve, reject) => get(url, resolve, reject));
}

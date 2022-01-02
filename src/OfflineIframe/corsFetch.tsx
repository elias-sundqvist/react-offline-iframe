import { httpsGet } from './httpsGet';

export async function corsFetch(...args: Parameters<typeof fetch>) {
    try {
        const res = await fetch(...args);
        if (!res.ok) {
            throw 'Fetch was not successful.';
        }
        return res;
    } catch (e) {
        try {
            const buf = await httpsGet(args[0]);
            return new Response(buf, {
                status: 200,
                statusText: 'ok'
            });
        } catch (e2) {
            const combinedError = new AggregateError([e, e2], `Fetching url ${args[0]} failed!`);
            console.error(combinedError);
            throw combinedError;
        }
    }
}

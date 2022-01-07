import React from 'react';
import defineLocalIframe from './defineLocalIframe';
import { mkUrl } from './utils';
import { LocalIFrameProps } from './types';

type fetchType = typeof fetch;

const OfflineIframe = ({
    address,
    fetch,
    getUrl,
    ...props
}: {
    address: string;
    fetch: fetchType;
    getUrl: (originalUrl: string) => string;
} & Partial<LocalIFrameProps>) => {
    const LocalIframe = defineLocalIframe({ fetch, getUrl });
    return (
        <div>
            <LocalIframe
                onload={async () => {}}
                src={address}
                proxy={getUrl}
                fetchProxy={async ({ href, base, contextUrl, init }) => {
                    href = getUrl(mkUrl(contextUrl, href).href);
                    return await base(href, init);
                }}
                onIframePatch={async () => {}}
                {...props}
            />
        </div>
    );
};

export default OfflineIframe;

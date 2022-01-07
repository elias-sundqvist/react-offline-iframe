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
} & LocalIFrameProps) => {
    const LocalIframe = defineLocalIframe({ fetchUrlContent: fetch, getUrl });
    return (
        <div>
            <LocalIframe
                onload={async () => {}}
                src={address}
                proxy={getUrl}
                fetchProxy={async ({ href, base, contextUrl }) => {
                    href = getUrl(mkUrl(contextUrl, href).href);
                    return await base(href);
                }}
                onIframePatch={async () => {}}
                {...props}
            />
        </div>
    );
};

export default OfflineIframe;

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
        <LocalIframe
            onload={async () => {}}
            src={address}
            proxy={getUrl}
            fetchProxy={async ({ requestInfo, base, contextUrl, init }) => {
                requestInfo =
                    typeof requestInfo == 'string'
                        ? getUrl(mkUrl(contextUrl, requestInfo).href)
                        : {
                              ...requestInfo,
                              url: getUrl(mkUrl(contextUrl, requestInfo.url).href)
                          };
                return await base(requestInfo, init);
            }}
            onIframePatch={async () => {}}
            tagPatchStrategy={'prototype'}
            postMessagePatchStrategy={'target'}
            onMessagePatchStrategy={null}
            {...props}
        />
    );
};

export default OfflineIframe;

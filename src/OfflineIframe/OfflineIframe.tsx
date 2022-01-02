import React from "react";
import defineLocalIframe from "./defineLocalIframe";
import { mkUrl } from "./utils";

const OfflineIframe = ({ address, fetchUrlContent, getResourceUrl, proxy }) => {
  const LocalIframe = defineLocalIframe({fetchUrlContent, getResourceUrl});
  return <div>
    <LocalIframe onload={async ()=>{}} src={address} proxy={proxy} fetchProxy={async ({href, base, contextUrl})=>
      {
        href = proxy(mkUrl(contextUrl, href)).href;
        return await base(href);
    }} onIframePatch={async ()=>{}}/>
    </div>
};

export default OfflineIframe;

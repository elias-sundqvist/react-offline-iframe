export type LocalIFrameProps = {
    onIframePatch: (iframe: HTMLIFrameElement) => Promise<void>;
    onload: (iframe: HTMLIFrameElement) => Promise<void>;
    src: string;
    proxy: (url: URL) => URL;
    fetchProxy: (args: {
        href: string;
        init?: RequestInit;
        contextUrl: string;
        base: (href: string) => Promise<Response>;
    }) => Promise<Response>;
    htmlPostProcessFunction?: (html: string) => string;
    outerIframeProps?:any
};

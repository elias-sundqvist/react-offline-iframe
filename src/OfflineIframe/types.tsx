export type LocalIFrameProps = {
    onIframePatch: (iframe: HTMLIFrameElement) => Promise<void>;
    onload: (iframe: HTMLIFrameElement) => Promise<void>;
    src: string;
    proxy: (url: string) => string;
    fetchProxy: (args: {
        href: string;
        init?: RequestInit;
        contextUrl: string;
        base: (href: string, init?: RequestInit) => Promise<Response>;
    }) => Promise<Response>;
    htmlPostProcessFunction?: (html: string) => string;
    outerIframeProps?: any;
};

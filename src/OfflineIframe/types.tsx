import { Server } from 'mock-websocket';

export type LocalIFrameProps = {
    onIframePatch: (iframe: HTMLIFrameElement) => Promise<void>;
    onload: (iframe: HTMLIFrameElement) => Promise<void>;
    webSocketSetup?: (createServer: (url: string) => Server) => void;
    src: string;
    proxy: (url: string) => string;
    fetchProxy: (args: {
        requestInfo: RequestInfo;
        init?: RequestInit;
        contextUrl: string;
        base: (href: RequestInfo, init?: RequestInit) => Promise<Response>;
    }) => Promise<Response>;
    htmlPostProcessFunction?: (html: string) => string;
    postMessagePatchStrategy?: null | 'top' | 'target' | ((iframe: HTMLIFrameElement) => void);
    tagPatchStrategy?: null | 'createEl' | 'prototype' | ((iframe: HTMLIFrameElement, context: string) => void);
    onMessagePatchStrategy?: null | 'patchedOriginClone' | ((iframe: HTMLIFrameElement, context: string) => void);
    outerIframeProps?: any;
};

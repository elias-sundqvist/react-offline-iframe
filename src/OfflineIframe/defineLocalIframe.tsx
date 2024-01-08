import createXMLHttpRequest from './FakeXMLHttpRequest';
import React, { useEffect } from 'react';
import { useRef } from 'react';
import { WebSocket, Server } from 'mock-websocket';
import { LocalIFrameProps } from './types';
import { mkUrl } from './utils';

type FetchType = typeof fetch;

export default ({ fetch, getUrl }: { fetch: FetchType; getUrl }) =>
    // eslint-disable-next-line react/display-name
    (props: LocalIFrameProps) => {
        const fetchUrlContent = (url: RequestInfo, init?: RequestInit) => fetch(url, init);
        let mockServers = [];
        props.webSocketSetup?.(url => {
            const mockServer = new Server(url, { mockGlobal: false });
            mockServers.push(mockServer);
            return mockServer;
        });
        const frame = useRef<HTMLIFrameElement>(null);
        const patchedElements = new WeakSet();
        const patchedElementSrcDocs = new WeakMap();

        function getResourceUrl(url: URL | string, contextUrl) {
            const fullUrl = mkUrl(contextUrl, url);
            return getUrl(fullUrl);
        }

        async function patchHtmlCode(htmlCode, contextUrl) {
            const xmlDoc = new DOMParser().parseFromString(htmlCode, 'text/html');
            contextUrl = mkUrl(
                contextUrl,
                xmlDoc.baseURI.startsWith(window.location.origin) ? contextUrl : xmlDoc.baseURI
            );
            patchXmlImgTags(xmlDoc, contextUrl);
            patchXmlStyleTags(xmlDoc, contextUrl);
            await patchXmlLinkTags(xmlDoc, contextUrl);
            patchXmlScriptTags(xmlDoc, contextUrl);
            patchXmlIframeTags(xmlDoc);
            return {
                html: `<!DOCTYPE html>${xmlDoc.documentElement.outerHTML}`,
                context: contextUrl.href || contextUrl
            };
        }

        function patchCssUrls(cssCode, contextUrl) {
            return cssCode.replaceAll(/url\(["']?(.*?)["']?\)/gm, (m, url) => {
                return `url("${getResourceUrl(url, contextUrl)}")`;
            });
        }

        function patchXmlImgTags(xmlDoc, contextUrl) {
            for (const tag of xmlDoc.getElementsByTagName('img')) {
                const src = tag.getAttribute('src');
                if (src) {
                    tag.setAttribute('src', getResourceUrl(src, contextUrl));
                }
            }
        }

        function patchXmlStyleTags(xmlDoc, contextUrl) {
            for (const tag of xmlDoc.getElementsByTagName('style')) {
                tag.innerHTML = patchCssUrls(tag.innerHTML, contextUrl);
            }
        }

        function getFrameForDocument(document) {
            const w = document.defaultView || document.parentWindow;
            const frames = w.parent.document.getElementsByTagName('iframe');
            for (let i = frames.length; i-- > 0; ) {
                const frame = frames[i];
                try {
                    const d = frame.contentDocument || frame.contentWindow.document;
                    if (d === document) return frame;
                } catch (e) {}
            }
        }

        function tryGetIframeContext(iframe) {
            if (!iframe) return null;
            const src = iframe.getAttribute('patched-src');
            if (src) {
                return src;
            }
            return tryGetIframeContext(getFrameForDocument(iframe.ownerDocument));
        }

        async function patchLinkTag(tag, contextUrl) {
            const rel = tag.getAttribute('rel');
            switch (rel) {
                case 'stylesheet':
                    {
                        const href = tag.getAttribute('href');
                        const hrefContext = mkUrl(contextUrl, href);
                        try {
                            const data = await (
                                await fetchUrlContent(hrefContext.href, {
                                    headers: {
                                        Accept: `text/css,*/*;q=0.1`,
                                        'Accept-Encoding': 'gzip, deflate, br'
                                    }
                                })
                            ).text();
                            tag.outerHTML = `<style>${patchCssUrls(data, hrefContext)}</style>`;
                        } catch {}
                    }
                    break;
                default: {
                    const href = tag.getAttribute('href');
                    if (href) {
                        tag.setAttribute('href', getResourceUrl(href, contextUrl));
                        tag.setAttribute('patched-href', href);
                    }
                }
            }
        }

        async function patchXmlLinkTags(xmlDoc, contextUrl) {
            const tags = [...xmlDoc.getElementsByTagName('link')];
            for (const tag of tags) {
                await patchLinkTag(tag, contextUrl);
            }
        }

        function patchXmlScriptTags(xmlDoc, contextUrl) {
            for (const tag of xmlDoc.getElementsByTagName('script')) {
                const src = tag.getAttribute('src');
                if (src) {
                    tag.setAttribute('src', getResourceUrl(src, contextUrl));
                    tag.setAttribute('patched-src', src);
                }
            }
        }

        function patchXmlIframeTags(xmlDoc: XMLDocument) {
            for (const tag of xmlDoc.getElementsByTagName('iframe')) {
                const src = tag.getAttribute('src');
                if (src) {
                    tag.removeAttribute('src');
                    tag.setAttribute('patched-src', src);
                }
            }
        }

        function proxySrc(src) {
            const url = new URL(src).href;
            return props.proxy(url);
        }

        function patchIframeConsole(iframe) {
            // The console may keep references to objects, preventing them from getting destroyed.
            // Solution - disable the console inside iframes.
            const contentWindow = iframe.contentWindow;
            contentWindow.console = new Proxy(
                {},
                {
                    get() {
                        return () => null;
                    }
                }
            );
        }

        function patchIframeClasses(iframe) {
            iframe.contentWindow.ArrayBuffer = ArrayBuffer;
        }

        function patchIframeEventListeners(iframe: HTMLIFrameElement, context) {
            if (!props.onMessagePatchStrategy) return;
            if (typeof props.onMessagePatchStrategy == 'function') {
                return props.onMessagePatchStrategy(iframe, context);
            }
            if (props.onMessagePatchStrategy == 'patchedOriginClone') {
                type TWindow = typeof window;

                const win = iframe.contentWindow as TWindow;

                const prototype = win.EventTarget.prototype;

                const messageMap = new WeakMap<
                    EventListenerOrEventListenerObject,
                    EventListenerOrEventListenerObject
                >();

                const _addEventListener = prototype.addEventListener;
                prototype.addEventListener = function (
                    type: string,
                    callback: EventListenerOrEventListenerObject | null,
                    options?: AddEventListenerOptions | boolean
                ) {
                    if (type == 'message') {
                        const newCallback = (evt: MessageEvent) => {
                            if (callback == null) return;
                            let origin = evt.origin;
                            try {
                                origin = new URL(context).origin;
                            } catch (e) {}
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            evt = new (evt.constructor as any)(
                                evt.type,
                                new Proxy(evt, {
                                    get: (target, prop) => (prop == 'origin' ? origin : target[prop])
                                })
                            );

                            if ('handleEvent' in callback) {
                                return callback.handleEvent(evt);
                            } else {
                                return callback(evt);
                            }
                        };
                        messageMap.set(callback, newCallback);
                        return _addEventListener.apply(this, [type, newCallback, options]);
                    } else {
                        return _addEventListener.apply(this, [type, callback, options]);
                    }
                };

                const _removeEventListener = prototype.removeEventListener;
                prototype.removeEventListener = function (
                    type: string,
                    callback: EventListenerOrEventListenerObject,
                    options?: boolean | EventListenerOptions
                ) {
                    if (type == 'message') {
                        const newCallback = messageMap.get(callback);
                        return _removeEventListener.apply(this, [type, newCallback, options]);
                    } else {
                        return _removeEventListener.apply(this, [type, callback, options]);
                    }
                };
            }
        }

        function patchIframePostMessage(iframe: HTMLIFrameElement) {
            if (!props.postMessagePatchStrategy) return;

            type TWindow = typeof window;
            if (!iframe.contentWindow) return;
            const win = iframe.contentWindow as TWindow;

            if (typeof props.postMessagePatchStrategy == 'function') {
                return props.postMessagePatchStrategy(iframe);
            }
            if (props.postMessagePatchStrategy == 'target') {
                // Evaluating this code from the context of the iframe window
                // ensures that the Message event gets the correct source attribute.
                return win.eval(`
                            const _postMessage = window.postMessage;
                            window.postMessage = function(message, targetOrigin, transfer) {
                                return _postMessage.apply(this, [message, "*", transfer]);
                            }
                        `);
            }

            if (props.postMessagePatchStrategy == 'top') {
                const oldPostMessage = win.postMessage.bind(win);
                win.postMessage = function myPostMessage(...args) {
                    args[1] = '*';
                    return oldPostMessage(...args);
                };
            }
        }

        function findDescriptor(obj, prop) {
            if (obj != null) {
                return Object.hasOwnProperty.call(obj, prop)
                    ? Object.getOwnPropertyDescriptor(obj, prop)
                    : findDescriptor(Object.getPrototypeOf(obj), prop);
            }
        }

        function addLocalUrlSetter(property, elem, context) {
            const { get, set } = findDescriptor(elem, property);
            Object.defineProperty(elem, property, {
                configurable: true,
                enumerable: true,
                get() {
                    const v = get.call(this);
                    return v;
                },
                set(v) {
                    // modify value before applying it to the default setter
                    set.call(this, getResourceUrl(v, context));
                    elem.setAttribute(`patched-${property}`, v);
                }
            });
            const setAttribute = elem.setAttribute.bind(elem);
            elem.setAttribute = (qualifiedName, value) => {
                if (qualifiedName.toLowerCase() == property.toLowerCase()) {
                    setAttribute(qualifiedName, getResourceUrl(value, context));
                    setAttribute(`patched-${qualifiedName}`, value);
                } else {
                    setAttribute(qualifiedName, value);
                }
            };
            const setAttributeNS = elem.setAttributeNS.bind(elem);
            elem.setAttributeNS = (namespace, qualifiedName, value) => {
                if (qualifiedName.toLowerCase() == property.toLowerCase()) {
                    setAttributeNS(namespace, qualifiedName, getResourceUrl(value, context));
                    setAttributeNS(namespace, `patched-${qualifiedName}`, value);
                } else {
                    setAttributeNS(namespace, qualifiedName, value);
                }
            };
            const setAttributeNode = elem.setAttributeNode.bind(elem);
            elem.setAttributeNode = attr => {
                if (attr.name.toLowerCase() == property.toLowerCase()) {
                    const patchedAttr = elem.ownerDocument.createAttribute(`patched-${attr.name}`);
                    patchedAttr.value = attr.value;
                    const newAttr = elem.ownerDocument.createAttribute(attr.name);
                    newAttr.value = getResourceUrl(attr.value, context);
                    setAttributeNode(patchedAttr);
                    return setAttributeNode(newAttr);
                } else {
                    return setAttributeNode(attr);
                }
            };
            const setAttributeNodeNS = elem.setAttributeNodeNS.bind(elem);
            elem.setAttributeNodeNS = attr => {
                if (attr.name.toLowerCase() == property.toLowerCase()) {
                    const patchedAttr = elem.ownerDocument.createAttributeNS(attr.namespaceURI, `patched-${attr.name}`);
                    patchedAttr.value = attr.value;
                    const newAttr = elem.ownerDocument.createAttributeNS(attr.namespaceURI, attr.name);
                    newAttr.value = getResourceUrl(attr.value, context);
                    setAttributeNodeNS(patchedAttr);
                    return setAttributeNodeNS(newAttr);
                } else {
                    return setAttributeNodeNS(attr);
                }
            };
        }

        function patchIframeTags(iframe: HTMLIFrameElement, context) {
            type TWindow = typeof window;
            type TDOMPrototype = typeof window.HTMLElement.prototype;

            if (!props.tagPatchStrategy) return;
            if (typeof props.tagPatchStrategy == 'function') {
                return props.tagPatchStrategy(iframe, context);
            }
            if (props.tagPatchStrategy == 'createEl') {
                if (!iframe.contentWindow) return;

                const frameDoc = iframe.contentWindow.document;
                const createFrameElem = frameDoc.createElement.bind(frameDoc);
                const createFrameElemNS = frameDoc.createElementNS.bind(frameDoc);
                const patchElem = (tagName, elem) => {
                    switch (tagName.toLowerCase()) {
                        case 'img':
                        case 'script':
                            addLocalUrlSetter('src', elem, context);
                            break;
                        case 'link':
                            addLocalUrlSetter('href', elem, context);
                            break;
                    }
                    return elem;
                };
                frameDoc.createElement = tagName => {
                    const elem = createFrameElem(tagName);
                    return patchElem(tagName, elem);
                };
                frameDoc.createElementNS = (nameSpace, tagName) => {
                    const elem = createFrameElemNS(nameSpace, tagName);
                    return patchElem(tagName, elem);
                };
            }

            if (props.tagPatchStrategy == 'prototype') {
                function patchProperties(prototype: TDOMPrototype, properties: Set<string>) {
                    const GetAttributeOriginal = Symbol();
                    prototype[GetAttributeOriginal] = prototype.getAttribute;
                    prototype.getAttribute = function (qualifiedName) {
                        if (properties.has(qualifiedName.toLowerCase())) {
                            return (
                                this[GetAttributeOriginal](`patched-${qualifiedName}`) ||
                                this[GetAttributeOriginal](qualifiedName)
                            );
                        } else {
                            return this[GetAttributeOriginal](qualifiedName);
                        }
                    };

                    const GetAttributeNSOriginal = Symbol();
                    prototype[GetAttributeNSOriginal] = prototype.getAttributeNS;
                    prototype.getAttributeNS = function (qualifiedName, localName) {
                        if (properties.has(qualifiedName.toLowerCase())) {
                            return (
                                this[GetAttributeNSOriginal](`patched-${qualifiedName}`, localName) ||
                                this[GetAttributeNSOriginal](qualifiedName, localName)
                            );
                        } else {
                            return this[GetAttributeNSOriginal](qualifiedName, localName);
                        }
                    };

                    const GetAttributeNodeOriginal = Symbol();
                    prototype[GetAttributeNodeOriginal] = prototype.getAttributeNode;
                    prototype.getAttributeNode = function (qualifiedName) {
                        if (properties.has(qualifiedName.toLowerCase())) {
                            return (
                                this[GetAttributeNodeOriginal](`patched-${qualifiedName}`) ||
                                this[GetAttributeNodeOriginal](qualifiedName)
                            );
                        } else {
                            return this[GetAttributeNodeOriginal](qualifiedName);
                        }
                    };

                    const GetAttributeNodeNSOriginal = Symbol();
                    prototype[GetAttributeNodeNSOriginal] = prototype.getAttributeNodeNS;
                    prototype.getAttributeNodeNS = function (qualifiedName, localName) {
                        if (properties.has(qualifiedName.toLowerCase())) {
                            return (
                                this[GetAttributeNodeNSOriginal](`patched-${qualifiedName}`, localName) ||
                                this[GetAttributeNodeNSOriginal](qualifiedName, localName)
                            );
                        } else {
                            return this[GetAttributeNodeNSOriginal](qualifiedName, localName);
                        }
                    };

                    const SetAttributeOriginal = Symbol();
                    prototype[SetAttributeOriginal] = prototype.setAttribute;
                    prototype.setAttribute = function (qualifiedName, value) {
                        if (properties.has(qualifiedName.toLowerCase())) {
                            const patchedValue = getResourceUrl(value, context);
                            props.onAttributeSet?.(this, qualifiedName, value, patchedValue);
                            this[SetAttributeOriginal](qualifiedName, patchedValue);
                            this[SetAttributeOriginal](`patched-${qualifiedName}`, value);
                        } else {
                            this[SetAttributeOriginal](qualifiedName, value);
                        }
                    };

                    const SetAttributeNSOriginal = Symbol();
                    prototype[SetAttributeNSOriginal] = prototype.setAttributeNS;
                    prototype.setAttributeNS = function (namespace, qualifiedName, value) {
                        if (properties.has(qualifiedName.toLowerCase())) {
                            const patchedValue = getResourceUrl(value, context);
                            props.onAttributeSet?.(this, qualifiedName, value, patchedValue);
                            this[SetAttributeNSOriginal](namespace, qualifiedName, patchedValue);
                            this[SetAttributeNSOriginal](namespace, `patched-${qualifiedName}`, value);
                        } else {
                            this[SetAttributeNSOriginal](namespace, qualifiedName, value);
                        }
                    };

                    const SetAttributeNodeOriginal = Symbol();
                    prototype[SetAttributeNodeOriginal] = prototype.setAttributeNode;
                    prototype.setAttributeNode = function (attr) {
                        if (properties.has(attr.name.toLowerCase())) {
                            const patchedValue = getResourceUrl(attr.value, context);
                            props.onAttributeSet?.(this, attr.name, attr.value, patchedValue);
                            const patchedAttr = this.ownerDocument.createAttribute(`patched-${attr.name}`);
                            patchedAttr.value = attr.value;
                            const newAttr = this.ownerDocument.createAttribute(attr.name);
                            newAttr.value = patchedValue;
                            this[SetAttributeNodeOriginal](patchedAttr);
                            return this[SetAttributeNodeOriginal](newAttr);
                        } else {
                            return this[SetAttributeNodeOriginal](attr);
                        }
                    };

                    const SetAttributeNodeNSOriginal = Symbol();
                    prototype[SetAttributeNodeNSOriginal] = prototype.setAttributeNodeNS;
                    prototype.setAttributeNodeNS = function (attr) {
                        if (properties.has(attr.name.toLowerCase())) {
                            const patchedValue = getResourceUrl(attr.value, context);
                            props.onAttributeSet?.(this, attr.name, attr.value, patchedValue);
                            const patchedAttr = this.ownerDocument.createAttributeNS(
                                attr.namespaceURI,
                                `patched-${attr.name}`
                            );
                            patchedAttr.value = attr.value;
                            const newAttr = this.ownerDocument.createAttributeNS(attr.namespaceURI, attr.name);
                            newAttr.value = patchedValue;
                            this[SetAttributeNodeNSOriginal](patchedAttr);
                            return this[SetAttributeNodeNSOriginal](newAttr);
                        } else {
                            return this[SetAttributeNodeNSOriginal](attr);
                        }
                    };
                    for (const property of properties) {
                        Object.defineProperty(prototype, property, {
                            configurable: true,
                            enumerable: true,

                            get() {
                                return this.getAttribute(property);
                            },

                            set(v) {
                                return this.setAttribute(property, v);
                            }
                        });
                    }
                }

                const win = iframe.contentWindow as TWindow;
                patchProperties(win.HTMLLinkElement.prototype, new Set(['href']));
                patchProperties(win.HTMLScriptElement.prototype, new Set(['src']));
                patchProperties(win.HTMLImageElement.prototype, new Set(['src']));
            }
        }

        function patchIframeDocumentQueries(iframe) {
            const framedoc = iframe.contentWindow.document;
            const querySelector = framedoc.querySelector.bind(framedoc);
            framedoc.querySelector = selectors => {
                return querySelector(selectors.replaceAll('href', 'patched-href').replaceAll('src', 'patched-src'));
            };
        }

        function patchIframeFetch(iframe: HTMLIFrameElement, contextUrl) {
            const base = (requestInfo: RequestInfo, init?: RequestInit) =>
                fetchUrlContent(
                    typeof requestInfo == 'string'
                        ? mkUrl(contextUrl, requestInfo).href
                        : { ...requestInfo, url: mkUrl(contextUrl, requestInfo.url).href },
                    init
                );

            if (props.fetchProxy) {
                iframe.contentWindow.fetch = (requestInfo, init) =>
                    props.fetchProxy({ requestInfo, init, contextUrl, base });
                return;
            }
            iframe.contentWindow.fetch = base;
            return;
        }

        function patchIframeWebSocket(iframe) {
            iframe.contentWindow.WebSocket = WebSocket;
        }
        function makeWorkerFromString(str) {
            return new Worker('data:application/javascript,' + encodeURIComponent(str));
        }
        function makePatchedWorker(iframe, contextUrl) {
            return class PatchedWorker extends Worker {
                constructor(scriptURL, options) {
                    const url = getResourceUrl(scriptURL, contextUrl);
                    const patchedWorkerPromise = (async () => {
                        const response = await fetch(url);
                        const code = await response.text();
                        const worker = makeWorkerFromString(`
    fetchCallbacks = {};
    fetch=async (resource, init)=>{
        const id = \`\${Math.random()}\`.substr(2);
        const promise = new Promise(res=>{fetchCallbacks[id]=res;});
        self.postMessage({isFetch:true, id, resource, init});
        return await promise;
    };
    self.addEventListener("message", function(event) {
        if(event.data.isFetchResult) {
            fetchCallbacks[event.data.id](new Response(event.data.blob, event.data.init));
            fetchCallbacks[event.data.id] = null;
        }
    });
    ${code}`);
                        worker.addEventListener('message', async function (event) {
                                if (event.data.isFetch) {
                                    const response = await iframe.contentWindow.fetch(event.data.resource, event.data.init);
                                    const blob = await response.blob();
                                    worker.postMessage({
                                        isFetchResult: true,
                                        id: event.data.id,
                                        blob,
                                        init: {
                                            status: response.status,
                                            statusText: response.statusText,
                                            headers: response.headers
                                        }
                                    });
                            }
                        });
                        
                        return worker;
                    })();
                    super(url, options);
                    return new Proxy(this, {
                        get(target, propKey, receiver) {
                            const propValue = target[propKey];
                            if (typeof propValue != 'function') {
                                return propValue;
                            }
                            else {
                                return async function (...args) {
                                    const patchedWorker = await patchedWorkerPromise;
                                    return patchedWorker[propKey](...args);
                                };
                            }
                        }
                    });
                }
            };
        }

        function patchIframeWorker(iframe, contextUrl) {
            iframe.contentWindow.Worker = makePatchedWorker(iframe, contextUrl);
        }

        function patchIframeXMLHttpRequest(iframe: HTMLIFrameElement, contextUrl) {
            const base = (requestInfo: RequestInfo, init?: RequestInit) => {
                return fetchUrlContent(
                    typeof requestInfo == 'string'
                        ? mkUrl(contextUrl, requestInfo).href
                        : { ...requestInfo, url: mkUrl(contextUrl, requestInfo.url).href },
                    init
                );
            };
            let f = base;
            if (props.fetchProxy) {
                f = (requestInfo: RequestInfo, init?: RequestInit) => {
                    return props.fetchProxy({ requestInfo, init, contextUrl, base });
                };
            }
            const FXHR = createXMLHttpRequest();

            FXHR.addHandler({
                url: /.*/,
                headers: async function (request, url, data) {
                    const result = await f(url, {
                        method: request.method,
                        ...(data ? { body: data } : {})
                    });
                    request._tmp = request._tmp || {};
                    if (request.responseType == 'arraybuffer') {
                        request._tmp.response = await result.arrayBuffer();
                    } else {
                        request._tmp.response = await result.text();
                    }
                    return Object.fromEntries(result.headers.entries());
                },
                status: 200,
                statusText: 'OK',

                response: async function (request, url, data) {
                    return request?._tmp?.response;
                }
            });

            (iframe.contentWindow as any).XMLHttpRequest = FXHR;
        }

        async function patchCustomDom(customDom) {
            if (!patchedElements.has(customDom)) {
                patchedElements.add(customDom);
                addCustomDomMutationObserver(customDom);
            }
        }

        async function patchIframe(iframe: HTMLIFrameElement) {
            if (
                !patchedElements.has(iframe) ||
                (iframe.getAttribute('srcDoc') && iframe.getAttribute('srcDoc') != patchedElementSrcDocs.get(iframe))
            ) {
                patchedElements.add(iframe);
                const src = iframe.getAttribute('src') || iframe.getAttribute('patched-src');
                await setIframeSrc(src);
                async function setIframeSrc(src) {
                    let newSrc;
                    let content;
                    if (src) {
                        iframe.setAttribute('patched-src', src);
                        iframe.removeAttribute('src');
                        newSrc = proxySrc(src);
                        content = await (
                            await fetchUrlContent(newSrc, {
                                headers: {
                                    Accept: `text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8`,
                                    'Accept-Encoding': `gzip, deflate, br`
                                }
                            })
                        ).text();
                    } else {
                        src = tryGetIframeContext(iframe);
                        content = iframe.getAttribute('srcDoc');
                        patchedElementSrcDocs.set(iframe, content);
                        // iframe.removeAttribute('srcDoc');
                    }
                    const { html, context } = await patchHtmlCode(content, src);

                    patchIframeTags(iframe, context);
                    patchIframeEventListeners(iframe, context);
                    patchIframeClasses(iframe);
                    patchIframePostMessage(iframe);
                    patchIframeFetch(iframe, context);
                    patchIframeConsole(iframe);
                    patchIframeWorker(iframe, context);
                    patchIframeXMLHttpRequest(iframe, context);
                    patchIframeWebSocket(iframe);
                    setIframeContent(iframe, html);
                    addIframeMutationObserverWhenReady(iframe);
                    iframe.setAttribute('patched', 'true');
                    await props.onIframePatch(iframe);
                }

                const oldSetAttribute = iframe.setAttribute.bind(iframe);
                iframe.setAttribute = (qualifiedName, value) => {
                    if (qualifiedName == 'src') {
                        setIframeSrc(value);
                    } else {
                        oldSetAttribute(qualifiedName, value);
                    }
                };

                const oldSetAttributeNS = iframe.setAttributeNS.bind(iframe);
                iframe.setAttributeNS = (namespace, qualifiedName, value) => {
                    if (qualifiedName == 'src') {
                        setIframeSrc(value);
                    } else {
                        oldSetAttributeNS(namespace, qualifiedName, value);
                    }
                };
            }
        }

        function patchIframes(iframes) {
            [...iframes].forEach(patchIframe);
        }

        function patchCustomDoms(customDoms) {
            [...customDoms].forEach(patchCustomDom);
        }

        function addIframeMutationObserverWhenReady(iframe) {
            iframe.addEventListener('load', function (e) {
                addIframeMutationObserver(e);
            });
            addIframeMutationObserver(iframe);
        }

        function mutationObserverCallback(records) {
            const iframes = records.map(x => x.target).filter(x => x.tagName == 'IFRAME');
            if (iframes.length > 0) {
                patchIframes(iframes);
            }
            const nodes = records.map(x => x.target).concat(records.flatMap(x => [...x.addedNodes]));
            const shadowDoms = nodes.filter(x => x.shadowRoot);
            if (shadowDoms.length > 0) {
                patchCustomDoms(shadowDoms);
            }
            const linkTags = nodes.filter(x => x.tagName == 'LINK');
            if (linkTags > 0) {
                const context = tryGetIframeContext(linkTags[0]);
                linkTags.forEach(t => patchLinkTag(t, context));
            }
        }

        const iframeObservers = new WeakMap();

        function addCustomDomMutationObserver(customDom) {
            if (!customDom.shadowRoot) {
                return;
            }
            const documentElement = customDom.shadowRoot.getRootNode();
            if (!iframeObservers.has(documentElement)) {
                const mutationObserver = new MutationObserver(mutationObserverCallback);
                mutationObserver.observe(documentElement, { childList: true, subtree: true, attributes: true });
                iframeObservers.set(documentElement, mutationObserver);
            }
            patchIframes(documentElement.querySelectorAll('iframe'));
            patchCustomDoms([...documentElement.querySelectorAll('*')].filter(x => x.shadowRoot));
        }

        function addIframeMutationObserver(iframe) {
            if (!iframe.contentWindow) {
                return;
            }
            const patchedSrc = iframe.getAttribute('patched-src');
            if (patchedSrc) {
                const patchedSrcUrl = new URL(patchedSrc);
                iframe.contentWindow.location.hash = patchedSrcUrl.hash;
            }
            const documentElement = iframe.contentWindow.document.documentElement;
            patchIframeDocumentQueries(iframe);
            if (!iframeObservers.has(documentElement)) {
                const mutationObserver = new MutationObserver(mutationObserverCallback);
                mutationObserver.observe(documentElement, { childList: true, subtree: true, attributes: true });
                iframeObservers.set(documentElement, mutationObserver);
            }
            patchIframes(documentElement.getElementsByTagName('iframe'));
            patchCustomDoms([...documentElement.getElementsByTagName('*')].filter(x => x.shadowRoot));
        }

        function setIframeContent(iframe, content) {
            const window = iframe.contentWindow;
            const doc = window.document;
            if (props.htmlPostProcessFunction) {
                content = props.htmlPostProcessFunction(content);
            }
            doc.open('text/html', 'replace');
            doc.write(content);
            doc.close();
        }

        function setIframeContentAndPatch(iframe, content) {
            setIframeContent(iframe, content);
            addIframeMutationObserverWhenReady(iframe);
        }

        useEffect(() => {
            const iframe = frame.current;
            if (!frame.current) return;
            setIframeContentAndPatch(
                iframe,
                `<style>body{margin:0px;}</style><iframe patched-src="${props.src}" width="100%" height="100%" allowfullscreen="allowfullscreen" frameborder="0">`
            );
            if (props.onload) {
                props.onload(iframe.contentDocument.body.firstChild as HTMLIFrameElement);
            }
            return () => {
                // frame.current?.remove();
            };
        }, [frame]);

        useEffect(() => {
            return () => {
                mockServers.forEach(mockServer => {
                    mockServer.stop();
                    mockServer.close();
                });
                mockServers = [];
                frame.current?.contentWindow?.location?.reload?.();
                // frame.current?.remove?.();
            };
        }, []);

        return <iframe ref={frame} width="100%" height="100%" allowFullScreen={true} {...props.outerIframeProps} />;
    };

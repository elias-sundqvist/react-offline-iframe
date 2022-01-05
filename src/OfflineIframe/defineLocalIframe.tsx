import createXMLHttpRequest from './FakeXMLHttpRequest';
import React, { useEffect } from 'react';
import { useRef } from 'react';
import { WebSocket, Server } from 'mock-websocket';
import { LocalIFrameProps } from './types';
import { mkUrl } from './utils';

export default ({ fetchUrlContent, getUrl }: { fetchUrlContent; getUrl }) =>
    (props: LocalIFrameProps) => {
        let mockServer = new Server('wss://hypothes.is/ws', { mockGlobal: false });
        mockServer.on('connection', () => '');
        mockServer.on('message', () => {
            mockServer.send(JSON.stringify({ type: 'whoyouare', userid: 'Obsidian User', ok: true, reply_to: 1 }));
        });
        const frame = useRef<HTMLIFrameElement>(null);
        const patchedElements = new WeakSet();
        const patchedElementSrcDocs = new WeakMap();

        function getResourceUrl(url: URL, contextUrl) {
            const fullUrl = mkUrl(contextUrl, url);
            return getUrl(fullUrl);
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
                    const href = tag.getAttribute('href');
                    const hrefContext = mkUrl(contextUrl, href);
                    try {
                        const data = await (await fetchUrlContent(hrefContext)).text();
                        tag.outerHTML = `<style>${patchCssUrls(data, hrefContext)}</style>`;
                    } catch {}
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

        function findDescriptor(obj, prop) {
            if (obj != null) {
                return Object.hasOwnProperty.call(obj, prop)
                    ? Object.getOwnPropertyDescriptor(obj, prop)
                    : findDescriptor(Object.getPrototypeOf(obj), prop);
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

        function patchIframeDocumentQueries(iframe) {
            const framedoc = iframe.contentWindow.document;
            const querySelector = framedoc.querySelector.bind(framedoc);
            framedoc.querySelector = selectors => {
                return querySelector(selectors.replaceAll('href', 'patched-href').replaceAll('src', 'patched-src'));
            };
        }

        function patchIframeFetch(iframe, contextUrl) {
            const base = href => fetchUrlContent(mkUrl(contextUrl, href));
            if (props.fetchProxy) {
                iframe.contentWindow.fetch = (href, init) => props.fetchProxy({ href, init, contextUrl, base });
                return;
            }
            iframe.contentWindow.fetch = base;
            return;
        }

        function patchIframePostMessage(iframe) {
            if (!iframe.contentWindow) return;
            const window = iframe.contentWindow;
            const oldPostMessage = window.postMessage.bind(window);
            window.postMessage = function myPostMessage(...args) {
                args[1] = '*';
                return oldPostMessage(...args);
            };
        }

        function patchIframeCreateEl(iframe, context) {
            if (!iframe.contentWindow) return;

            const frameDoc = iframe.contentWindow.document;
            const createFrameElem = frameDoc.createElement.bind(frameDoc);
            const createFrameElemNS = frameDoc.createElementNS.bind(frameDoc);

            const patchElem = (tagName: string, elem: HTMLElement) => {
                switch (tagName) {
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

        function patchIframeWebSocket(iframe) {
            iframe.contentWindow.WebSocket = WebSocket;
        }

        function makePatchedWorker(contextUrl) {
            return class PatchedWorker extends Worker {
                constructor(scriptURL: string | URL, options?: WorkerOptions) {
                    const url = getResourceUrl(scriptURL, contextUrl);
                    super(url, options);
                }
            };
        }

        function patchIframeWorker(iframe, contextUrl) {
            iframe.contentWindow.Worker = makePatchedWorker(contextUrl);
        }

        function patchIframeXMLHttpRequest(iframe, contextUrl) {
            const base = href => {
                return fetchUrlContent(mkUrl(contextUrl, href));
            };
            let f = base;
            if (props.fetchProxy) {
                f = href => {
                    return props.fetchProxy({ href, contextUrl, base });
                };
            }
            const FXHR = createXMLHttpRequest();

            FXHR.addHandler({
                url: /.*/,
                status: 200,
                statusText: 'OK',
                response: async function (request, completeMatch) {
                    const result = await f(completeMatch);
                    if (request.responseType == 'arraybuffer') {
                        return await result.arrayBuffer();
                    } else {
                        return await result.text();
                    }
                }
            });
            iframe.contentWindow.XMLHttpRequest = FXHR;
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
                let src = iframe.getAttribute('src') || iframe.getAttribute('patched-src');
                let newSrc;
                let content;
                if (src) {
                    iframe.setAttribute('patched-src', src);
                    iframe.removeAttribute('src');
                    newSrc = proxySrc(src);
                    content = await (await fetchUrlContent(newSrc)).text();
                } else {
                    src = tryGetIframeContext(iframe);
                    content = iframe.getAttribute('srcDoc');
                    patchedElementSrcDocs.set(iframe, content);
                    // iframe.removeAttribute('srcDoc');
                }
                const { html, context } = await patchHtmlCode(content, src);

                patchIframeCreateEl(iframe, context);
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
                `<iframe patched-src="${props.src}" width="100%" height="100%" allowfullscreen="allowfullscreen" frameborder="0">`
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
                mockServer.stop();
                mockServer.close();
                mockServer = null;
                frame.current?.contentWindow?.location?.reload?.();
                // frame.current?.remove?.();
            };
        }, []);

        return <iframe ref={frame} width="100%" height="900px" allowFullScreen={true} {...props.outerIframeProps} />;
    };

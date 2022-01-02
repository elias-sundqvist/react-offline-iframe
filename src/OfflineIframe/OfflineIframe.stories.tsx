import jszip from "jszip";
import React, { useState } from "react";
import zipStringEncoded from "../../rollup-folder-zip-string";
import OfflineIframe from "./OfflineIframe";
import extensionToMimetype from './file-extension-to-mimetype';
import { get_url_extension } from './utils';

export default {
  title: "OfflineIframe"
};

function mkUrl(...args) {
  return args.reduce((a, b) => new URL(b, a));
}
function proxySrc(src) {
  console.log("proxySrc", src);
  const url = new URL(src);
  return proxy(url);
}

function proxy(url: URL | string): URL {
  if (typeof url == 'string') {
      return new URL(url);
  }
  switch (url.hostname) {
    case 'www.desmos.com':
        return new URL(`zip:/www.desmos.com${url.pathname}`);
    case 'www.brainfacts.org':
        return new URL(`zip:/www.brainfacts.org${url.pathname}`);
    case 'agentcooper.github.io':
        return new URL(`zip:/agentcooper.github.io${url.pathname}`);
    case 'cdn.hypothes.is':
        return new URL(`zip:/cdn.hypothes.is${url.pathname}`);
    case 'via.hypothes.is':
        return new URL(`zip:/via.hypothes.is${url.pathname}`);
    case 'hypothes.is':
        return new URL(`zip:/hypothes.is${url.pathname}`);
    default:
        const match = /https:\/\/hypothes.is\/(api.*?)\/?$/g.exec(url.toString());
        if(match) {
          return new URL(`zip:/fake-service/${match[1]}`);
        }
        const match2 = /http:\/\/localhost:8001\/(api.*?)\/?$/g.exec(url.toString());
        if(match2) {
          return new URL(`zip:/fake-service/${match2[1]}`);
        }
        return url;
  }
}

const makeOnChange = (setFolder, setResourceUrls) => async x=>{
  const folder = await jszip.loadAsync(x.target.files[0]);
  setFolder(folder)
  const urls = new Map<string, string>();
  console.log("Loading Resource URLs");
  for (const filePath of Object.keys(folder.files)) {
      const file = folder.file(filePath);
      if (!file || file.dir) continue;
      const buf = await file.async('arraybuffer');
      const blob = new Blob([buf], { type: extensionToMimetype(get_url_extension(filePath)) });
      urls.set(filePath, URL.createObjectURL(blob));
  }
  setResourceUrls(urls);
  console.log("Finished Setting Resource URLs");
  }

const makeFetchUrlContent = folder =>async (url)=>{
  const urlBefore = url;
  url = proxySrc(url);
  const urlAfter = url;
  let buf;

  if (url.protocol == 'zip:') {
      try {
          const pathName = url.pathname.replace(/^\//,"");;
          const file =
              folder.file(pathName) ||
              folder.file(`${pathName}.html`) ||
              folder.file(`${pathName}.json`) ||
              folder.file(`${decodeURI(pathName)}`) ||
              folder.file(`${decodeURI(pathName)}.html`) ||
              folder.file(`${decodeURI(pathName)}.json`);
          buf = await file.async('arraybuffer');
          return new Response(buf, {
              status: 200,
              statusText: 'ok'
          });
      } catch (e) {
          debugger;
          console.warn('mockFetch Failed, Error', { e, urlBefore, urlAfter });
          return new Response(null, { status: 404, statusText: 'file not found' });
      }
  }
  return fetch(url.toString());
}

const makeGetResourceUrl = resourceUrls=>(url:URL, contextUrl)=>{
  const proxiedUrl = proxySrc(mkUrl(contextUrl, url));
  if (proxiedUrl.protocol == 'zip:') {
      const pathName = proxiedUrl.pathname.replace(/^\//,"").replace(/\/*$/,"");
      const res = resourceUrls.get(pathName) || resourceUrls.get(`${pathName}.html`) || resourceUrls.get(`${pathName}.json`);
      if (res) return res;
      debugger;
      console.error('file not found', { url, contextUrl, pathName });
  }
  return proxiedUrl.toString();
} 

const makeProxy=()=>x=>{
  console.log("Proxying ",x)
  return x;
}

export const Desmos = () => {
  const [folder, setFolder] = useState<jszip>();
  const [resourceUrls, setResourceUrls] = useState<Map<string, string>>();
  const [address, setAddress] = useState<string>("http://www.desmos.com/calculator.html");
  return (
  <div>
    <input type="file" id="myFile" name="filename" onChange={makeOnChange(setFolder,setResourceUrls)}/><br/>
    <input value={address} onChange={ev=>setAddress(ev.target.value)} style={{width: "100%"}}/><br/>
    {resourceUrls ? <OfflineIframe address={address} fetchUrlContent={makeFetchUrlContent(folder)} getResourceUrl={makeGetResourceUrl(resourceUrls)} proxy={makeProxy()} /> : <></>}
  </div>)
}

export const BrainFacts = () => {
  const [folder, setFolder] = useState<jszip>();
  const [resourceUrls, setResourceUrls] = useState<Map<string, string>>();
  const [address, setAddress] = useState<string>("http://www.brainfacts.org/3d-brain.html");
  return (
  <div>
    <input type="file" id="myFile" name="filename" onChange={makeOnChange(setFolder,setResourceUrls)}/><br/>
    <input value={address} onChange={ev=>setAddress(ev.target.value)} style={{width: "100%"}}/><br/>
    {resourceUrls ? <OfflineIframe address={address} fetchUrlContent={makeFetchUrlContent(folder)} getResourceUrl={makeGetResourceUrl(resourceUrls)} proxy={makeProxy()} /> : <></>}
  </div>)
}

export const AgentCooper = () => {
  const [folder, setFolder] = useState<jszip>();
  const [resourceUrls, setResourceUrls] = useState<Map<string, string>>();
  const [address, setAddress] = useState<string>("http://agentcooper.github.io/react-pdf-highlighter/index.html");
  return (
  <div>
    <input type="file" id="myFile" name="filename" onChange={makeOnChange(setFolder,setResourceUrls)}/><br/>
    <input value={address} onChange={ev=>setAddress(ev.target.value)} style={{width: "100%"}}/><br/>
    {resourceUrls ? <OfflineIframe address={address} fetchUrlContent={makeFetchUrlContent(folder)} getResourceUrl={makeGetResourceUrl(resourceUrls)} proxy={makeProxy()} /> : <></>}
  </div>)
}


export const Hypothesis = () => {
  const [folder, setFolder] = useState<jszip>();
  const [resourceUrls, setResourceUrls] = useState<Map<string, string>>();
  const [address, setAddress] = useState<string>("https://via.hypothes.is/https.html");
  const fetchUrlContent = makeFetchUrlContent(folder);
  return (
  <div>
    <input type="file" id="myFile" name="filename" onChange={makeOnChange(setFolder,setResourceUrls)}/><br/>
    <input value={address} onChange={ev=>setAddress(ev.target.value)} style={{width: "100%"}}/><br/>
    {resourceUrls ? <OfflineIframe address={address} fetchUrlContent={(url: string)=>{
      if(url=="https://via.hypothes.is/proxy/static/xP1ZVAo-CVhW7kwNneW_oQ/1628964000/https://arxiv.org/pdf/1702.08734.pdf") {
        return fetchUrlContent("https://arxiv.org/pdf/2106.05931.pdf")
      }
      const match = /https:\/\/hypothes.is\/(api.*?)\/?$/g.exec(url.toString());
      if(match) {
        return fetchUrlContent(`zip:/fake-service/${match[1]}`);
      }
      const match2 = /http:\/\/localhost:8001\/(api.*?)\/?$/g.exec(url.toString());
      if(match2) {
        return fetchUrlContent(`zip:/fake-service/${match2[1]}`);
      }
      return fetchUrlContent(url);
    }} getResourceUrl={makeGetResourceUrl(resourceUrls)} proxy={makeProxy()} /> : <></>}
  </div>)
}


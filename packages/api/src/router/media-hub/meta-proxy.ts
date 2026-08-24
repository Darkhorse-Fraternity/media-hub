// Module-level side effect: route fetch() through HTTPS_PROXY for Meta Graph API calls.
// Mac dev environment can't reach graph.facebook.com directly; production servers don't set HTTPS_PROXY.
import { ProxyAgent, setGlobalDispatcher } from "undici";

const PROXY_URL = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
if (PROXY_URL) {
  setGlobalDispatcher(
    new ProxyAgent({
      uri: PROXY_URL,
      allowH2: false,
      requestTls: { ALPNProtocols: ["http/1.1"] },
      proxyTls: { ALPNProtocols: ["http/1.1"] },
    }),
  );
}

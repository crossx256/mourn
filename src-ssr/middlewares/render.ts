import { defineSsrMiddleware } from '#q-app';
import type { Request, Response, NextFunction } from 'express';

interface SsrRequest extends Request {
  __skipSsr?: boolean;
}

const SPA_ONLY_ROUTES = ['/dashboard', '/panel', '/graveyard', '/archives', '/admin', '/auth'];

export default defineSsrMiddleware(({ app, render }) => {
  app.use((req: SsrRequest, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }

    // 1) STATIC ASSET GUARD
    const assetRegex = /\.(js|css|map|png|jpg|jpeg|gif|webp|svg|woff2?|ttf|ico|json)$/;
    if (assetRegex.test(req.path)) {
      return next();
    }

    // 2) Detect SPA-only routes
    const isSpaOnly = SPA_ONLY_ROUTES.some((route) => req.path === route || req.path.startsWith(route + '/'));
    if (isSpaOnly) {
      req.__skipSsr = true;
    }

    // 3) Render
    render({ req, res })
      .then((html: string) => {
        // 4) For SPA-only routes, strip server-rendered Vue HTML so the client
        //    does a fresh mount instead of hydration (prevents mismatch warnings).
        //    We keep __INITIAL_STATE__ — it only has default store values for SPA
        //    routes (no preFetch runs) and lets Pinia rehydrate cleanly.
        if (isSpaOnly) {
          // Strip Vue-rendered content from inside #q-app
          html = html.replace(/(<div id="?q-app"?>)[\s\S]*?(<\/div><\/body>)/i, '$1$2');
        }

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
      })
      .catch((err: Error | unknown) => {
        if (res.headersSent) {
          return next(err);
        }

        const failure = err as { redirectUrl?: unknown; redirectHttpStatusCode?: unknown; routeNotFound?: unknown } | null;
        if (typeof failure?.redirectUrl === 'string' &&
          [301, 302, 303, 307, 308].includes(Number(failure.redirectHttpStatusCode))) {
          return res.redirect(Number(failure.redirectHttpStatusCode), failure.redirectUrl);
        }

        res.setHeader('Cache-Control', 'no-store');
        if (failure?.routeNotFound === true) {
          return res.status(404).type('text/plain').send('Page not found');
        }

        console.error('SSR Render Error:', err);
        return res.status(500).type('text/plain').send('Unable to load this page. Please try again later.');
      });
  });
});

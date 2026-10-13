/**
 * Development API Server for PAZ Thriving Tribe
 * Runs on port 3001 and handles /api requests during local development
 * 
 * Usage: node api-dev-server.js
 */

import http from 'http';
import url from 'url';
import process from 'node:process';
import adminAuthHandler from './server-handlers/admin-auth.js';
import adminAccessHandler from './server-handlers/admin-access.js';
import adminHealthHandler from './server-handlers/admin-health.js';
import adminUpdateHandler from './server-handlers/admin-update.js';
import adminCustomersHandler from './server-handlers/admin-customers.js';
import customerNotificationsHandler from './server-handlers/customer-notifications.js';
import fetchMetaHandler from './server-handlers/fetch-meta.js';
import paystackWebhookHandler from './server-handlers/paystack-webhook.js';
import trackVisitorHandler from './server-handlers/track-visitor.js';
import resendWebhookHandler from './server-handlers/resend-webhook.js';
import sendNotificationEmailHandler from './server-handlers/send-notification-email.js';
import sendRegistrationEmailHandler from './server-handlers/send-registration-email.js';
import completeShopPaymentHandler from './server-handlers/complete-shop-payment.js';
import initializeShopPaymentHandler from './server-handlers/initialize-shop-payment.js';
import currencyRatesHandler from './server-handlers/currency-rates.js';
import completeServicePaymentHandler from './server-handlers/complete-service-payment.js';
import vendorSupportHandler from './server-handlers/vendor-support.js';
import customerSupportHandler from './server-handlers/customer-support.js';
import resolveBankAccountHandler from './server-handlers/resolve-bank-account.js';
import storeProductsPublicHandler from './server-handlers/store-products-public.js';
import productPreviewHandler from './server-handlers/product-preview.js';
import vendorPinChangedEmailHandler from './server-handlers/vendor-pin-changed-email.js';
import activityNotificationHandler from './server-handlers/activity-notification.js';
import testimonialSubmissionHandler from './server-handlers/testimonial-submission.js';
import generateProductDescriptionHandler from './server-handlers/generate-product-description.js';
import mentorShopOrderHandler from './server-handlers/mentor-shop-order.js';
import productReleaseNotificationHandler from './server-handlers/product-release-notification.js';
import productMetricsHandler from './server-handlers/product-metrics.js';
import productRatingsHandler from './server-handlers/product-ratings.js';
import releaseNotificationsHandler from './server-handlers/release-notifications.js';
import productChatHandler from './server-handlers/product-chat.js';
import vendorProductChatHandler from './server-handlers/vendor-product-chat.js';
import resendInboundHandler from './server-handlers/resend-inbound.js';
import appDownloadHandler from './server-handlers/app-download.js';

try {
  process.loadEnvFile?.('.env');
} catch (error) {
  // Local development can still use explicitly configured environment variables.
}

const PORT = 3001;

const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Parse body for POST requests
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      if (pathname === '/api/admin-update' && req.method === 'POST') {
        req.body = body;
        await adminUpdateHandler(req, res);
        return;
      }

      if (pathname === '/api/admin-customers' && req.method === 'POST') {
        req.body = body ? JSON.parse(body) : {};
        await adminCustomersHandler(req, res);
        return;
      }

      if (pathname === '/api/customer-notifications' && req.method === 'POST') {
        req.body = body ? JSON.parse(body) : {};
        await customerNotificationsHandler(req, res);
        return;
      }

      if (pathname === '/api/app-download') {
        await appDownloadHandler(req, res);
        return;
      }

      if (pathname === '/api/admin-auth' && req.method === 'POST') {
        req.body = body ? JSON.parse(body) : {};
        await adminAuthHandler(req, res);
        return;
      }

      if (pathname === '/api/admin-access' && req.method === 'GET') {
        await adminAccessHandler(req, res);
        return;
      }

      if (pathname === '/api/admin-health' && req.method === 'GET') {
        await adminHealthHandler(req, res);
        return;
      }

      if (pathname === '/api/complete-shop-payment' && req.method === 'POST') {
        req.body = body;
        await completeShopPaymentHandler(req, res);
        return;
      }

      if (pathname === '/api/initialize-shop-payment' && req.method === 'POST') {
        req.body = body ? JSON.parse(body) : {};
        await initializeShopPaymentHandler(req, res);
        return;
      }

      if (pathname === '/api/product-release-notification' && req.method === 'POST') {
        req.body = body ? JSON.parse(body) : {};
        await productReleaseNotificationHandler(req, res);
        return;
      }

      if (pathname === '/api/release-notifications' && req.method === 'GET') {
        await releaseNotificationsHandler(req, res);
        return;
      }

      if (pathname === '/api/complete-service-payment' && req.method === 'POST') {
        req.body = body ? JSON.parse(body) : {};
        await completeServicePaymentHandler(req, res);
        return;
      }

      if (pathname === '/api/vendor-support' && req.method === 'POST') {
        req.body = body ? JSON.parse(body) : {};
        await vendorSupportHandler(req, res);
        return;
      }

      if (pathname === '/api/customer-support' && req.method === 'POST') {
        req.body = body ? JSON.parse(body) : {};
        await customerSupportHandler(req, res);
        return;
      }

      if (pathname === '/api/product-chat' && req.method === 'POST') {
        req.body = body ? JSON.parse(body) : {};
        await productChatHandler(req, res);
        return;
      }

      if (pathname === '/api/vendor-product-chat' && req.method === 'POST') {
        req.body = body ? JSON.parse(body) : {};
        await vendorProductChatHandler(req, res);
        return;
      }

      if (pathname === '/api/resend-inbound' && req.method === 'POST') {
        req.rawBody = body;
        await resendInboundHandler(req, res);
        return;
      }

      if (pathname === '/api/activity-notification' && req.method === 'POST') {
        req.body = body ? JSON.parse(body) : {};
        await activityNotificationHandler(req, res);
        return;
      }

      if (pathname === '/api/testimonial-submission' && req.method === 'POST') {
        req.body = body ? JSON.parse(body) : {};
        await testimonialSubmissionHandler(req, res);
        return;
      }

      if (pathname === '/api/generate-product-description' && req.method === 'POST') {
        req.body = body ? JSON.parse(body) : {};
        await generateProductDescriptionHandler(req, res);
        return;
      }

      if (pathname === '/api/mentor-shop-order' && req.method === 'POST') {
        req.body = body ? JSON.parse(body) : {};
        await mentorShopOrderHandler(req, res);
        return;
      }

      if (pathname === '/api/resolve-bank-account' && req.method === 'POST') {
        req.body = body;
        await resolveBankAccountHandler(req, res);
        return;
      }

      if (pathname === '/api/store-products-public' && req.method === 'GET') {
        await storeProductsPublicHandler(req, res);
        return;
      }

      if (pathname === '/api/product-metrics' && req.method === 'GET') {
        req.query = parsedUrl.query;
        await productMetricsHandler(req, res);
        return;
      }

      if (pathname === '/api/product-ratings' && (req.method === 'GET' || req.method === 'POST')) {
        req.query = parsedUrl.query;
        req.body = req.method === 'POST' ? (body ? JSON.parse(body) : {}) : {};
        await productRatingsHandler(req, res);
        return;
      }

      if (pathname.startsWith('/api/product-preview') && req.method === 'GET') {
        const pathSlug = pathname.slice('/api/product-preview/'.length).split('/')[0];
        req.query = {
          ...parsedUrl.query,
          slug: parsedUrl.query.slug || pathSlug || parsedUrl.query.product || '',
        };
        await productPreviewHandler(req, res);
        return;
      }

      if (pathname === '/api/vendor-pin-changed-email' && req.method === 'POST') {
        req.body = body ? JSON.parse(body) : {};
        await vendorPinChangedEmailHandler(req, res);
        return;
      }

      if (pathname === '/api/currency-rates' && req.method === 'GET') {
        await currencyRatesHandler(req, res);
        return;
      }

      if (pathname === '/api/track-visitor' && req.method === 'POST') {
        req.body = body;
        await trackVisitorHandler(req, res);
        return;
      }

      if (pathname === '/api/fetch-meta' && req.method === 'GET') {
        req.query = parsedUrl.query;
        await fetchMetaHandler(req, res);
        return;
      }

      if (pathname === '/api/paystack-webhook' && req.method === 'POST') {
        req.body = body;
        await paystackWebhookHandler(req, res);
        return;
      }

      if (pathname === '/api/resend-webhook' && req.method === 'POST') {
        req.body = body;
        await resendWebhookHandler(req, res);
        return;
      }

      if (pathname === '/webhook' && (req.method === 'POST' || req.method === 'GET')) {
        req.body = body;
        await resendWebhookHandler(req, res);
        return;
      }

      if (pathname === '/api/proxy-page' && req.method === 'GET') {
        const targetUrl = parsedUrl.searchParams.get('url');
        if (!targetUrl) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Missing url parameter');
          return;
        }

        let parsedTargetUrl;
        try {
          parsedTargetUrl = new URL(targetUrl);
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Invalid url parameter');
          return;
        }

        try {
          const upstreamResponse = await fetch(parsedTargetUrl.toString(), {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
            },
            redirect: 'follow'
          });

          const html = await upstreamResponse.text();
          const rewrittenHtml = html
            .replace(/<head[^>]*>/i, (match) => `${match}\n<base href="${parsedTargetUrl.origin}/">`)
            .replace(/(src|href|action)=["']\//gi, `$1="${parsedTargetUrl.origin}/`)
            .replace(/(src|href|action)=["'](?!https?:|\/|data:|mailto:|tel:|javascript:|#)/gi, '$1="' + parsedTargetUrl.origin + '/');

          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store'
          });
          res.end(rewrittenHtml);
        } catch (error) {
          res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`Unable to load the requested page: ${error.message}`);
        }
        return;
      }

      // Handle send-notification-email endpoint
      if (pathname === '/api/send-notification-email' && req.method === 'POST') {
        req.body = body ? JSON.parse(body) : {};
        await sendNotificationEmailHandler(req, res);
        return;
      }

      // Handle registration confirmation emails to the client
      if (pathname === '/api/send-registration-email' && req.method === 'POST') {
        req.body = body ? JSON.parse(body) : {};
        await sendRegistrationEmailHandler(req, res);
        return;
      }

      // Default 404
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'API route not found' }));
    } catch (error) {
      // Log and respond on errors - 'error' is used here
      console.error('API Error:', error);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  PAZ Thriving Tribe - Development API Server               ║
║  Running on http://localhost:${PORT}                       ║
║                                                            ║
║  Endpoints:                                                ║
║  - POST /api/send-notification-email                       ║
║  - GET /api/proxy-page                                     ║
║                                                            ║
║  💡 Keep this running alongside "npm run dev"              ║
╚════════════════════════════════════════════════════════════╝
  `);
});

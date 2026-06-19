import crypto from 'crypto';
import express from 'express';
import { json, urlencoded } from 'express';

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const demoMerchantPid = '10001';
const demoMerchantName = '演示商户';
const discoveryPath = '/.well-known/openpayment-configuation';
const discoveryAlias = '/.well-known/openpayment-configuration';
const merchantKey = 'demo_merchant_secret';

app.use(json({ limit: '10mb' }));
app.use(urlencoded({ extended: true, limit: '10mb' }));

function buildResponse(req: express.Request) {
  return {
    status: 'ok',
    path: req.path,
    method: req.method,
    headers: req.headers,
    query: req.query,
    params: req.params,
    body: req.body,
    timestamp: new Date().toISOString(),
  };
}

function renderHtml(title: string, content: string) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; padding: 24px; max-width: 1000px; margin: auto; }
    pre { background: #f4f4f4; padding: 12px; overflow-x: auto; }
    .box { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin: 16px 0; }
    label { display: block; margin: 8px 0 4px; }
    input, select, textarea { width: 100%; padding: 8px; margin-bottom: 12px; border: 1px solid #bbb; border-radius: 4px; }
    button { padding: 10px 16px; border: none; border-radius: 4px; background: #007acc; color: white; cursor: pointer; }
    button:hover { background: #005fa3; }
    .row { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .small { font-size: 0.9em; color: #555; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${content}
</body>
</html>`;
}

function renderJsonBlock(label: string, data: unknown) {
  return `<div class="box"><h2>${label}</h2><pre>${JSON.stringify(data, null, 2)}</pre></div>`;
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function buildCanonicalString(params: Record<string, unknown>) {
  return Object.entries(params)
    .filter(([key, value]) => key !== 'sign' && key !== 'sign_type' && !isEmptyValue(value))
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&');
}

function validateSign(params: Record<string, unknown>, key: string, signType = 'MD5') {
  const sign = String(params.sign ?? '').toLowerCase();
  if (!sign) {
    return false;
  }

  const canonical = buildCanonicalString(params);
  if (signType === 'MD5') {
    const digest = crypto.createHash('md5').update(canonical + key, 'utf8').digest('hex');
    return digest === sign;
  }

  return false;
}

function formatAmount(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return '0.00';
  }
  const normalized = String(value).trim();
  const numberValue = Number(normalized);
  if (Number.isNaN(numberValue)) {
    return normalized;
  }
  return numberValue.toFixed(2);
}

function toAbsoluteUrl(req: express.Request, path: string) {
  const host = req.get('host') ?? `localhost:${port}`;
  return `${req.protocol}://${host}${path}`;
}

type OrderStatus = 'pending' | 'paid' | 'refunded';

interface Order {
  merchant_id: string;
  merchant_order_no: string;
  platform_order_no: string;
  amount: string;
  payment_method: string;
  status: OrderStatus;
  created_at: string;
  paid_at?: string;
  refunded_at?: string;
  notify_url?: string;
  return_url?: string;
  metadata?: string;
}

const merchantStore: Record<string, { name: string; key: string }> = {
  [demoMerchantPid]: {
    name: demoMerchantName,
    key: 'demo_secret_10001',
  },
};

const orders: Record<string, Order> = {};

function getMerchant(pid: string) {
  return merchantStore[pid] ?? null;
}

function getOrderKey(pid: string, merchantOrderNo: string) {
  return `${pid}:${merchantOrderNo}`;
}

function getOrder(pid: string, merchantOrderNo: string) {
  return orders[getOrderKey(pid, merchantOrderNo)] ?? null;
}

function saveOrder(order: Order) {
  orders[getOrderKey(order.merchant_id, order.merchant_order_no)] = order;
}

function respondError(res: express.Response, code: number, message: string, status = 400) {
  res.status(status).json({ code, message });
}

function createOrder(payload: Record<string, unknown>) {
  const pid = String(payload.pid ?? payload.merchant_id ?? demoMerchantPid);
  const outTradeNo = String(payload.out_trade_no ?? payload.merchant_order_no ?? `order_${Date.now()}`);
  const amount = formatAmount(payload.money ?? payload.amount ?? '0.00');
  const paymentMethod = String(payload.type ?? payload.payment_method ?? 'alipay');
  const platformOrderNo = `trade_${Date.now()}`;
  const order: Order = {
    merchant_id: pid,
    merchant_order_no: outTradeNo,
    platform_order_no: platformOrderNo,
    amount,
    payment_method: paymentMethod,
    status: 'pending',
    created_at: new Date().toISOString(),
    notify_url: String(payload.notify_url ?? ''),
    return_url: String(payload.return_url ?? ''),
    metadata: String(payload.param ?? payload.metadata ?? ''),
  };
  saveOrder(order);
  return order;
}

function formatMerchantKey(pid: string) {
  const merchant = getMerchant(pid);
  return merchant ? merchant.key : '';
}

app.get(discoveryPath, (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    spec: 'Open Payment Specification',
    spec_version: '1.0.0',
    profile: ['OPS-EPAY-1', 'OPS-CORE-1'],
    platform: {
      name: 'Open Payment Demo',
      vendor: 'ops-demo',
      homepage: origin,
      charset: 'utf-8',
      timezone: 'Asia/Shanghai',
      currency: 'CNY',
    },
    endpoints: {
      submit: `${origin}/pay`,
      mapi: `${origin}/api/payment/create`,
      api: `${origin}/api/payment/create`,
      query: `${origin}/api/payment/query`,
      refund: `${origin}/api/payment/refund`,
      close: null,
    },
    transports: {
      payment_create: ['form_post', 'form_get'],
      query: ['form_get', 'form_post'],
      refund: ['form_post'],
      notify: ['form_post'],
    },
    signing: {
      default: 'MD5',
      supported: ['MD5'],
      sign_field: 'sign',
      sign_type_field: 'sign_type',
      empty_value_policy: 'omit',
      sort: 'ascii_asc',
      charset: 'utf-8',
    },
    payment_methods: [
      {
        code: 'alipay',
        name: '支付宝',
        aliases: ['alipay', 'ali'],
        scenes: ['pc', 'wap', 'qr'],
        enabled: true,
      },
    ],
    fields: {
      merchant_id: ['pid', 'mch_id', 'merchant_id'],
      payment_method: ['type', 'payment_method'],
      merchant_order_no: ['out_trade_no'],
      subject: ['name', 'subject'],
      amount: ['money', 'amount'],
      notify_url: ['notify_url'],
      return_url: ['return_url'],
      client_ip: ['clientip', 'client_ip'],
      metadata: ['param', 'metadata'],
      sign: ['sign'],
      sign_type: ['sign_type'],
    },
    amount: {
      currency: 'CNY',
      format: 'decimal_string',
      scale: 2,
      min: '0.01',
    },
    callbacks: {
      notify_success_body: 'success',
      notify_retry: true,
      return_url_trusted: false,
    },
    compatibility: {
      epay_sign_type_required: true,
      query_act_values: ['order', 'query'],
      success_status_values: ['TRADE_SUCCESS', 'TRADE_FINISHED', '1'],
    },
    merchant: {
      pid: demoMerchantPid,
      name: demoMerchantName,
    },
  });
});

app.get(discoveryAlias, (_req, res) => {
  res.redirect(301, discoveryPath);
});

app.get('/', (_req, res) => {
  const content = `
    <div class="box">
      <h2>演示商户信息</h2>
      <p>商户号: <strong>${demoMerchantPid}</strong></p>
      <p>商户密钥: <strong>demo_secret_10001</strong></p>
      <p>发现端点: <a href="${discoveryPath}">${discoveryPath}</a> （别名: <a href="${discoveryAlias}">${discoveryAlias}</a>）</p>
      <p>签名生成示例: <a href="/sign?pid=${demoMerchantPid}&type=alipay&out_trade_no=order_001&name=测试商品&money=88.00&notify_url=http://localhost:3000/api/payment/notify&return_url=http://localhost:3000/api/payment/return&sign_type=MD5">/sign</a></p>
    </div>

    <p>这是一个符合 Open Payment 规范的支付服务器 Demo。你可以直接提交支付请求并跳过支付流程。</p>

    <div class="box">
      <h2>示例表单</h2>
      <div class="row">
        <div>
          <h3>创建订单</h3>
          <form action="/pay" method="post">
            <label>pid</label>
            <input name="pid" value="10001" />
            <label>type</label>
            <input name="type" value="alipay" />
            <label>out_trade_no</label>
            <input name="out_trade_no" value="order_001" />
            <label>name</label>
            <input name="name" value="测试商品" />
            <label>money</label>
            <input name="money" value="88.00" />
            <label>notify_url</label>
            <input name="notify_url" value="http://localhost:3000/api/payment/notify" />
            <label>return_url</label>
            <input name="return_url" value="http://localhost:3000/api/payment/return" />
            <label>sign_type</label>
            <select name="sign_type">
              <option value="MD5">MD5</option>
            </select>
            <label>sign</label>
            <input name="sign" value="demo_sign" />
            <button type="submit">前往支付页面</button>
          </form>
        </div>

        <div>
          <h3>查询订单</h3>
          <form action="/api/payment/query" method="post">
            <label>pid</label>
            <input name="pid" value="10001" />
            <label>out_trade_no</label>
            <input name="out_trade_no" value="order_001" />
            <label>sign_type</label>
            <select name="sign_type">
              <option value="MD5">MD5</option>
            </select>
            <label>sign</label>
            <input name="sign" value="demo_sign" />
            <button type="submit">提交查询</button>
          </form>
        </div>

        <div>
          <h3>退款</h3>
          <form action="/api/payment/refund" method="post">
            <label>pid</label>
            <input name="pid" value="10001" />
            <label>out_trade_no</label>
            <input name="out_trade_no" value="order_001" />
            <label>refund_amount</label>
            <input name="refund_amount" value="88.00" />
            <label>sign_type</label>
            <select name="sign_type">
              <option value="MD5">MD5</option>
            </select>
            <label>sign</label>
            <input name="sign" value="demo_sign" />
            <button type="submit">提交退款</button>
          </form>
        </div>
      </div>
    </div>

    <div class="box">
      <h2>快速入口</h2>
      <ul>
        <li><a href="/.well-known/openpayment-configuation">配置发现 JSON</a></li>
        <li><a href="/health">健康检查</a></li>
      </ul>
    </div>

    <div class="box small">
      <p>支付页面会展示完整参数，并提供“跳过支付”按钮来直接模拟支付成功。</p>
    </div>
  `;
  res.send(renderHtml('Open Payment Demo', content));
});

function renderPayPage(body: Record<string, unknown>) {
  const payAction = '/pay/skip';
  return `
    <div class="box">
      <h2>支付页面</h2>
      <p>此页面用于展示支付请求参数。</p>
      <form action="${payAction}" method="post">
        ${Object.entries(body)
          .map(
            ([key, value]) =>
              `<input type="hidden" name="${key}" value="${String(value ?? '')}" />`,
          )
          .join('')}
        <button type="submit">跳过支付（模拟成功）</button>
      </form>
    </div>
    ${renderJsonBlock('请求参数', body)}
    <div class="box small">
      <p>当前请求将按 Open Payment 规范展示输入字段。点击“跳过支付”即可直接模拟订单完成。</p>
    </div>
  `;
}

app.get('/pay', (req, res) => {
  const body = { ...req.query };
  res.send(renderHtml('支付页面', renderPayPage(body)));
});

app.post('/pay', (req, res) => {
  const body = req.body;
  res.send(renderHtml('支付页面', renderPayPage(body)));
});

app.post('/pay/skip', (req, res) => {
  const body = req.body;
  const pid = String(body.pid ?? body.merchant_id ?? demoMerchantPid);
  const outTradeNo = String(body.out_trade_no ?? body.merchant_order_no ?? `order_${Date.now()}`);
  const order = getOrder(pid, outTradeNo) ?? createOrder(body);
  order.status = 'paid';
  order.paid_at = new Date().toISOString();
  saveOrder(order);

  const returnUrl = String(order.return_url ?? body.return_url ?? '/');
  const resultQuery = `?out_trade_no=${encodeURIComponent(String(outTradeNo))}&status=TRADE_SUCCESS&merchant_id=${encodeURIComponent(pid)}`;

  const html = `
    <div class="box">
      <h2>支付已跳过</h2>
      <p>已模拟支付成功，以下为原始请求参数。</p>
      <p>如果商户 return_url 存在，可直接访问跳转链接：</p>
      <pre><a href="${returnUrl}${resultQuery}">${returnUrl}${resultQuery}</a></pre>
      <h3>异步通知示例</h3>
      <pre>curl -X POST ${order.notify_url || 'http://localhost:3000/api/payment/notify'} -d 'pid=${encodeURIComponent(pid)}&out_trade_no=${encodeURIComponent(outTradeNo)}&trade_no=${encodeURIComponent(order.platform_order_no)}&money=${encodeURIComponent(order.amount)}&status=TRADE_SUCCESS&sign_type=MD5&sign=...'</pre>
    </div>
    ${renderJsonBlock('支付结果', order)}
  `;
  res.send(renderHtml('支付已跳过', html));
});

const handleCreatePayment = (req: express.Request, res: express.Response) => {
  const payload = { ...req.body, ...req.query };
  const pid = String(payload.pid ?? payload.merchant_id ?? demoMerchantPid);
  const merchant = getMerchant(pid);
  if (!merchant) {
    respondError(res, 40005, '商户不存在或不可用');
    return;
  }

  const signType = String(payload.sign_type ?? 'MD5');
  if (!validateSign(payload, merchant.key, signType)) {
    respondError(res, 40001, 'invalid signature');
    return;
  }

  const order = createOrder(payload);
  const payUrl = toAbsoluteUrl(req, `/pay?out_trade_no=${encodeURIComponent(order.merchant_order_no)}&pid=${encodeURIComponent(order.merchant_id)}`);

  res.json({
    code: 0,
    message: 'success',
    data: {
      platform_order_no: order.platform_order_no,
      merchant_order_no: order.merchant_order_no,
      amount: order.amount,
      payment_method: order.payment_method,
      pay_url: payUrl,
      qrcode: null,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    },
    request: buildResponse(req),
  });
};

app.get('/api/payment/create', handleCreatePayment);
app.post('/api/payment/create', handleCreatePayment);

app.post('/api/payment/notify', (req, res) => {
  const payload = req.body;
  const pid = String(payload.pid ?? payload.merchant_id ?? '');
  const merchant = getMerchant(pid);
  if (!merchant) {
    respondError(res, 40005, '商户不存在或不可用');
    return;
  }

  const signType = String(payload.sign_type ?? 'MD5');
  if (!validateSign(payload, merchant.key, signType)) {
    respondError(res, 40001, 'invalid signature');
    return;
  }

  const outTradeNo = String(payload.out_trade_no ?? payload.merchant_order_no ?? '');
  const order = getOrder(pid, outTradeNo);
  if (order) {
    order.status = 'paid';
    order.paid_at = new Date().toISOString();
    saveOrder(order);
  }

  res.send('success');
});

const handleQueryPayment = (req: express.Request, res: express.Response) => {
  const payload = { ...req.body, ...req.query };
  const pid = String(payload.pid ?? payload.merchant_id ?? '');
  const merchant = getMerchant(pid);
  if (!merchant) {
    respondError(res, 40005, '商户不存在或不可用');
    return;
  }

  const signType = String(payload.sign_type ?? 'MD5');
  if (!validateSign(payload, merchant.key, signType)) {
    respondError(res, 40001, 'invalid signature');
    return;
  }

  const outTradeNo = String(payload.out_trade_no ?? payload.merchant_order_no ?? '');
  const order = getOrder(pid, outTradeNo);
  if (!order) {
    respondError(res, 40401, '订单不存在', 404);
    return;
  }

  res.json({
    code: 0,
    message: 'success',
    data: {
      platform_order_no: order.platform_order_no,
      merchant_order_no: order.merchant_order_no,
      amount: order.amount,
      payment_method: order.payment_method,
      status: order.status === 'paid' ? 'paid' : order.status,
      paid_at: order.paid_at,
    },
    request: buildResponse(req),
  });
};

app.get('/api/payment/query', handleQueryPayment);
app.post('/api/payment/query', handleQueryPayment);

app.post('/api/payment/refund', (req, res) => {
  const payload = { ...req.body, ...req.query };
  const pid = String(payload.pid ?? payload.merchant_id ?? '');
  const merchant = getMerchant(pid);
  if (!merchant) {
    respondError(res, 40005, '商户不存在或不可用');
    return;
  }

  const signType = String(payload.sign_type ?? 'MD5');
  if (!validateSign(payload, merchant.key, signType)) {
    respondError(res, 40001, 'invalid signature');
    return;
  }

  const outTradeNo = String(payload.out_trade_no ?? payload.merchant_order_no ?? '');
  const order = getOrder(pid, outTradeNo);
  if (!order) {
    respondError(res, 40401, '订单不存在', 404);
    return;
  }

  order.status = 'refunded';
  order.refunded_at = new Date().toISOString();
  saveOrder(order);

  res.json({
    code: 0,
    message: 'success',
    data: {
      refund_order_no: `refund_${Date.now()}`,
      merchant_order_no: order.merchant_order_no,
      platform_order_no: order.platform_order_no,
      refund_amount: formatAmount(payload.refund_amount ?? '0.00'),
      status: 'refunded',
      refunded_at: order.refunded_at,
    },
    request: buildResponse(req),
  });
});

app.get('/sign', (req, res) => {
  const params = req.query as Record<string, unknown>;
  const pid = String(params.pid ?? demoMerchantPid);
  const merchant = getMerchant(pid);
  if (!merchant) {
    res.status(404).send('商户不存在');
    return;
  }
  const sign = crypto.createHash('md5').update(buildCanonicalString(params) + merchant.key, 'utf8').digest('hex');
  const html = `
    <div class="box">
      <h2>签名生成</h2>
      <p>商户号: <strong>${pid}</strong></p>
      <p>签名类型: MD5</p>
      <p>商户密钥: <strong>${merchant.key}</strong></p>
      <p>签名结果: <strong>${sign}</strong></p>
    </div>
    ${renderJsonBlock('签名来源参数', params)}
  `;
  res.send(renderHtml('签名生成', html));
});

app.get('/api/payment/return', (req, res) => {
  const html = `
    <div class="box">
      <h2>同步返回页面</h2>
      <p>商户返回页面收到的参数：</p>
    </div>
    ${renderJsonBlock('查询参数', req.query)}
  `;
  res.send(renderHtml('同步返回', html));
});

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Endpoint not found',
    path: req.path,
  });
});

app.listen(port, () => {
  console.log(`Express demo payment server listening on http://localhost:${port}`);
});

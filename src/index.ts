import crypto from 'crypto';
import express from 'express';
import { json, urlencoded } from 'express';

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const demoMerchantPid = '10001';
const demoMerchantName = '演示商户';
const demoMerchantKey = 'demo_secret_10001';
const discoveryPath = '/.well-known/openpayment-configuation';
const discoveryAlias = '/.well-known/openpayment-configuration';

app.use(json({ limit: '10mb' }));
app.use(urlencoded({ extended: true, limit: '10mb' }));

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderHtml(title: string, content: string) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; padding: 24px; max-width: 1100px; margin: auto; color: #222; }
    pre { background: #f4f4f4; padding: 12px; overflow-x: auto; border-radius: 4px; }
    .box { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin: 16px 0; }
    label { display: block; margin: 8px 0 4px; font-size: 0.9em; }
    input, select, textarea { width: 100%; padding: 8px; margin-bottom: 12px; border: 1px solid #bbb; border-radius: 4px; box-sizing: border-box; }
    button { padding: 8px 14px; border: none; border-radius: 4px; background: #007acc; color: white; cursor: pointer; }
    button:hover { background: #005fa3; }
    button.secondary { background: #6c757d; }
    button.secondary:hover { background: #545b62; }
    button.danger { background: #c0392b; }
    button.danger:hover { background: #962d22; }
    .row { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .small { font-size: 0.9em; color: #555; }
    nav a { margin-right: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
    th, td { border: 1px solid #e0e0e0; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f7f7f7; }
    .tag { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.8em; color: #fff; }
    .tag-pending { background: #f0ad4e; }
    .tag-paid { background: #28a745; }
    .tag-refunded { background: #6c757d; }
    .actions form { display: inline; }
    .ok { color: #28a745; }
    .fail { color: #c0392b; }
  </style>
</head>
<body>
  <nav class="box">
    <a href="/">首页</a>
    <a href="/admin">订单后台</a>
    <a href="${discoveryPath}">配置发现</a>
    <a href="/health">健康检查</a>
  </nav>
  <h1>${escapeHtml(title)}</h1>
  ${content}
</body>
</html>`;
}

function renderJsonBlock(label: string, data: unknown) {
  return `<div class="box"><h2>${escapeHtml(label)}</h2><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre></div>`;
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

function signParams(params: Record<string, unknown>, key: string, signType = 'MD5') {
  const canonical = buildCanonicalString(params);
  if (signType === 'MD5') {
    return crypto.createHash('md5').update(canonical + key, 'utf8').digest('hex');
  }
  if (signType === 'HMAC-SHA256') {
    return crypto.createHmac('sha256', key).update(canonical, 'utf8').digest('hex');
  }
  throw new Error(`unsupported sign_type: ${signType}`);
}

function validateSign(params: Record<string, unknown>, key: string, signType = 'MD5') {
  const sign = String(params.sign ?? '').toLowerCase();
  if (!sign) {
    return false;
  }
  let expected: string;
  try {
    expected = signParams(params, key, signType);
  } catch {
    return false;
  }
  return expected === sign;
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

function getOrigin(req: express.Request) {
  const host = req.get('host') ?? `localhost:${port}`;
  return `${req.protocol}://${host}`;
}

function resolveUrl(origin: string, url: string) {
  if (!url) {
    return '';
  }
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  return `${origin}${url.startsWith('/') ? url : `/${url}`}`;
}

type OrderStatus = 'pending' | 'paid' | 'refunded';

interface NotificationLog {
  at: string;
  url: string;
  params: Record<string, string>;
  response_status: number | null;
  response_body: string;
  ok: boolean;
  error?: string;
}

interface Order {
  merchant_id: string;
  merchant_order_no: string;
  platform_order_no: string;
  subject: string;
  amount: string;
  payment_method: string;
  status: OrderStatus;
  created_at: string;
  paid_at?: string;
  refunded_at?: string;
  notify_url?: string;
  return_url?: string;
  metadata?: string;
  notifications: NotificationLog[];
}

interface ReceivedNotification {
  at: string;
  valid: boolean;
  order_matched: boolean;
  amount_matched: boolean;
  params: Record<string, string>;
}

const merchantStore: Record<string, { name: string; key: string }> = {
  [demoMerchantPid]: {
    name: demoMerchantName,
    key: demoMerchantKey,
  },
};

const orders: Record<string, Order> = {};
const receivedNotifications: ReceivedNotification[] = [];

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

function listOrders() {
  return Object.values(orders).sort((a, b) => b.created_at.localeCompare(a.created_at));
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
    subject: String(payload.name ?? payload.subject ?? ''),
    amount,
    payment_method: paymentMethod,
    status: 'pending',
    created_at: new Date().toISOString(),
    notify_url: String(payload.notify_url ?? ''),
    return_url: String(payload.return_url ?? ''),
    metadata: String(payload.param ?? payload.metadata ?? ''),
    notifications: [],
  };
  saveOrder(order);
  return order;
}

// 按规范以易支付兼容字段构建异步通知参数，并以平台默认 MD5 算法签名后 POST 到商户 notify_url。
async function sendNotification(order: Order, origin: string, signType = 'MD5'): Promise<NotificationLog> {
  const merchant = getMerchant(order.merchant_id);
  const key = merchant ? merchant.key : '';
  const targetUrl = resolveUrl(origin, order.notify_url ?? '');

  const params: Record<string, string> = {
    pid: order.merchant_id,
    trade_no: order.platform_order_no,
    out_trade_no: order.merchant_order_no,
    type: order.payment_method,
    name: order.subject,
    money: order.amount,
    trade_status: 'TRADE_SUCCESS',
    sign_type: signType,
  };
  if (order.metadata) {
    params.param = order.metadata;
  }
  params.sign = signParams(params, key, signType);

  const log: NotificationLog = {
    at: new Date().toISOString(),
    url: targetUrl,
    params,
    response_status: null,
    response_body: '',
    ok: false,
  };

  if (!targetUrl) {
    log.error = 'notify_url 为空，未发送';
    order.notifications.push(log);
    return log;
  }

  try {
    const resp = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(5000),
    });
    log.response_status = resp.status;
    log.response_body = (await resp.text()).slice(0, 500);
    log.ok = resp.ok && log.response_body.trim() === 'success';
  } catch (err) {
    log.error = err instanceof Error ? err.message : String(err);
  }

  order.notifications.push(log);
  return log;
}

app.get(discoveryPath, (req, res) => {
  const origin = getOrigin(req);
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
      supported: ['MD5', 'HMAC-SHA256'],
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
      {
        code: 'wxpay',
        name: '微信支付',
        aliases: ['wxpay', 'wechat'],
        scenes: ['pc', 'wap', 'qr'],
        enabled: true,
      },
    ],
    fields: {
      merchant_id: ['pid', 'mch_id', 'merchant_id'],
      payment_method: ['type', 'payment_method'],
      merchant_order_no: ['out_trade_no'],
      platform_order_no: ['trade_no'],
      subject: ['name', 'subject'],
      amount: ['money', 'amount'],
      notify_url: ['notify_url'],
      return_url: ['return_url'],
      client_ip: ['clientip', 'client_ip'],
      metadata: ['param', 'metadata'],
      status: ['trade_status'],
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
    security: {
      https_required: false,
      environment: 'development',
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

app.get('/', (req, res) => {
  const origin = getOrigin(req);
  const mockNotify = `${origin}/mock/merchant/notify`;
  const mockReturn = `${origin}/mock/merchant/return`;
  const content = `
    <div class="box">
      <h2>演示商户信息</h2>
      <p>商户号 (pid): <strong>${demoMerchantPid}</strong></p>
      <p>商户密钥: <strong>${demoMerchantKey}</strong></p>
      <p>签名默认算法: <strong>MD5</strong>（支持 HMAC-SHA256）</p>
      <p>发现端点: <a href="${discoveryPath}">${discoveryPath}</a></p>
      <p>订单后台: <a href="/admin">/admin</a> — 查看所有临时存储的订单与通知记录</p>
    </div>

    <p>这是一个符合 Open Payment 规范的支付服务器 Demo。下面的表单默认指向内置的“商户侧接收端”，可在浏览器里端到端跑通：下单 → 跳过支付 → 平台异步通知 → 商户验签 → 后台查看记录。</p>

    <div class="box">
      <h2>创建订单（提交页 submit）</h2>
      <form action="/pay" method="post">
        <div class="row">
          <div>
            <label>pid 商户号</label>
            <input name="pid" value="${demoMerchantPid}" />
            <label>type 支付方式</label>
            <input name="type" value="alipay" />
            <label>out_trade_no 商户订单号</label>
            <input name="out_trade_no" value="order_${Date.now()}" />
          </div>
          <div>
            <label>name 商品标题</label>
            <input name="name" value="测试商品" />
            <label>money 金额</label>
            <input name="money" value="88.00" />
            <label>param 透传参数（可选）</label>
            <input name="param" value="" />
          </div>
        </div>
        <label>notify_url 异步通知地址</label>
        <input name="notify_url" value="${mockNotify}" />
        <label>return_url 同步返回地址</label>
        <input name="return_url" value="${mockReturn}" />
        <button type="submit">前往支付页面</button>
      </form>
      <p class="small">支付页面会展示完整参数，点击“跳过支付”即模拟支付成功并触发异步通知。</p>
    </div>

    <div class="box small">
      <p>需要自己计算签名调用 JSON 接口时，可用 <a href="/sign?pid=${demoMerchantPid}&type=alipay&out_trade_no=order_001&name=测试商品&money=88.00&sign_type=MD5">/sign 签名生成器</a>。</p>
      <p>查询、退款等带验签的接口可直接在 <a href="/admin">/admin</a> 后台对已有订单一键调用（签名由服务端代算）。</p>
    </div>
  `;
  res.send(renderHtml('Open Payment Demo', content));
});

function renderPayPage(body: Record<string, unknown>) {
  return `
    <div class="box">
      <h2>支付页面</h2>
      <p>此页面用于展示支付请求参数。点击下方按钮可直接模拟支付成功。</p>
      <form action="/pay/skip" method="post">
        ${Object.entries(body)
          .map(
            ([key, value]) =>
              `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}" />`,
          )
          .join('')}
        <button type="submit">跳过支付（模拟成功并发送异步通知）</button>
      </form>
    </div>
    ${renderJsonBlock('请求参数', body)}
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

app.post('/pay/skip', async (req, res) => {
  const body = req.body;
  const pid = String(body.pid ?? body.merchant_id ?? demoMerchantPid);
  const outTradeNo = String(body.out_trade_no ?? body.merchant_order_no ?? `order_${Date.now()}`);
  const order = getOrder(pid, outTradeNo) ?? createOrder(body);
  order.status = 'paid';
  order.paid_at = new Date().toISOString();
  saveOrder(order);

  const origin = getOrigin(req);
  const notifyLog = await sendNotification(order, origin);

  const returnUrl = resolveUrl(origin, String(order.return_url ?? '/'));
  const resultQuery = `?out_trade_no=${encodeURIComponent(outTradeNo)}&trade_no=${encodeURIComponent(order.platform_order_no)}&trade_status=TRADE_SUCCESS&money=${encodeURIComponent(order.amount)}&pid=${encodeURIComponent(pid)}`;
  const returnLink = returnUrl ? `${returnUrl}${resultQuery}` : '';

  const html = `
    <div class="box">
      <h2>支付已跳过（模拟成功）</h2>
      <p>订单 <strong>${escapeHtml(outTradeNo)}</strong> 已标记为已支付，平台已向 notify_url 发送异步通知。</p>
      <p>异步通知结果：${notifyLog.ok ? '<span class="ok">商户返回 success ✓</span>' : `<span class="fail">未确认（${escapeHtml(notifyLog.error ?? `HTTP ${notifyLog.response_status} / ${notifyLog.response_body}`)}）</span>`}</p>
      ${returnLink ? `<p>同步返回跳转链接：<a href="${escapeHtml(returnLink)}">${escapeHtml(returnLink)}</a></p>` : ''}
      <p><a href="/admin">前往订单后台查看记录 →</a></p>
    </div>
    ${renderJsonBlock('订单', order)}
    ${renderJsonBlock('本次异步通知', notifyLog)}
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
  });
};

app.get('/api/payment/create', handleCreatePayment);
app.post('/api/payment/create', handleCreatePayment);

app.post('/api/payment/notify', async (req, res) => {
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
      status: order.status,
      paid_at: order.paid_at,
    },
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
  });
});

// 编程读取临时存储的订单数据。
app.get('/api/orders', (_req, res) => {
  res.json({ code: 0, message: 'success', data: listOrders() });
});

function statusTag(status: OrderStatus) {
  const label = status === 'pending' ? '待支付' : status === 'paid' ? '已支付' : '已退款';
  return `<span class="tag tag-${status}">${label}</span>`;
}

function renderOrderRow(order: Order) {
  const last = order.notifications[order.notifications.length - 1];
  const notifyCell = order.notifications.length
    ? `${order.notifications.length} 次，最近：${last && last.ok ? '<span class="ok">success ✓</span>' : `<span class="fail">${escapeHtml(last?.error ?? `HTTP ${last?.response_status}`)}</span>`}`
    : '<span class="small">无</span>';
  const key = `${order.merchant_id}::${order.merchant_order_no}`;
  return `
    <tr>
      <td>${escapeHtml(order.merchant_order_no)}<br /><span class="small">${escapeHtml(order.platform_order_no)}</span></td>
      <td>${escapeHtml(order.merchant_id)}</td>
      <td>${escapeHtml(order.subject)}</td>
      <td>${escapeHtml(order.amount)}</td>
      <td>${escapeHtml(order.payment_method)}</td>
      <td>${statusTag(order.status)}</td>
      <td><span class="small">${escapeHtml(order.created_at)}</span></td>
      <td>${notifyCell}</td>
      <td class="actions">
        <form action="/admin/notify" method="post"><input type="hidden" name="key" value="${escapeHtml(key)}" /><button type="submit">重发通知</button></form>
        <form action="/admin/refund" method="post"><input type="hidden" name="key" value="${escapeHtml(key)}" /><button type="submit" class="secondary">退款</button></form>
        <form action="/admin/detail" method="get"><input type="hidden" name="key" value="${escapeHtml(key)}" /><button type="submit" class="secondary">详情</button></form>
        <form action="/admin/delete" method="post"><input type="hidden" name="key" value="${escapeHtml(key)}" /><button type="submit" class="danger">删除</button></form>
      </td>
    </tr>`;
}

app.get('/admin', (_req, res) => {
  const all = listOrders();
  const rows = all.length
    ? all.map(renderOrderRow).join('')
    : '<tr><td colspan="9" class="small">暂无订单，去 <a href="/">首页</a> 创建一笔。</td></tr>';

  const received = receivedNotifications
    .slice(-10)
    .reverse()
    .map(
      (n) =>
        `<tr><td><span class="small">${escapeHtml(n.at)}</span></td><td>${escapeHtml(n.params.out_trade_no ?? '')}</td><td>${escapeHtml(n.params.money ?? '')}</td><td>${n.valid ? '<span class="ok">验签通过</span>' : '<span class="fail">验签失败</span>'}</td><td>${n.order_matched ? '✓' : '✗'}</td><td>${n.amount_matched ? '✓' : '✗'}</td></tr>`,
    )
    .join('');

  const content = `
    <div class="box">
      <h2>订单列表（内存临时存储，共 ${all.length} 笔）</h2>
      <table>
        <thead>
          <tr><th>商户单号 / 平台单号</th><th>商户</th><th>标题</th><th>金额</th><th>方式</th><th>状态</th><th>创建时间</th><th>异步通知</th><th>操作</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:16px;">
        <form action="/admin/clear" method="post" style="display:inline;"><button type="submit" class="danger">清空所有订单</button></form>
      </p>
    </div>

    <div class="box">
      <h2>内置商户接收端收到的通知（最近 10 条）</h2>
      <table>
        <thead><tr><th>时间</th><th>商户单号</th><th>金额</th><th>验签</th><th>订单匹配</th><th>金额匹配</th></tr></thead>
        <tbody>${received || '<tr><td colspan="6" class="small">尚未收到通知</td></tr>'}</tbody>
      </table>
      <p class="small">接收端: <code>/mock/merchant/notify</code>（POST，自动验签并按规范返回 success）。</p>
    </div>
  `;
  res.send(renderHtml('订单后台', content));
});

function findOrderByKey(key: string) {
  const idx = key.indexOf('::');
  if (idx < 0) {
    return null;
  }
  const pid = key.slice(0, idx);
  const outTradeNo = key.slice(idx + 2);
  return getOrder(pid, outTradeNo);
}

app.get('/admin/detail', (req, res) => {
  const order = findOrderByKey(String(req.query.key ?? ''));
  if (!order) {
    res.status(404).send(renderHtml('订单详情', '<div class="box">订单不存在。<a href="/admin">返回</a></div>'));
    return;
  }
  const content = `
    <div class="box"><a href="/admin">← 返回后台</a></div>
    ${renderJsonBlock('订单数据', order)}
    ${renderJsonBlock('异步通知记录', order.notifications)}
  `;
  res.send(renderHtml(`订单详情 ${order.merchant_order_no}`, content));
});

app.post('/admin/notify', async (req, res) => {
  const order = findOrderByKey(String(req.body.key ?? ''));
  if (order) {
    if (order.status === 'pending') {
      order.status = 'paid';
      order.paid_at = new Date().toISOString();
    }
    await sendNotification(order, getOrigin(req));
  }
  res.redirect('/admin');
});

app.post('/admin/refund', (req, res) => {
  const order = findOrderByKey(String(req.body.key ?? ''));
  if (order) {
    order.status = 'refunded';
    order.refunded_at = new Date().toISOString();
  }
  res.redirect('/admin');
});

app.post('/admin/delete', (req, res) => {
  const order = findOrderByKey(String(req.body.key ?? ''));
  if (order) {
    delete orders[getOrderKey(order.merchant_id, order.merchant_order_no)];
  }
  res.redirect('/admin');
});

app.post('/admin/clear', (_req, res) => {
  for (const key of Object.keys(orders)) {
    delete orders[key];
  }
  res.redirect('/admin');
});

// 内置“商户侧”异步通知接收端：按规范验签、校验订单与金额，记录后返回 success。
app.post('/mock/merchant/notify', (req, res) => {
  const payload = req.body as Record<string, unknown>;
  const pid = String(payload.pid ?? payload.merchant_id ?? '');
  const merchant = getMerchant(pid);
  const signType = String(payload.sign_type ?? 'MD5');
  const valid = merchant ? validateSign(payload, merchant.key, signType) : false;

  const outTradeNo = String(payload.out_trade_no ?? '');
  const order = getOrder(pid, outTradeNo);
  const orderMatched = Boolean(order);
  const amountMatched = Boolean(order) && order!.amount === formatAmount(payload.money);

  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload)) {
    params[k] = String(v ?? '');
  }
  receivedNotifications.push({
    at: new Date().toISOString(),
    valid,
    order_matched: orderMatched,
    amount_matched: amountMatched,
    params,
  });

  // 规范：验签、订单、金额、商户号全部通过才返回 success。
  if (valid && orderMatched && amountMatched) {
    res.send('success');
    return;
  }
  res.status(400).send('fail');
});

app.get('/mock/merchant/return', (req, res) => {
  const html = `
    <div class="box">
      <h2>商户同步返回页面</h2>
      <p>用户支付后浏览器跳转到此页面，仅用于展示，不作为入账依据。</p>
    </div>
    ${renderJsonBlock('查询参数', req.query)}
  `;
  res.send(renderHtml('商户同步返回', html));
});

app.get('/sign', (req, res) => {
  const params = req.query as Record<string, unknown>;
  const pid = String(params.pid ?? demoMerchantPid);
  const merchant = getMerchant(pid);
  if (!merchant) {
    res.status(404).send('商户不存在');
    return;
  }
  const signType = String(params.sign_type ?? 'MD5');
  let sign = '';
  try {
    sign = signParams(params, merchant.key, signType);
  } catch (err) {
    res.status(400).send(err instanceof Error ? err.message : 'sign error');
    return;
  }
  const html = `
    <div class="box">
      <h2>签名生成</h2>
      <p>商户号: <strong>${escapeHtml(pid)}</strong></p>
      <p>签名类型: <strong>${escapeHtml(signType)}</strong></p>
      <p>商户密钥: <strong>${escapeHtml(merchant.key)}</strong></p>
      <p>待签名串: <code>${escapeHtml(buildCanonicalString(params))}</code></p>
      <p>签名结果: <strong>${escapeHtml(sign)}</strong></p>
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
  res.json({ status: 'healthy', orders: Object.keys(orders).length, timestamp: new Date().toISOString() });
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

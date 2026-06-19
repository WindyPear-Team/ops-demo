# ops-demo

Express Open Payment Demo

This project is a demo payment server based on the Open Payment API style from https://spec.flweb.cn/open-payment/. It logs and returns the full request payload for each payment endpoint.

## Install

  yarn install

## Build

  yarn build

## Run

  yarn start

## Development

  yarn dev

## API Endpoints

  GET /health
  POST /api/payment/create
  POST /api/payment/notify
  POST /api/payment/query
  POST /api/payment/refund
  GET /api/payment/echo

Each endpoint returns a JSON object with the received headers, query, params, and body so you can inspect all request parameters.

## Example

  curl -X POST http://localhost:3000/api/payment/create \
    -H "Content-Type: application/json" \
    -d '{"merchantId":"123","amount":100,"orderId":"order_001"}'

  curl -X POST http://localhost:3000/api/payment/notify \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d 'status=success&orderId=order_001&transactionId=tx_123'

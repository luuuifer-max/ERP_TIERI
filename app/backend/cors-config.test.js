const test = require('node:test')
const assert = require('node:assert/strict')

const { createCorsOptions } = require('./cors-config')

const checkOrigin = (options, origin) => new Promise((resolve, reject) => {
  options.origin(origin, (error, allowed) => {
    if (error) return reject(error)
    resolve(allowed)
  })
})

test('allows local frontend origins by default', async () => {
  const options = createCorsOptions('')

  await assert.doesNotReject(checkOrigin(options, 'http://localhost:5173'))
  await assert.doesNotReject(checkOrigin(options, 'http://127.0.0.1:5173'))
})

test('allows configured production origins and requests without an origin', async () => {
  const options = createCorsOptions('https://erp.example.com/, https://preview.example.com')

  await assert.doesNotReject(checkOrigin(options, 'https://erp.example.com'))
  await assert.doesNotReject(checkOrigin(options, 'https://preview.example.com'))
  await assert.doesNotReject(checkOrigin(options, undefined))
})

test('rejects origins outside the allowlist', async () => {
  const options = createCorsOptions('https://erp.example.com')

  await assert.rejects(checkOrigin(options, 'https://untrusted.example.com'), /Origen no permitido/)
})
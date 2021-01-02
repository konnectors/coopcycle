process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://caeb5af192034ec2a7e8cb085132512c@sentry.cozycloud.cc/136'

const {
  BaseKonnector,
  requestFactory,
  scrape,
  log,
  utils
} = require('cozy-konnector-libs')
const request = requestFactory({
  cheerio: true,
  json: false,
  jar: true
})
const providers = require('../providers.json')

const VENDOR = 'coopcycle'

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate.bind(this)(fields)
  log('info', 'Successfully logged in')
  log('info', 'Fetching the list of documents')
  const { baseUrl } = getProvider(fields)
  const $ = await request(`${baseUrl}/profile/orders`)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments(fields, $)

  log('info', 'Saving data to Cozy')
  await this.saveBills(documents, fields, {
    // This is a bank identifier which will be used to link bills to bank operations. These
    // identifiers should be at least a word found in the title of a bank operation related to this
    // bill. It is not case sensitive.
    identifiers: ['coopcycle'],
    fileIdAttributes: ['vendorRef']
  })
}

function authenticate(fields) {
  const { login, password } = fields
  const { baseUrl } = getProvider(fields)

  return this.signin({
    url: `${baseUrl}/login`,
    formSelector: 'form',
    formData: { _username: login, _password: password },
    validate: (statusCode, $) => {
      if ($(`a[href='/logout']`).length === 1) {
        return true
      } else {
        log('error', $('.alert-danger').text())
        return false
      }
    }
  })
}

async function parseDocuments(fields, $) {
  const { baseUrl, city, name } = getProvider(fields)
  const providerName = cleanProviderName(name)

  await generateMissingReceipts(fields, $)

  const docs = scrape(
    $,
    {
      title: 'td:nth-of-type(3)',
      amount: {
        sel: 'td:nth-of-type(4) span',
        parse: normalizePrice
      },
      fileurl: {
        sel: 'td:nth-of-type(5) a',
        attr: 'href',
        parse: relativePath => {
          return relativePath ? `${baseUrl}${relativePath}` : undefined
        }
      },
      date: {
        sel: 'td:nth-of-type(6)',
        parse: normalizeDate
      },
      vendorRef: 'td:nth-of-type(1) a'
    },
    'tbody tr'
  )
  return docs
    .filter(({ fileurl }) => !!fileurl)
    .map(doc => ({
      ...doc,
      currency: 'EUR',
      filename: `${utils.formatDate(
        doc.date
      )}_${city}-${providerName}_${doc.amount.toFixed(2)}EUR${
        doc.vendorRef ? '_' + doc.vendorRef : ''
      }.pdf`,
      vendor: VENDOR,
      metadata: {
        [VENDOR]: {
          provider: name,
          city,
          summary: doc.title
        }
      }
    }))
}

async function generateMissingReceipts(fields, $) {
  const { baseUrl } = getProvider(fields)

  const missingReceiptPaths = $('form[action$="generate-receipt"]')
    .map(function() {
      return $(this).attr('action')
    })
    .get()
  log(
    'debug',
    `Requesting generation of ${missingReceiptPaths.length} missing receipts`
  )
  const receiptGenerations = missingReceiptPaths.map(async path => {
    try {
      await request({
        method: 'POST',
        uri: `${baseUrl}${path}`,
        headers: { referer: baseUrl }
      })
    } catch (err) {
      // Seems to happen even in normal situations
      log('debug', `Error while generating receipt: ${err}`)
    }
  })
  await Promise.all(receiptGenerations)
}

function normalizePrice(price) {
  return parseFloat(
    price
      .replace('€', '')
      .replace(',', '.')
      .trim()
  )
}

function normalizeDate(dateTime) {
  const formattedDate = dateTime.replace(
    /(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/,
    (_, d, M, Y, h, m) => {
      return `${Y}-${M}-${d}T${h}:${m}:00`
    }
  )
  log('debug', { formattedDate })
  return new Date(formattedDate)
}

function getProvider(fields) {
  return providers[fields.providerId]
}

function cleanProviderName(name) {
  return name.replace(/'/g, '').replace(/ /g, '_')
}

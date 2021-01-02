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
    fileIdAttributes: ['vendorRef'],
    shouldUpdate: (document, existingDocument) => {
      return document.amount !== existingDocument.amount
    }
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
      filename: generateFilename(fields, doc),
      shouldReplaceName: generateInvalidFilename(fields, doc),
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
  const formattedDate = dateTime
    .replace(
      /(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/,
      (_, d, M, Y, h, m) => {
        return `${Y}-${M}-${d}T${h}:${m}:00`
      }
    )
    .slice(0, 19) // Use the lower boundary of the delivery time interval as billing date and time
  log('debug', { formattedDate })
  return new Date(formattedDate)
}

function getProvider(fields) {
  return providers[fields.providerId]
}

function cleanProviderName(name) {
  return name.replace(/'/g, '').replace(/ /g, '_')
}

function generateFilename(fields, doc) {
  const { city, name } = getProvider(fields)
  const providerName = cleanProviderName(name)

  return `${utils.formatDate(
    doc.date
  )}_${city}-${providerName}_${doc.amount.toFixed(2)}EUR${
    doc.vendorRef ? '_' + doc.vendorRef : ''
  }.pdf`
}

/* Migration function for invoices downloaded before commit
 * `9ccb456f556c9b7fc8a94da0e0047ad96f2d6fc6`, when parsed amounts were missing
 * cents because Coopcycle could display amounts in French number format with
 * commas instead of dots as separator.
 */
function generateInvalidFilename(fields, doc) {
  const validFilename = generateFilename(fields, doc)
  const validAmount = doc.amount.toFixed(2)

  const invalidAmount = validAmount.replace(/\.\d{2}/, '.00')
  const invalidFilename = validFilename.replace(validAmount, invalidAmount)
  log('debug', { validFilename, invalidFilename })

  return invalidFilename
}
